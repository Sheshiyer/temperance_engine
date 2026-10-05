"""Disposable source protocol fixtures; no provider/adapter or native activation."""
import contextlib
import ctypes
import fcntl
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / "lib" / "launch-budget.py"
spec = importlib.util.spec_from_file_location("launch_budget", SOURCE)
m = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = m
spec.loader.exec_module(m)

class BudgetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = str(Path(self.temp.name).resolve())
        os.chmod(self.root, 0o700)
        self.now = 1_000_000_000
        self.birth = "darwin:1234:5"
        self.owner = 2345
        self.counters = {}
        self.deps = m.Dependencies(clock=lambda: self.now, birth=lambda p, u: self.birth if p == self.owner else "darwin:9999:1")
        self.budget = m.LaunchBudget(self.deps)
    def tearDown(self):
        self.temp.cleanup()
    def create(self, limit=4, ttl_ms=120_000):
        r = self.budget.create(self.root, limit, ttl_ms, owner_pid=self.owner)
        self.counters[r["nonce"]] = 0
        return r["nonce"]
    def path(self, nonce):
        return Path(self.root) / (nonce + ".json")
    def reserve(self, nonce, budget=None):
        result = (budget or self.budget).reserve(self.root, nonce, self.counters[nonce])
        self.counters[nonce] = result["counter"]
        return result
    def held(self, reason, fn):
        with self.assertRaises(m.Held) as caught:
            fn()
        self.assertEqual(caught.exception.reason, reason)
    def replace_data(self, nonce, transform):
        path = self.path(nonce)
        value = json.loads(path.read_text())
        transform(value)
        path.write_text(json.dumps(value))
    def test_ceiling_reductions_and_no_reset(self):
        for limit in (1, 2, 3, 4):
            nonce = self.create(limit)
            for counter in range(1, limit + 1):
                receipt = self.reserve(nonce)
                self.assertEqual(receipt["counter"], counter)
                for key in ("execution_authorized", "capacity_authorization", "inference_authorized"):
                    self.assertIs(receipt[key], False)
            self.held("exhausted", lambda: self.reserve(nonce))
            self.assertEqual(json.loads(self.path(nonce).read_text())["counter"], limit)
        for value in (0, 5, True):
            self.held("invalid_policy", lambda: self.create(value))
        for ttl in (0, 120_001, True):
            self.held("invalid_policy", lambda: self.create(ttl_ms=ttl))
    def test_lost_ack_consumed_and_zero_refunds(self):
        nonce = self.create(2)
        self.budget.reserve(self.root, nonce, 0)  # Acknowledgment lost.
        self.held("uncertain_ack", lambda: self.reserve(nonce))
        self.assertEqual(json.loads(self.path(nonce).read_text())["counter"], 1)
    def test_fsync_failure_consumes_or_torn_holds(self):
        nonce = self.create()
        calls = 0
        def sync(fd):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("private raw detail")
            os.fsync(fd)
        faulty = m.LaunchBudget(m.Dependencies(clock=lambda: self.now, birth=lambda p, u: self.birth, fsync=sync))
        self.held("uncertain_commit", lambda: self.reserve(nonce, faulty))
        self.assertEqual(json.loads(self.path(nonce).read_text())["counter"], 1)
        self.held("uncertain_ack", lambda: self.reserve(nonce))
    def test_short_write_and_failed_write_never_keep_old_counter(self):
        for action in (lambda fd, data: os.write(fd, data[:10]), lambda fd, data: 0):
            nonce = self.create()
            faulty = m.LaunchBudget(m.Dependencies(clock=lambda: self.now, birth=lambda p, u: self.birth, write=action))
            self.held("uncertain_commit", lambda: self.reserve(nonce, faulty))
            self.held("malformed", lambda: self.reserve(nonce))
    def test_malformed_closed_duplicate_overflow_and_torn(self):
        bad = [b"{", b"[]", b"{}", b'{"schema":1,"schema":2}', b'{"number":NaN}', b"x" * 4097]
        for value in bad:
            nonce = self.create()
            self.path(nonce).write_bytes(value)
            with self.assertRaises(m.Held):
                self.reserve(nonce)
        for key, value in [("counter", True), ("limit", 5), ("counter", 5), ("expires_ns", self.now + m.MAX_TTL_NS + 1), ("unknown", "private")]:
            nonce = self.create()
            self.replace_data(nonce, lambda r: r.update({key: value}))
            self.held("malformed", lambda: self.reserve(nonce))
    def test_owner_reuse_wrong_parent_uid_and_expiry(self):
        nonce = self.create(ttl_ms=1)
        self.birth = "darwin:1235:5"
        self.held("stale_owner", lambda: self.reserve(nonce))
        self.birth = "darwin:1234:5"
        self.replace_data(nonce, lambda r: r.update(owner_pid=self.owner + 1))
        self.held("stale_owner", lambda: self.reserve(nonce))
        self.replace_data(nonce, lambda r: r.update(owner_pid=self.owner))
        self.replace_data(nonce, lambda r: r.update(uid=os.getuid() + 1))
        self.held("stale_owner", lambda: self.reserve(nonce))
        nonce = self.create(ttl_ms=1)
        self.now += 1_000_000
        self.held("expired", lambda: self.reserve(nonce))
        self.now = 0
        self.held("expired", lambda: self.reserve(nonce))
    def test_post_observer_expiry_holds_before_write(self):
        nonce = self.create(ttl_ms=1)
        def birth(pid, uid):
            self.now += 1_000_000
            return self.birth
        faulty = m.LaunchBudget(m.Dependencies(clock=lambda: self.now, birth=birth))
        self.held("expired", lambda: self.reserve(nonce, faulty))
        self.assertEqual(json.loads(self.path(nonce).read_text())["counter"], 0)
    def test_lock_is_nonblocking(self):
        nonce = self.create()
        with self.path(nonce).open("rb") as f:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.held("locked", lambda: self.reserve(nonce))
        self.assertEqual(self.reserve(nonce)["counter"], 1)
    def test_thread_contention_never_exceeds_ceiling(self):
        nonce = self.create()
        barrier = threading.Barrier(12)
        results = []
        def worker():
            barrier.wait()
            try:
                results.append(self.budget.reserve(self.root, nonce, 0)["counter"])
            except m.Held as e:
                results.append(e.reason)
        threads = [threading.Thread(target=worker) for _ in range(12)]
        for thread in threads: thread.start()
        for thread in threads: thread.join(2)
        self.assertFalse(any(t.is_alive() for t in threads))
        counters = [v for v in results if type(v) is int]
        self.assertEqual(len(counters), len(set(counters)))
        self.assertLessEqual(len(counters), 4)
        stored = json.loads(self.path(nonce).read_text())
        self.assertEqual(stored["counter"], len(counters))
        self.counters[nonce] = stored["counter"]
        while stored["counter"] < 4:
            self.reserve(nonce)
            stored = json.loads(self.path(nonce).read_text())
        self.held("exhausted", lambda: self.reserve(nonce))
    def test_replacement_before_and_during_write_holds(self):
        nonce = self.create()
        path = self.path(nonce)
        copy = path.read_bytes()
        path.unlink()
        path.write_bytes(copy)
        path.chmod(0o600)
        self.held("replaced", lambda: self.reserve(nonce))
        nonce = self.create()
        def write(fd, data):
            path = self.path(nonce)
            path.rename(path.with_suffix(".old"))
            path.write_bytes(data)
            path.chmod(0o600)
            return os.write(fd, data)
        faulty = m.LaunchBudget(m.Dependencies(clock=lambda: self.now, birth=lambda p, u: self.birth, write=write))
        self.held("replaced", lambda: self.reserve(nonce, faulty))
        self.held("replaced", lambda: self.reserve(nonce))
    def test_symlinks_hardlinks_private_permissions(self):
        nonce = self.create()
        path = self.path(nonce)
        other = path.with_suffix(".target")
        path.rename(other)
        path.symlink_to(other)
        with self.assertRaises(m.Held): self.reserve(nonce)
        self.assertEqual(json.loads(other.read_text())["counter"], 0)
        nonce = self.create()
        os.link(self.path(nonce), self.path(nonce).with_suffix(".link"))
        self.held("unsafe_record", lambda: self.reserve(nonce))
        nonce = self.create()
        self.path(nonce).chmod(0o644)
        self.held("unsafe_record", lambda: self.reserve(nonce))
        os.chmod(self.root, 0o755)
        self.held("unsafe_path", lambda: self.create())
    def test_private_directory_symlink_and_replacement(self):
        sub = Path(self.root) / "sub"
        sub.mkdir(mode=0o700)
        alias = Path(self.root) / "alias"
        alias.symlink_to(sub, target_is_directory=True)
        self.held("unsafe_path", lambda: self.budget.create(str(alias), owner_pid=self.owner))
        nonce = self.create()
        def write(fd, data):
            old = Path(self.root).with_name(Path(self.root).name + "-old")
            Path(self.root).rename(old)
            Path(self.root).mkdir(mode=0o700)
            try:
                return os.write(fd, data)
            finally:
                # Preserve old directory for teardown once hold has been seen.
                self.old_root = old
        faulty = m.LaunchBudget(m.Dependencies(clock=lambda: self.now, birth=lambda p, u: self.birth, write=write))
        try:
            self.held("replaced", lambda: self.reserve(nonce, faulty))
        finally:
            if hasattr(self, "old_root"):
                Path(self.root).rmdir()
                self.old_root.rename(self.root)
    def test_native_linux_bounded_identity_parser(self):
        tail = [b"S"] + [b"0"] * 18 + [b"123"]
        raw = str(self.owner).encode() + b" (name with ) parentheses) " + b" ".join(tail)
        uid = os.getuid()
        status = ("Uid:\t" + "\t".join([str(uid)] * 4) + "\n").encode()
        boot = b"12345678-1234-1234-1234-123456789abc\n"
        def read(path, ceiling):
            self.assertIn(ceiling, (4096, 8192, 64))
            return status if path.endswith("status") else boot if path.endswith("boot_id") else raw
        with patch.object(m.sys, "platform", "linux"), patch.object(m, "bounded_proc", side_effect=read):
            self.assertEqual(m.native_birth(self.owner, uid), "linux:12345678-1234-1234-1234-123456789abc:123")
        with patch.object(m.sys, "platform", "linux"), patch.object(m, "bounded_proc", return_value=b"private invalid native record"):
            self.held("owner_unavailable", lambda: m.native_birth(self.owner, uid))
    def test_cli_redacts_and_rejects_duplicates_owner_override(self):
        for argv in (["create", "--directory", self.root, "--limit", "1", "--limit", "2"], ["reserve", "--directory", self.root, "--nonce", "private-path"], ["create", "--directory", self.root, "--owner-pid", "1"]):
            stderr = io.StringIO()
            with contextlib.redirect_stderr(stderr):
                self.assertEqual(m.main(argv), 2)
            self.assertNotIn(self.root, stderr.getvalue())
            self.assertNotIn("private-path", stderr.getvalue())
            self.assertEqual(json.loads(stderr.getvalue())["status"], "held")
    def test_fifo_nonblocking_and_descriptor_cleanup(self):
        nonce = self.create()
        self.path(nonce).unlink()
        os.mkfifo(self.path(nonce), 0o600)
        original_open = m.os.open
        flags_seen = []
        def open_file(path, flags, *args, **kwargs):
            if path == nonce + ".json":
                flags_seen.append(flags)
            return original_open(path, flags, *args, **kwargs)
        with patch.object(m.os, "open", side_effect=open_file):
            self.held("unsafe_record", lambda: self.reserve(nonce))
        self.assertTrue(flags_seen[0] & os.O_NONBLOCK)
        # Close error does not prevent the second descriptor close attempt.
        a = os.open(self.root, os.O_RDONLY)
        b = os.open(self.root, os.O_RDONLY)
        original_close = m.os.close
        calls = []
        def close(fd):
            calls.append(fd)
            original_close(fd)
            if fd == a:
                raise OSError("uncertain close")
        with patch.object(m.os, "close", side_effect=close):
            self.held("cleanup_uncertain", lambda: m.close_pair(a, b))
        self.assertEqual(calls, [a, b])
    def test_directory_walk_old_close_failure_closes_new_fd(self):
        original_close = m.os.close
        calls = []
        def close(fd):
            calls.append(fd)
            original_close(fd)
            if len(calls) == 1:
                raise OSError("uncertain old close")
        with patch.object(m.os, "close", side_effect=close):
            self.held("unsafe_path", lambda: m.directory(self.root))
        self.assertEqual(len(calls), 2)
        self.assertNotEqual(calls[0], calls[1])
    def test_actual_nested_call_retains_original_live_creator(self):
        env = {"PATH": os.environ.get("PATH", "")}
        created = subprocess.run([sys.executable, "-B", str(SOURCE), "create", "--directory", self.root, "--limit", "2"], capture_output=True, env=env, timeout=3)
        self.assertEqual(created.returncode, 0, created.stderr)
        nonce = json.loads(created.stdout)["nonce"]
        stored = json.loads(self.path(nonce).read_text())
        self.assertEqual(stored["owner_pid"], os.getpid())
        nested = "import subprocess,sys; r=subprocess.run([sys.executable,'-B',sys.argv[1],'reserve','--directory',sys.argv[2],'--nonce',sys.argv[3],'--expected-counter',sys.argv[4]],capture_output=True,timeout=2);sys.stdout.buffer.write(r.stdout);sys.stderr.buffer.write(r.stderr);sys.exit(r.returncode)"
        for counter in (0, 1):
            result = subprocess.run([sys.executable, "-B", "-c", nested, str(SOURCE), self.root, nonce, str(counter)], capture_output=True, env=env, timeout=3)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)["counter"], counter + 1)
            self.assertEqual(json.loads(self.path(nonce).read_text())["owner_pid"], os.getpid())
        lost = subprocess.run([sys.executable, "-B", "-c", nested, str(SOURCE), self.root, nonce, "1"], capture_output=True, env=env, timeout=3)
        self.assertEqual(lost.returncode, 2)
        self.assertEqual(json.loads(lost.stderr)["reason"], "uncertain_ack")
    def test_actual_disposable_cli_and_native_birth(self):
        # Only this test observes its own test process, never a provider/service.
        self.assertEqual(ctypes.sizeof(m.BsdInfo), 136)
        birth = m.native_birth(os.getpid(), os.getuid())
        self.assertTrue(birth.startswith(("darwin:", "linux:")))
        env = {"PATH": os.environ.get("PATH", "")}
        result = subprocess.run([sys.executable, "-B", str(SOURCE), "create", "--directory", self.root, "--limit", "1"], capture_output=True, env=env, timeout=3)
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads(result.stdout)
        nonce = receipt["nonce"]
        result = subprocess.run([sys.executable, "-B", str(SOURCE), "reserve", "--directory", self.root, "--nonce", nonce, "--expected-counter", "0"], capture_output=True, env=env, timeout=3)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["counter"], 1)
        again = subprocess.run([sys.executable, "-B", str(SOURCE), "reserve", "--directory", self.root, "--nonce", nonce, "--expected-counter", "1"], capture_output=True, env=env, timeout=3)
        self.assertEqual(again.returncode, 2)
        self.assertEqual(json.loads(again.stderr)["reason"], "exhausted")

if __name__ == "__main__":
    unittest.main()

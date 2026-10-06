"""Disposable source protocol fixtures; no provider/adapter or native activation."""
import contextlib
import copy
import ctypes
import fcntl
import importlib.util
import io
import json
import os
import pickle
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

class RetainedBudgetTests(unittest.TestCase):
    tearDown = BudgetTests.tearDown
    path = BudgetTests.path
    held = BudgetTests.held
    replace_data = BudgetTests.replace_data
    # New fixtures use injected birth/clock; only disposable local files.
    def setUp(self):
        BudgetTests.setUp(self)
        self.owner = os.getpid()
    def retained(self, **kw):
        return self.budget.create_retained(self.root, limit=2, owner_pid=self.owner, **kw)
    def test_retained_sequence_immutable_redacted_and_legacy_shape(self):
        original = self.retained()
        self.assertEqual(set(original.receipt), set(m.receipt('create', 'a'*32, 0, 2)))
        self.assertNotIn(original.receipt['nonce'], repr(original))
        self.assertNotIn(self.root, repr(original.handle))
        with self.assertRaises(TypeError): original.receipt['counter'] = 99
        with self.assertRaises(Exception): original.handle = object()
        for value in (original, original.handle):
            with self.assertRaises(TypeError): pickle.dumps(value)
            with self.assertRaises(TypeError): copy.copy(value)
        first = self.budget.reserve_retained(original.handle)
        second = self.budget.reserve_retained(first.handle)
        self.assertEqual([original.receipt['counter'], first.receipt['counter'], second.receipt['counter']], [0,1,2])
        self.assertEqual(second.receipt['nonce'], original.receipt['nonce'])
        self.held('retained_unavailable', lambda: self.budget.reserve_retained(first.handle))
        self.held('retained_unavailable', self.retained)
    def test_foreign_forged_and_spent_handle_zero_mutation(self):
        original = self.retained()
        for budget, handle in ((m.LaunchBudget(self.deps), original.handle), (self.budget, object()), (self.budget, m._RetainedHandle())):
            self.held('retained_unavailable', lambda: budget.reserve_retained(handle))
        self.assertEqual(json.loads(self.path(original.receipt['nonce']).read_text())['counter'],0)
        self.assertEqual(self.budget.reserve_retained(original.handle).receipt['counter'],1)
    def test_same_nonce_consistent_replacement_zero_write(self):
        original = self.retained();path = self.path(original.receipt['nonce'])
        old = path.with_suffix('.old');path.rename(old)
        record = json.loads(old.read_text());path.write_text(json.dumps(record));path.chmod(0o600)
        s=path.stat();record.update(device=s.st_dev,inode=s.st_ino);path.write_text(json.dumps(record))
        writes=[]
        self.budget.deps=m.Dependencies(clock=lambda:self.now,birth=lambda p,u:self.birth,write=lambda fd,raw:writes.append(raw))
        self.held('retained_mismatch', lambda:self.budget.reserve_retained(original.handle))
        self.assertEqual(writes,[]);self.assertEqual(json.loads(path.read_text())['counter'],0)
        self.held('retained_unavailable', lambda:self.budget.reserve_retained(original.handle))
    def test_all_retained_record_metadata_drift_zero_increment(self):
        for field, value in [('created_ns',self.now+1),('expires_ns',self.now+1000000),('limit',3),('counter',1),('owner_birth','darwin:555:6')]:
            budget=m.LaunchBudget(self.deps);result=budget.create_retained(self.root,limit=2,owner_pid=self.owner)
            self.replace_data(result.receipt['nonce'],lambda r:r.update({field:value}))
            before=self.path(result.receipt['nonce']).read_bytes()
            self.held('retained_mismatch',lambda:budget.reserve_retained(result.handle))
            self.assertEqual(self.path(result.receipt['nonce']).read_bytes(),before)
    def test_retained_close_failure_after_commit_has_no_usable_ack(self):
        original=self.retained();real=m.close_pair;calls=[]
        def closing(fd,dfd):
            calls.append((fd,dfd));real(fd,dfd);raise m.Held('cleanup_uncertain')
        with patch.object(m,'close_pair',side_effect=closing):
            self.held('cleanup_uncertain',lambda:self.budget.reserve_retained(original.handle))
        self.assertEqual(len(calls),1)
        self.assertEqual(json.loads(self.path(original.receipt['nonce']).read_text())['counter'],1)
        self.held('retained_unavailable',lambda:self.budget.reserve_retained(original.handle))
    def test_retained_create_close_failure_no_handle_or_retry(self):
        real=m.close_pair
        def closing(fd,dfd):real(fd,dfd);raise m.Held('cleanup_uncertain')
        with patch.object(m,'close_pair',side_effect=closing):self.held('cleanup_uncertain',self.retained)
        self.assertIsNone(self.budget._latest_handle)
        self.held('retained_unavailable',self.retained)
    def test_retained_lost_second_result_and_reentrant_intents(self):
        original=self.retained();first=self.budget.reserve_retained(original.handle)
        seen=[];write=os.write
        def reentrant(fd,raw):
            self.held('retained_unavailable',lambda:self.budget.reserve_retained(first.handle));seen.append(1)
            return write(fd,raw)
        self.budget.deps=m.Dependencies(clock=lambda:self.now,birth=lambda p,u:self.birth,write=reentrant)
        self.budget.reserve_retained(first.handle) # Caller loses acknowledgment.
        self.assertEqual(seen,[1])
        self.held('retained_unavailable',lambda:self.budget.reserve_retained(first.handle))
        self.assertEqual(json.loads(self.path(first.receipt['nonce']).read_text())['counter'],2)
    def test_retained_expiry_and_explicit_current_process_owner(self):
        self.held('stale_owner',lambda:self.budget.create_retained(self.root,owner_pid=self.owner+1))
        self.held('retained_unavailable',self.retained)
        budget=m.LaunchBudget(self.deps);r=budget.create_retained(self.root,limit=2,ttl_ms=1,owner_pid=self.owner)
        self.now+=1000000
        self.held('expired',lambda:budget.reserve_retained(r.handle))
        self.held('retained_unavailable',lambda:budget.reserve_retained(r.handle))
    def test_retained_create_intent_precedes_callbacks(self):
        calls=[]
        def sync(fd):
            self.held('retained_unavailable',self.retained);calls.append(1);os.fsync(fd)
        self.budget.deps=m.Dependencies(clock=lambda:self.now,birth=lambda p,u:self.birth,fsync=sync)
        result=self.retained();self.assertGreater(len(calls),0)
        self.assertEqual(len(list(Path(self.root).glob('*.json'))),1)
        self.assertEqual(result.receipt['counter'],0)
    def test_retained_post_commit_expiry_no_usable_result(self):
        original=self.retained(ttl_ms=1);calls=[]
        def sync(fd):
            calls.append(1);os.fsync(fd)
            if len(calls)==2:self.now+=1000000
        self.budget.deps=m.Dependencies(clock=lambda:self.now,birth=lambda p,u:self.birth,fsync=sync)
        self.held('expired',lambda:self.budget.reserve_retained(original.handle))
        self.assertEqual(json.loads(self.path(original.receipt['nonce']).read_text())['counter'],1)
        self.assertIsNone(self.budget._latest_handle)
        self.held('retained_unavailable',lambda:self.budget.reserve_retained(original.handle))
    def test_retained_late_close_create_and_reserve_never_publish(self):
        real=m.close_pair
        def late(fd,dfd):real(fd,dfd);self.now+=1000000
        with patch.object(m,'close_pair',side_effect=late):
            self.held('expired',lambda:self.retained(ttl_ms=1))
        self.assertIsNone(self.budget._latest_handle)
        self.held('retained_unavailable',self.retained)
        self.budget=m.LaunchBudget(self.deps);original=self.retained(ttl_ms=1)
        with patch.object(m,'close_pair',side_effect=late):
            self.held('expired',lambda:self.budget.reserve_retained(original.handle))
        self.assertIsNone(self.budget._latest_handle)
        self.assertEqual(json.loads(self.path(original.receipt['nonce']).read_text())['counter'],1)
        self.held('retained_unavailable',lambda:self.budget.reserve_retained(original.handle))

if __name__ == "__main__":
    unittest.main()

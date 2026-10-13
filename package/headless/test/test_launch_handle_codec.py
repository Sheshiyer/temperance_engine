"""Bounded inert metadata fixtures, no provider/model or native adapter."""
import importlib.util
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "lib" / "launch-handle-codec.py"
BUDGET = SOURCE.with_name("launch-budget.py")
spec = importlib.util.spec_from_file_location("launch_handle_codec", SOURCE)
m = importlib.util.module_from_spec(spec); sys.modules[spec.name] = m; spec.loader.exec_module(m)

def pipes():
    child_read, owner_write = os.pipe()
    owner_read, child_write = os.pipe()
    return (owner_write, owner_read), (child_read, child_write)

def close_fds(fds):
    for fd in fds:
        try: os.close(fd)
        except OSError: pass

def handle():
    now = time.monotonic_ns()
    return {"schema": m.HANDLE, "directory": "/private/inert-fixture", "nonce": "a" * 32,
            "expected_counter": 0, "launch_limit": 4, "invocation_deadline_ns": now + 1_000_000_000,
            "exchange_deadline_ns": now + 300_000_000, **{key: False for key in m.FLAGS}}

def reservation(h):
    return {"schema": "temperance.cli-launch-budget.v1", "operation": "reserve", "status": "reserved", "nonce": h["nonce"], "counter": h["expected_counter"] + 1, "launch_limit": h["launch_limit"], **{key: False for key in m.FLAGS}}

def frame(packet):
    raw = json.dumps(packet).encode()
    return struct.pack(">I", len(raw)) + raw

class CodecTests(unittest.TestCase):
    def pair(self, context=None, reserve=reservation, retain=lambda _: None, owner_deps=None, child_deps=None):
        own, child = pipes()
        outcomes = {}; marker = []
        def run_child():
            try:
                outcomes["child"] = dict(m._child_exchange(reserve, _fds=child, _dependencies=child_deps))
                marker.append("metadata-ready")
            except m.CodecHeld as e: outcomes["child"] = e.reason
        thread = threading.Thread(target=run_child)
        thread.start()
        try:
            try: outcomes["owner"] = dict(m._owner_exchange(context or handle(), retain, _fds=own, _dependencies=owner_deps))
            except m.CodecHeld as e: outcomes["owner"] = e.reason
        finally:
            thread.join(2)
            close_fds((*own, *child))
        self.assertFalse(thread.is_alive())
        return outcomes, marker
    def test_success_retain_before_confirm_immutable_falseauthority(self):
        retained = []
        def retain(ack):
            with self.assertRaises(TypeError): ack["counter"] = 99
            retained.append(ack["counter"])
        outcomes, marker = self.pair(retain=retain)
        self.assertEqual(retained, [1])
        self.assertEqual(marker, ["metadata-ready"])
        for role in ("owner", "child"):
            self.assertEqual(outcomes[role]["status"], "metadata-ready")
            self.assertTrue(all(outcomes[role][key] is False for key in m.FLAGS))
    def test_retain_failure_blocks_current_readiness(self):
        def fail(_): raise OSError("private owner error")
        outcomes, marker = self.pair(retain=fail)
        self.assertEqual(outcomes["owner"], "retain_held")
        self.assertEqual(marker, [])
    def test_invalid_reservation_or_exception_no_confirm(self):
        for kind in ("extra", "authority", "counter", "nonce", "error"):
            def reserve(h):
                r = reservation(h)
                if kind == "error": raise RuntimeError("private")
                if kind == "extra": r["private"] = "secret"
                if kind == "authority": r["execution_authorized"] = True
                if kind == "counter": r["counter"] = True
                if kind == "nonce": r["nonce"] = "b" * 32
                return r
            outcomes, marker = self.pair(reserve=reserve)
            self.assertIsInstance(outcomes["owner"], str)
            self.assertEqual(marker, [])
    def test_closed_handle_and_no_hostile_comparison(self):
        class Bad:
            def __eq__(self, other): raise AssertionError("must not compare")
        for key, value in (("schema", Bad()), ("expected_counter", True), ("launch_limit", 5), ("directory", "../private"), ("directory", "/\ud800"), ("execution_authorized", True), ("extra", "secret")):
            h = handle(); h[key] = value
            outcomes, marker = self.pair(context=h)
            self.assertEqual(outcomes["owner"], "invalid_handle")
            self.assertEqual(marker, [])
    def test_callback_elapsed_deadline_and_cancellation(self):
        for role in ("reserve", "retain"):
            h = handle(); clock = [time.monotonic_ns()]
            deps = m._Dependencies(clock=lambda: clock[0])
            def reserve(packet):
                result = reservation(packet)
                if role == "reserve": clock[0] = h["exchange_deadline_ns"]
                return result
            def retain(_):
                if role == "retain": clock[0] = h["exchange_deadline_ns"]
            outcomes, marker = self.pair(h, reserve, retain, owner_deps=deps if role == "retain" else None, child_deps=deps if role == "reserve" else None)
            self.assertEqual(outcomes["owner" if role == "retain" else "child"], "deadline")
            self.assertEqual(marker, [])
        outcomes, marker = self.pair(child_deps=m._Dependencies(cancelled=lambda: True))
        self.assertEqual(outcomes["child"], "cancelled"); self.assertEqual(marker, [])
    def test_lost_ack_eof_blocks_confirmation_after_consumed_slot(self):
        calls = []
        def lost_write(fd, raw):
            return len(raw)  # Simulated lost delivery, not a reservation refund.
        def reserve(h): calls.append("consumed"); return reservation(h)
        outcomes, marker = self.pair(reserve=reserve, child_deps=m._Dependencies(write=lost_write))
        self.assertEqual(calls, ["consumed"])
        self.assertEqual(outcomes["owner"], "unexpected_eof")
        self.assertEqual(marker, [])
    def test_partial_short_io_reassembly(self):
        deps = m._Dependencies(read=lambda fd, n: os.read(fd, min(2, n)), write=lambda fd, data: os.write(fd, data[:3]))
        outcomes, marker = self.pair(owner_deps=deps, child_deps=deps)
        self.assertEqual(marker, ["metadata-ready"])
        self.assertEqual(outcomes["child"]["status"], "metadata-ready")
    def test_prefix_overflow_partial_duplicate_utf8_no_callback(self):
        raw_cases = [struct.pack(">I", 16385), b"\x00\x01", struct.pack(">I", 10) + b"{}", struct.pack(">I", 1) + b"\xff"]
        for raw in (b'{"schema":"a","schema":"b"}', b'{"nested":{"a":1,"a":2}}', b'{"n":NaN}'):
            raw_cases.append(struct.pack(">I", len(raw)) + raw)
        for raw in raw_cases:
            own, child = pipes(); calls = []
            os.write(own[0], raw); os.close(own[0]); os.close(own[1])
            try:
                with self.assertRaises(m.CodecHeld):
                    m._child_exchange(lambda h: calls.append(h), _fds=child)
                self.assertEqual(calls, [])
            finally: close_fds((*own, *child))
    def test_extra_ack_no_retention_and_missing_ack_eof_deadline(self):
        h = handle(); retained = []
        own, child = pipes()
        def producer():
            ch = m._Channel("child", child, m._Dependencies())
            try:
                received = m._handle(ch.read_frame(child[0])); ch.bind(received)
                ack = m._ack(received, reservation(received))
                ch.write_frame(child[1], ack); ch.write_frame(child[1], ack)
            finally: ch.finish()
        t = threading.Thread(target=producer); t.start()
        try:
            with self.assertRaises(m.CodecHeld) as caught:
                m._owner_exchange(h, lambda ack: retained.append(ack), _fds=own)
            self.assertEqual(caught.exception.reason, "extra_frame")
            self.assertEqual(retained, [])
        finally: t.join(2); close_fds((*own, *child))
    def test_bad_confirmation_and_no_eof_hold(self):
        for kind in ("counter", "nonce", "extra", "no-eof"):
            own, child = pipes(); marker = []; outcome = []
            h = handle()
            def child_run():
                try: m._child_exchange(reservation, _fds=child); marker.append(True)
                except m.CodecHeld as e: outcome.append(e.reason)
            t = threading.Thread(target=child_run); t.start()
            channel = m._Channel("owner", own, m._Dependencies())
            try:
                channel.bind(h); channel.write_frame(own[0], h)
                ack = channel.read_frame(own[1]); channel.eof(own[1]); channel.close(own[1])
                confirmation = dict(ack, schema=m.CONFIRM)
                if kind == "counter": confirmation["counter"] = 2
                if kind == "nonce": confirmation["nonce"] = "b" * 32
                channel.write_frame(own[0], confirmation)
                if kind == "extra": channel.write_frame(own[0], confirmation)
                if kind != "no-eof": channel.close(own[0])
                t.join(1)
                self.assertFalse(t.is_alive()); self.assertEqual(marker, [])
                self.assertEqual(outcome, ["deadline" if kind == "no-eof" else "extra_frame" if kind == "extra" else "invalid_confirmation"])
            finally: channel.finish(); close_fds((*own, *child))
    def test_blocked_ack_total_deadline_and_close_failure_before_confirm(self):
        own, child = pipes(); h = handle(); retained = []
        try:
            before = time.monotonic()
            with self.assertRaises(m.CodecHeld) as caught:
                m._owner_exchange(h, lambda a: retained.append(a), _fds=own)
            self.assertEqual(caught.exception.reason, "deadline")
            self.assertLess(time.monotonic()-before, 1)
            self.assertEqual(retained, [])
        finally: close_fds((*own, *child))
        calls=[]
        def close(fd):
            os.close(fd);calls.append(fd)
            if len(calls)==1:raise OSError("uncertain first close")
        outcomes,marker=self.pair(owner_deps=m._Dependencies(close=close))
        self.assertEqual(outcomes["owner"],"cleanup_uncertain")
        self.assertEqual(len(calls),2)
        self.assertEqual(marker,[])
    def test_regular_file_roles_rejected_and_constructor_errors_redacted(self):
        with tempfile.TemporaryFile() as a, tempfile.TemporaryFile() as b:
            x,y=os.dup(a.fileno()),os.dup(b.fileno())
            with self.assertRaises(m.CodecHeld) as caught:
                m._owner_exchange(handle(),lambda _:None,_fds=(x,y))
            self.assertEqual(caught.exception.reason,"descriptor_role")
            for fd in (x,y):
                with self.assertRaises(OSError):os.fstat(fd)
        own,child=pipes()
        def clock():raise RuntimeError("private clock detail")
        try:
            with self.assertRaises(m.CodecHeld) as caught:
                m._owner_exchange(handle(),lambda _:None,_fds=own,_dependencies=m._Dependencies(clock=clock))
            self.assertEqual(caught.exception.reason,"clock_unavailable")
        finally:close_fds((*own,*child))
    def test_post_confirm_owner_close_uncertainty_can_leave_child_ready(self):
        calls = []
        def close(fd):
            os.close(fd); calls.append(fd)
            if len(calls) == 2: raise OSError("post-confirm uncertain close")
        outcomes, marker = self.pair(owner_deps=m._Dependencies(close=close))
        self.assertEqual(outcomes["owner"], "cleanup_uncertain")
        self.assertEqual(marker, ["metadata-ready"])  # No retroactive zero-launch claim.
    def test_role_and_constructor_clock_failure_close_both(self):
        own, child = pipes()
        try:
            with self.assertRaises(m.CodecHeld): m._child_exchange(reservation, _fds=own)
            for fd in own:
                with self.assertRaises(OSError): os.fstat(fd)
        finally: close_fds((*own, *child))
        own, child = pipes()
        try:
            with self.assertRaises(m.CodecHeld): m._owner_exchange(handle(), lambda _: None, _fds=own, _dependencies=m._Dependencies(clock=lambda: True))
            for fd in own:
                with self.assertRaises(OSError): os.fstat(fd)
        finally: close_fds((*own, *child))

    def test_actual_nested_fixed_roles_shared_budget_and_preconfirm_hold(self):
        load = """
import importlib.util,json,os,sys,subprocess,fcntl
from pathlib import Path
def load(name,path):
    s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);sys.modules[name]=m;s.loader.exec_module(m);return m
def install(a,b):
    x=fcntl.fcntl(a,fcntl.F_DUPFD_CLOEXEC,20);y=fcntl.fcntl(b,fcntl.F_DUPFD_CLOEXEC,20)
    os.dup2(x,3,inheritable=False);os.dup2(y,4,inheritable=False)
    for f in {a,b,x,y}-{3,4}:os.close(f)
"""
        child_source = load + """
codec=load('codec',sys.argv[1]);budget=load('budget',sys.argv[2]);marker=Path(sys.argv[3])
install(int(sys.argv[4]),int(sys.argv[5]))
def reserve(h):return budget.LaunchBudget().reserve(h['directory'],h['nonce'],h['expected_counter'])
try:
    r=codec.child_exchange(reserve)
except codec.CodecHeld as e:
    print(json.dumps({'held':e.reason}));sys.exit(2)
for fd in (3,4):
    try:os.fstat(fd);raise AssertionError('descriptor leaked')
    except OSError:pass
check=chr(10).join(["import os", "for fd in (3,4):", " try:os.fstat(fd);raise AssertionError('inherited descriptor')", " except OSError:pass"])
subprocess.run([sys.executable,'-B','-c',check],close_fds=True,check=True,timeout=1)
marker.write_text('inert-ready')
print(json.dumps(dict(r)))
"""
        owner_source = load + """
codec=load('codec',sys.argv[1]);h=json.loads(sys.stdin.read());mode=sys.argv[5]
cr,ow=os.pipe();orr,cw=os.pipe()
child=subprocess.Popen([sys.executable,'-B',sys.argv[2],sys.argv[1],sys.argv[3],sys.argv[4],str(cr),str(cw)],pass_fds=(cr,cw),close_fds=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
os.close(cr);os.close(cw);install(ow,orr)
retained=[]
def retain(a):
    if mode=='retain-fail':raise RuntimeError('private fixture error')
    retained.append(a['counter'])
try:r=dict(codec.owner_exchange(h,retain));code=0
except codec.CodecHeld as e:r={'held':e.reason};code=2
out,err=child.communicate(timeout=2)
assert child.returncode==(0 if mode=='success' else 2),(out,err)
for fd in (3,4):
    try:os.fstat(fd);raise AssertionError('owner descriptor leaked')
    except OSError:pass
print(json.dumps({'receipt':r,'retained':retained}));sys.exit(code)
"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve(); os.chmod(root,0o700)
            owner_script = root / "owner.py"; owner_script.write_text(owner_source)
            child_script = root / "child.py"; child_script.write_text(child_source)
            env = {"PATH":os.environ.get("PATH","")}
            for mode in ("success", "retain-fail"):
                before = time.monotonic_ns()
                created = subprocess.run([sys.executable,"-B",str(BUDGET),"create","--directory",str(root),"--limit","2","--ttl-ms","2000"],capture_output=True,env=env,timeout=2)
                self.assertEqual(created.returncode,0,created.stderr)
                nonce = json.loads(created.stdout)["nonce"]
                h=handle();h.update(directory=str(root),nonce=nonce,launch_limit=2,invocation_deadline_ns=before+2_000_000_000,exchange_deadline_ns=time.monotonic_ns()+1_000_000_000)
                marker = root / (mode+".marker")
                result = subprocess.run([sys.executable,"-B",str(owner_script),str(SOURCE),str(child_script),str(BUDGET),str(marker),mode],input=json.dumps(h).encode(),capture_output=True,env=env,timeout=3)
                self.assertEqual(result.returncode,0 if mode=="success" else 2,result.stderr)
                parsed=json.loads(result.stdout)
                self.assertEqual(parsed["retained"],[1] if mode=="success" else [])
                self.assertEqual(marker.exists(),mode=="success")
                # Test observation only; never used to resume/repair counters.
                record=json.loads((root/(nonce+".json")).read_bytes())
                self.assertEqual(record["counter"],1)
                self.assertEqual(record["owner_pid"],os.getpid())

if __name__ == "__main__": unittest.main()

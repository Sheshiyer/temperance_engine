import errno
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
from types import SimpleNamespace
import unittest

BASE=Path(__file__).resolve().parents[1]
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,BASE/'lib'/file);module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module);return module
m=load('status_fd','model-worker-status-fd.py');p=load('status_protocol','model-worker-stopped-protocol.py')
def owner():return {'schema':'temperance.retained-worker-owner.v1','nonce':'a'*32,'counter':1,'launch_limit':4,'creator_pid':101,'uid':501,'creator_birth':'darwin:100:1','created_ns':1_000_000_000,'invocation_deadline_ns':121_000_000_000}
def policy():return {'schema':'temperance.model-worker-policy.v1','kind':'metadata-calibration','wall_ns':10_000_000_000,'rss_bytes':128*1024**2,'physical_bytes':128*1024**2,'active_descendants':0,'lifetime_identities':256,'snapshot_ids':4096}
def context():return {'nonce':'a'*32,'counter':1,'deadline_ns':121_000_000_000,'creator_pid':101,'uid':501,'creator_birth':'darwin:100:1','child_pid':102,'child_birth':'darwin:100:2'}
class Ops:
    def __init__(self):
        self.inodes={17:1,18:2};self.fl={17:os.O_RDONLY,18:os.O_WRONLY};self.df={17:0,18:0};self.closed=[];self.writes=[];self.bound=512;self.count=69;self.eagain=False;self.close_fail=None
        raw=json.dumps({'schema':'temperance.worker-stopped-status.v1','nonce':'a'*32,'counter':1,'pid':102,'stage':'before-payload-exec'},separators=(',',':')).encode();self.data=bytearray(len(raw).to_bytes(4,'big')+raw)
    def fstat(self,fd):
        if fd not in self.inodes or fd in self.closed:raise OSError('private')
        return SimpleNamespace(st_dev=1,st_ino=self.inodes[fd],st_mode=stat.S_IFIFO)
    def getfl(self,fd):return self.fl[fd]
    def getfd(self,fd):return self.df[fd]
    def setfl(self,fd,value):self.fl[fd]=value
    def setfd(self,fd,value):self.df[fd]=value
    def read(self,fd,n):
        if self.eagain:self.eagain=False;raise BlockingIOError(errno.EAGAIN,'private')
        r=bytes(self.data[:min(n,7)]);del self.data[:len(r)];return r
    def write(self,fd,data):self.writes.append(data);return self.count
    def pipe_bound(self,fd):return self.bound
    def close(self,fd):
        self.closed.append(fd)
        if fd==self.close_fail:raise OSError('private')
class Callbacks:
    def __init__(self,ops):self.ops=ops;self.calls=[];self.override={}
    def retained_owner_ack(self):return {'schema':'temperance.trusted-worker-owner-ack.v1',**{k:v for k,v in context().items() if k not in ('child_pid','child_birth')},'ack_eof_retained':True}
    def close_parent_copies(self):self.calls.append('parent');return True
    def observe_stopped(self):
        assert 17 in self.ops.closed
        self.calls.append('observe');r={'creator_pid':101,'creator_uid':501,'creator_birth':'darwin:100:1','pid':102,'uid':501,'birth':'darwin:100:2','parent_pid':101,'state':'stopped','pressure':'normal','rss_bytes':1,'physical_bytes':1,'descendants':0,'lifetime_count':1};r.update(self.override);return r
    def continue_child(self):assert 18 in self.ops.closed;self.calls.append('continue');return True
class Tests(unittest.TestCase):
    def new(self,ops=None,endpoints=None,encoder=True):
        self.now=2_000_000_000;self.ops=ops or Ops();self.callbacks=Callbacks(self.ops)
        encode=(lambda c:p.control(p.basis.Owner.parse(owner()),c['child_pid'],c['uid'],c['child_birth'])) if encoder else None
        self.adapter=m.StatusFDAdapter(endpoints or {'status_reader':17,'release_writer':18},context(),11_000_000_000,self.callbacks,encode,syscalls=self.ops,clock=lambda:self.now)
        self.protocol=p.StoppedProtocol(policy(),owner(),102,clock=lambda:self.now);return self.adapter
    def drive(self):
        for _ in range(100):
            result=self.protocol.step(self.adapter)
            if result['status'] in ('held','injected-continuation-observed'):return result
        self.fail('step bound')
    def test_actual_protocol_mock_join_order(self):
        self.new();r=self.drive();self.assertEqual(r['status'],'injected-continuation-observed');self.assertEqual(len(self.ops.writes),1);self.assertEqual(len(self.ops.writes[0]),69);self.assertEqual(self.ops.closed,[17,18]);self.assertEqual(self.callbacks.calls[-1],'continue');self.assertFalse(r['execution_authorized'])
    def test_eagain_status_pending_then_join(self):self.new();self.ops.eagain=True;self.assertEqual(self.drive()['status'],'injected-continuation-observed')
    def test_wrong_independent_birth_no_write(self):self.new();self.callbacks.override['birth']='darwin:100:3';self.assertEqual(self.drive()['status'],'held');self.assertFalse(self.ops.writes)
    def test_small_atomic_or_partial_write_never_continue(self):
        for bound,count in ((68,69),(512,68)):
            self.new();self.ops.bound=bound;self.ops.count=count;self.assertEqual(self.drive()['status'],'held');self.assertNotIn('continue',self.callbacks.calls);self.adapter.teardown();self.assertLessEqual(len(self.ops.writes),1)
    def test_wrong_control_no_write(self):
        a=self.new();a.status_eof=True;a.observe_count=1
        with self.assertRaises(m.Held):a.write_control(b'x'*69)
        self.assertFalse(self.ops.writes)
    def test_invalid_peer_retains_safe_cleanup(self):
        for endpoints,expected in (({'status_reader':-1,'release_writer':18},18),({'status_reader':17,'release_writer':-1},17)):
            a=self.new(endpoints=endpoints);self.assertEqual(a.reason,'endpoint_invalid');self.assertIn(expected,self.ops.closed)
    def test_changed_identity_not_closed_or_read(self):
        a=self.new();self.ops.inodes[17]=3
        with self.assertRaises(m.Held):a.read_status(64)
        self.assertNotIn(17,self.ops.closed);self.assertIn(18,self.ops.closed);self.assertTrue(self.ops.data)
    def test_flag_drift_held(self):
        a=self.new();self.ops.fl[17]=os.O_WRONLY
        with self.assertRaises(m.Held):a.read_status(64)
        self.assertEqual(a.reason,'flags_changed')
    def test_expired_cleanup_no_retry(self):
        a=self.new();self.now=11_000_000_000
        with self.assertRaises(m.Held):a.read_status(1)
        a.teardown();self.assertEqual(sorted(self.ops.closed),[17,18])
    def test_close_exception_peer_cleanup_once(self):
        a=self.new();self.ops.close_fail=17;a.teardown();a.teardown();self.assertEqual(self.ops.closed,[17,18]);self.assertFalse(a.closed.get(17,False));self.assertTrue(a.closed[18])
    def test_encoder_required_no_implicit_loader(self):a=self.new(encoder=False);self.assertEqual(a.reason,'context_invalid');self.assertEqual(sorted(self.ops.closed),[17,18])
    def test_postwrite_observation_required(self):
        a=self.new();a.status_eof=True;a.observe_count=1;a.write_control(a.encoder(a.context));a.close_control_writer()
        with self.assertRaises(m.Held):a.continue_child()
        self.assertNotIn('continue',self.callbacks.calls)
    def test_direct_continuation_once_success_uncertain_exception(self):
        for outcome in ('success','false','exception'):
            a=self.new();a.status_eof=True;a.observe_count=1;a.write_control(a.encoder(a.context));a.close_control_writer();a.observe_count+=1
            calls=[]
            def continue_once():
                calls.append(True)
                if outcome=='exception':raise RuntimeError('private')
                return outcome=='success'
            self.callbacks.continue_child=continue_once
            if outcome=='success':self.assertTrue(a.continue_child())
            else:
                with self.assertRaises(m.Held):a.continue_child()
                self.assertEqual(a.reason,'continuation_unverified')
            a.observe_count+=1
            with self.assertRaises(m.Held):a.continue_child()
            self.assertEqual(len(calls),1)
if __name__=='__main__':unittest.main()

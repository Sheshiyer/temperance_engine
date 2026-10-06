import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import unittest
spec=importlib.util.spec_from_file_location('stopped_protocol',Path(__file__).resolve().parents[1]/'lib/model-worker-stopped-protocol.py');m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)


def policy():return {'schema':'temperance.model-worker-policy.v1','kind':'metadata-calibration','wall_ns':10_000_000_000,'rss_bytes':128*1024**2,'physical_bytes':128*1024**2,'active_descendants':0,'lifetime_identities':256,'snapshot_ids':4096}
def owner():return {'schema':'temperance.retained-worker-owner.v1','nonce':'a'*32,'counter':1,'launch_limit':4,'creator_pid':101,'uid':501,'creator_birth':'darwin:100:1','created_ns':1_000_000_000,'invocation_deadline_ns':121_000_000_000}


class Adapter:
    def __init__(self):
        self.calls=[];self.ack={'schema':'temperance.trusted-worker-owner-ack.v1','nonce':'a'*32,'counter':1,'deadline_ns':121_000_000_000,'creator_pid':101,'uid':501,'creator_birth':'darwin:100:1','ack_eof_retained':True}
        raw=json.dumps({'schema':'temperance.worker-stopped-status.v1','nonce':'a'*32,'counter':1,'pid':102,'stage':'before-payload-exec'},separators=(',',':')).encode();self.data=bytearray(len(raw).to_bytes(4,'big')+raw);self.bound=512;self.count=69;self.override={};self.packet=None;self.failure=None
    def retained_owner_ack(self):self.calls.append('ack');return dict(self.ack)
    def close_parent_copies(self):self.calls.append('parent-close');return True
    def read_status(self,maximum):
        self.calls.append('status');r=bytes(self.data[:min(maximum,7)]);del self.data[:len(r)];return r
    def observe_stopped(self):
        self.calls.append('observe');r={'creator_pid':101,'creator_uid':501,'creator_birth':'darwin:100:1','pid':102,'uid':501,'birth':'darwin:100:2','parent_pid':101,'state':'stopped','pressure':'normal','rss_bytes':1,'physical_bytes':1,'descendants':0,'lifetime_count':1};r.update(self.override);return r
    def atomic_pipe_bound(self):self.calls.append('bound');return self.bound
    def write_control(self,packet):
        self.calls.append('write');self.packet=packet
        if self.failure=='eagain':raise BlockingIOError('private')
        return self.count
    def close_control_writer(self):self.calls.append('control-close');return True
    def continue_child(self):self.calls.append('continue');return True


class Tests(unittest.TestCase):
    def new(self):self.now=[2_000_000_000];return m.StoppedProtocol(policy(),owner(),102,clock=lambda:self.now[0])
    def drive(self,b,a):
        for _ in range(100):
            r=b.step(a)
            if r['status'] in ('held','injected-continuation-observed'):return r
        self.fail('not bounded')
    def tocontrol(self,b,a):
        for _ in range(100):
            b.step(a)
            if b.phase=='control':return
        self.fail('no control')
    def test_exact_order_and_binary_control(self):
        b=self.new();a=Adapter();self.assertFalse(b.receipt()['owner_ack_observed']);r=self.drive(b,a)
        self.assertTrue(r['owner_ack_observed'])
        self.assertEqual(r['status'],'injected-continuation-observed');self.assertEqual(a.calls[-5:],['observe','bound','write','control-close','observe','continue'][-5:])
        self.assertEqual(len(a.packet),69);self.assertEqual(a.packet[:4],b'TWR1');self.assertEqual(a.packet[21:29],owner()['invocation_deadline_ns'].to_bytes(8,'big'));self.assertEqual(a.packet[-32:],hashlib.sha256(b'darwin:100:2').digest())
        self.assertFalse(r['execution_authorized']);self.assertFalse(r['cleanup_verified'])
    def test_owner_ack_missing_or_mismatch_no_status_or_write(self):
        for key,value in [('nonce','b'*32),('counter',2),('deadline_ns',1),('creator_birth','darwin:200:1'),('ack_eof_retained',1)]:
            b=self.new();a=Adapter();a.ack[key]=value;r=self.drive(b,a)
            self.assertEqual(r['reason'],'owner_ack_unavailable');self.assertNotIn('status',a.calls);self.assertTrue(r['trusted_owner_slot_precondition']);self.assertFalse(r['owner_ack_observed'])
    def test_status_invalid_duplicate_utf8_unknown_and_bound(self):
        for raw in (b'{"pid":102,"pid":103}',b'\xff',b'{"extra":1}',b'['*5+b']'*5):
            b=self.new();a=Adapter();a.data=bytearray(len(raw).to_bytes(4,'big')+raw);self.assertEqual(self.drive(b,a)['status'],'held');self.assertNotIn('write',a.calls)
        b=self.new();a=Adapter();a.data=bytearray((481).to_bytes(4,'big'));self.assertEqual(self.drive(b,a)['reason'],'status_bound')
    def test_status_eof_extra_and_incomplete(self):
        b=self.new();a=Adapter();a.data.extend(b'extra');self.assertEqual(self.drive(b,a)['status'],'held')
        b=self.new();a=Adapter();a.data=bytearray(b'\x00\x00');self.assertEqual(self.drive(b,a)['reason'],'status_incomplete')
    def test_stopped_state_independent_no_write(self):
        for key,value in [('state','live'),('parent_pid',999),('birth','not-darwin'),('pressure','host_pressure_elevated')]:
            b=self.new();a=Adapter();a.override[key]=value;self.assertEqual(self.drive(b,a)['status'],'held');self.assertNotIn('write',a.calls)
    def test_small_atomic_partial_eagain_once(self):
        for bound,count,failure in ((68,69,None),(512,68,None),(512,69,'eagain')):
            b=self.new();a=Adapter();a.bound=bound;a.count=count;a.failure=failure;r=self.drive(b,a)
            self.assertEqual(r['status'],'held');self.assertNotIn('continue',a.calls)
            before=list(a.calls);b.step(a);self.assertEqual(a.calls,before);self.assertLessEqual(a.calls.count('write'),1)
    def test_fresh_postwrite_pressure_or_birth_blocks_continue(self):
        for key,value in [('pressure','host_pressure_elevated'),('birth','darwin:200:1')]:
            b=self.new();a=Adapter();fn=a.close_control_writer
            def close():r=fn();a.override[key]=value;return r
            a.close_control_writer=close;r=self.drive(b,a)
            self.assertTrue(r['write_return_count_verified']);self.assertFalse(r['continuation_attempted']);self.assertEqual(a.calls.count('write'),1)
    def test_canonical_birth_and_integer_encoding(self):
        for value in ('darwin:0:1','darwin:1:1000000','linux:x','darwin:1:1\n','darwin:１:1'):
            with self.assertRaises(m.Held):m.darwin_birth(value)
        o=m.basis.Owner.parse(owner());self.assertEqual(len(m.control(o,2,2**32-1,'darwin:001:0001')),69)
        with self.assertRaises(m.Held):m.control(o,True,501,'darwin:1:1')
    def test_deadline_cancel_poll_and_no_replay(self):
        b=self.new();a=Adapter();self.now[0]+=50_000_001;self.assertEqual(b.step(a)['reason'],'poll_late');self.assertFalse(a.calls)
        b=self.new();a=Adapter();b.cancelled=lambda:True;self.assertEqual(b.step(a)['reason'],'cancelled')
        b=self.new();a=Adapter();self.now[0]=b.deadline-500_000_000;self.assertEqual(b.step(a)['reason'],'cleanup_reserve')
    def test_missing_stop_bounded_and_no_self_report(self):
        b=self.new();a=Adapter();a.observe_stopped=lambda:None
        for _ in range(260):b.step(a)
        self.assertEqual(b.reason,'step_bound');self.assertFalse(b.write_attempted);self.assertIsNone(b.child)

if __name__=='__main__':unittest.main()

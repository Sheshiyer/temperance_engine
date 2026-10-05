import importlib.util
from pathlib import Path
import sys
import unittest
spec=importlib.util.spec_from_file_location('coordination',Path(__file__).resolve().parents[1]/'lib/model-worker-coordination.py');m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)


def policy():return {'schema':'temperance.model-worker-policy.v1','kind':'metadata-calibration','wall_ns':10_000_000_000,'rss_bytes':128*1024**2,'physical_bytes':128*1024**2,'active_descendants':0,'lifetime_identities':256,'snapshot_ids':4096}
def owner():return {'schema':'temperance.retained-worker-owner.v1','nonce':'a'*32,'counter':1,'launch_limit':4,'creator_pid':101,'uid':501,'creator_birth':'darwin:100:1','created_ns':1_000_000_000,'invocation_deadline_ns':121_000_000_000}
def child():return {'pid':102,'uid':501,'birth':'darwin:100:2','kernel_start':None}
def channels():return {'schema':'temperance.worker-coordinate-channels.v1','launch_ack_fd':4,'launch_confirm_fd':3,'stopped_status_fd':5,'release_fd':6}


class Adapter:
    def __init__(self):self.calls=[];self.overrides={};self.fail=None
    def observe(self):
        self.calls.append('observe');r={'creator_pid':101,'creator_uid':501,'creator_birth':'darwin:100:1','pid':102,'uid':501,'birth':'darwin:100:2','parent_pid':101,'state':'stopped','pressure':'normal','rss_bytes':1,'physical_bytes':1,'descendants':0,'lifetime_count':1,'identity_certain':True};r.update(self.overrides);return r
    def close_parent_channels(self):self.calls.append('close');return self.fail!='close'
    def release(self):
        self.calls.append('release')
        if self.fail=='release':raise OSError('private payload')
        return True
    def cleanup_identity(self):self.calls.append('cleanup_identity');return {'pid':102,'uid':501,'birth':self.overrides.get('birth','darwin:100:2')}
    def terminate(self):self.calls.append('terminate')


class Capture:
    def __init__(self):self.calls=0;self.result={'status':'pending','terminal_observed':False,'exit_code':None,'final_write_completed':False}
    def step(self):self.calls+=1;return dict(self.result)


class Tests(unittest.TestCase):
    def new(self):
        self.now=[2_000_000_000];return m.Coordinator(policy(),owner(),child(),channels(),clock=lambda:self.now[0])
    def test_resource_before_every_nonblocking_capture(self):
        b=self.new();a=Adapter();c=Capture();b.release(a)
        self.assertEqual(a.calls,['observe','close','observe','release'])
        b.step(a,c);self.assertEqual(a.calls[-1],'observe');self.assertEqual(c.calls,1)
        c.result={'status':'completed','terminal_observed':True,'exit_code':0,'final_write_completed':True}
        r=b.step(a,c);self.assertEqual(r['status'],'injected-completion-observed');self.assertFalse(r['resource_contained'])
    def test_pressure_resource_identity_hold_before_release(self):
        for key,value in [('pressure','host_pressure_elevated'),('rss_bytes',129*1024**2),('physical_bytes',129*1024**2),('descendants',1),('lifetime_count',257),('birth','darwin:200:1'),('state','live'),('identity_certain',False)]:
            b=self.new();a=Adapter();a.overrides[key]=value;r=b.release(a)
            self.assertEqual(r['status'],'held');self.assertNotIn('release',a.calls)
    def test_late_poll_and_callback_block_without_replay(self):
        b=self.new();a=Adapter();c=Capture();b.release(a);self.now[0]+=50_000_001;r=b.step(a,c)
        self.assertEqual(r['reason'],'poll_late');self.assertEqual(c.calls,0)
        b=self.new();a=Adapter();original=a.observe
        def late():r=original();self.now[0]+=50_000_001;return r
        a.observe=late;r=b.release(a);self.assertEqual(r['reason'],'poll_late');self.assertNotIn('release',a.calls)
    def test_lost_release_ack_no_new_launch(self):
        b=self.new();a=Adapter();a.fail='release';r=b.release(a)
        self.assertTrue(r['launch_slot_retained']);self.assertEqual(r['reason'],'adapter_unavailable')
        with self.assertRaises(m.Held):b.release(a)
        self.assertEqual(a.calls.count('release'),1);self.assertEqual(b.owner.counter,1)
    def test_capture_not_blocking_promise_uncertainty(self):
        b=self.new();a=Adapter();c=Capture();b.release(a)
        c.result={'status':'completed','terminal_observed':True,'exit_code':0,'final_write_completed':False}
        r=b.step(a,c);self.assertEqual(r['reason'],'capture_uncertain')
        c.result={'status':'completed','terminal_observed':True,'exit_code':0,'final_write_completed':True}
        b.step(a,c);self.assertEqual(c.calls,1)
    def test_channels_closed_and_caps_missing(self):
        d=channels();d['launch_ack_fd']=5
        with self.assertRaises(m.Held):m.Coordinator(policy(),owner(),child(),d)
        with self.assertRaises(m.Held):m.Coordinator(None,owner(),child(),channels())
    def test_parentclose_failure_no_release(self):
        b=self.new();a=Adapter();a.fail='close';r=b.release(a)
        self.assertEqual(r['reason'],'parent_close_unverified');self.assertNotIn('release',a.calls)
    def test_cleanup_exactbirth_once_emergency_no_renewal(self):
        b=self.new();a=Adapter();deadline=b.deadline;self.now[0]=deadline
        r=b.cleanup(a);self.assertTrue(r['emergency_cleanup']);self.assertEqual(b.deadline,deadline)
        self.assertEqual(b.emergency_deadline,deadline+500_000_000);self.assertFalse(r['cleanup_verified']);self.assertIn('terminate',a.calls)
        b.cleanup(a);self.assertEqual(a.calls.count('terminate'),1)
        b=self.new();a=Adapter();a.overrides['birth']='darwin:200:1';b.cleanup(a);self.assertNotIn('terminate',a.calls)
    def test_cancel_and_reserve(self):
        b=self.new();b.cancelled=lambda:True;a=Adapter();r=b.release(a);self.assertEqual(r['reason'],'cancelled')
        b=self.new();self.now[0]=b.deadline-500_000_000;a=Adapter();r=b.release(a);self.assertEqual(r['reason'],'cleanup_reserve');self.assertFalse(a.calls)
    def test_finite_steps_and_detached_owner(self):
        o=owner();now=[2_000_000_000];b=m.Coordinator(policy(),o,child(),channels(),clock=lambda:now[0]);o['counter']=4
        a=Adapter();c=Capture();b.release(a)
        for _ in range(256):b.step(a,c)
        r=b.step(a,c);self.assertEqual(r['reason'],'step_bound');self.assertEqual(c.calls,256);self.assertEqual(b.owner.counter,1)

if __name__=='__main__':unittest.main()

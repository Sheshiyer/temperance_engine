import copy
import importlib.util
from pathlib import Path
import sys
import unittest

spec=importlib.util.spec_from_file_location('bootstrap',Path(__file__).resolve().parents[1]/'lib/model-worker-bootstrap.py')
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)


def policy():
    return {'schema':'temperance.model-worker-policy.v1','kind':'metadata-calibration','wall_ns':10_000_000_000,'rss_bytes':128*1024**2,'physical_bytes':128*1024**2,'active_descendants':0,'lifetime_identities':256,'snapshot_ids':4096}


def owner():
    return {'schema':'temperance.retained-worker-owner.v1','nonce':'a'*32,'counter':1,'launch_limit':4,'creator_pid':101,'uid':501,'creator_birth':'darwin:100:1','created_ns':1_000_000_000,'invocation_deadline_ns':121_000_000_000}


def channels():
    return {'schema':'temperance.worker-bootstrap-channel.v1','status_fd':5,'release_fd':6,'frame_bytes':16384,'aggregate_bytes':32768,'execution_authorized':False}


class Adapter:
    def __init__(self):
        self.calls=[];self.fail=None;self.child={'pid':102,'uid':501,'birth':'darwin:100:2','parent_pid':101,'state':'stopped','source':'adapter-native-observation'}
    def observe(self,pid):
        self.calls.append(('observe',pid))
        if self.fail=='observe':raise OSError('private content')
        return {'pid':101,'uid':501,'birth':'darwin:100:1','state':'live'} if pid==101 else copy.deepcopy(self.child)
    def create_stopped(self):
        self.calls.append(('create',))
        if self.fail=='create':raise OSError('private content')
        return copy.deepcopy(self.child)
    def close_parent_channels(self):
        self.calls.append(('close',));return self.fail!='close'
    def release(self,pid):
        self.calls.append(('release',pid));return self.fail!='release'
    def terminate(self,pid):self.calls.append(('terminate',pid))


class Tests(unittest.TestCase):
    def new(self):
        self.time=[2_000_000_000]
        return m.Bootstrap(policy(),owner(),channels(),clock=lambda:self.time[0])
    def test_release_order_and_false_flags(self):
        b=self.new();a=Adapter();r=b.run(a)
        self.assertEqual(r['status'],'injected-release-observed')
        self.assertEqual(a.calls,[('observe',101),('create',),('close',),('observe',101),('observe',102),('release',102)])
        self.assertEqual(b.child,(102,501,'darwin:100:2'))
        for k in ('execution_authorized','capacity_authorization','resource_contained','cleanup_verified','actual_phase_role_verified','inference_verified','pre_effect_proven','replay_authorized'):self.assertIs(r[k],False)
        self.assertNotIn('darwin',str(r));self.assertNotIn('a'*32,str(r))
    def test_closed_descriptors_no_override(self):
        for key,value in [('status_fd',3),('release_fd',4),('frame_bytes',16385),('aggregate_bytes',32769),('execution_authorized',0),('status_fd',True)]:
            d=channels();d[key]=value
            with self.assertRaises(m.Held):m.Bootstrap(policy(),owner(),d)
        d=channels();d['env']='override'
        with self.assertRaises(m.Held):m.Bootstrap(policy(),owner(),d)
    def test_lost_creation_ack_never_retry(self):
        b=self.new();a=Adapter();a.fail='create';r=b.run(a)
        self.assertEqual(r['reason'],'adapter_unavailable');self.assertTrue(r['launch_slot_retained'])
        with self.assertRaises(m.Held):b.run(a)
        b.cleanup(a);self.assertEqual(a.calls.count(('create',)),1);self.assertFalse(any(x[0] in ('release','terminate') for x in a.calls))
    def test_not_stopped_or_self_report_no_release(self):
        for key,value in [('state','live'),('source','child-self-report'),('parent_pid',103),('uid',502)]:
            b=self.new();a=Adapter();a.child[key]=value;b.run(a)
            self.assertFalse(any(x[0]=='release' for x in a.calls));self.assertEqual(b.status,'held')
    def test_replaced_child_before_release_retained(self):
        b=self.new();a=Adapter();original=a.close_parent_channels
        def close():
            result=original();a.child['birth']='darwin:200:1';return result
        a.close_parent_channels=close;r=b.run(a)
        self.assertEqual(r['reason'],'child_identity_changed');self.assertEqual(b.child[2],'darwin:100:2')
        b.cleanup(a);self.assertFalse(any(x[0] in ('release','terminate') for x in a.calls))
    def test_creator_loss_no_release(self):
        b=self.new();a=Adapter();a.fail='observe';b.run(a)
        self.assertFalse(any(x[0]=='create' for x in a.calls));self.assertEqual(b.reason,'adapter_unavailable')
    def test_close_failure_retains_cleanup_ownership(self):
        b=self.new();a=Adapter();a.fail='close';b.run(a)
        self.assertEqual(b.reason,'parent_close_unverified');self.assertIsNotNone(b.child)
        r=b.cleanup(a);self.assertIn(('terminate',102),a.calls);self.assertFalse(r['cleanup_verified'])
    def test_expiry_callback_no_release_no_renewal(self):
        b=self.new();a=Adapter();original=a.create_stopped
        def create():
            r=original();self.time[0]=b.deadline;return r
        a.create_stopped=create;r=b.run(a)
        self.assertEqual(r['reason'],'deadline');self.assertFalse(any(x[0]=='release' for x in a.calls))
        deadline=b.deadline;r=b.cleanup(a);self.assertEqual(b.deadline,deadline);self.assertTrue(r['emergency_cleanup']);self.assertEqual(b.emergency_deadline,self.time[0]+500_000_000)
        before=list(a.calls);b.cleanup(a);self.assertEqual(a.calls,before)
    def test_cleanup_deadline_unknown_identity_no_signal(self):
        b=self.new();a=Adapter();b.run(a);a.fail='observe';r=b.cleanup(a)
        self.assertEqual(r['reason'],'cleanup_unavailable');self.assertFalse(any(x[0]=='terminate' for x in a.calls))
    def test_cleanup_callback_late_held(self):
        b=self.new();a=Adapter();b.run(a)
        def terminate(pid):a.calls.append(('terminate',pid));self.time[0]=b.deadline
        a.terminate=terminate;r=b.cleanup(a)
        self.assertEqual(r['reason'],'cleanup_deadline');self.assertFalse(r['cleanup_verified'])
    def test_cleanup_reserve_stops_release_retains_original(self):
        b=self.new();a=Adapter();original=a.close_parent_channels
        def close():
            result=original();self.time[0]=b.deadline-499_999_999;return result
        a.close_parent_channels=close;r=b.run(a)
        self.assertEqual(r['reason'],'cleanup_reserve');self.assertIsNotNone(b.child)
        self.assertTrue(r['launch_slot_retained']);self.assertFalse(any(x[0]=='release' for x in a.calls))
        deadline=b.deadline;b.cleanup(a);self.assertEqual(b.deadline,deadline)
        self.assertIsNone(b.emergency_deadline);self.assertIn(('terminate',102),a.calls)
        with self.assertRaises(m.Held):m.Bootstrap(policy(),owner(),channels(),clock=lambda:10_500_000_000)
    def test_exception_string_never_invoked(self):
        class HostileHeld(m.Held):
            def __str__(self):raise AssertionError('must never invoke')
        b=self.new();a=Adapter()
        def create():raise HostileHeld('x'*10000)
        a.create_stopped=create;r=b.run(a)
        self.assertEqual(r['reason'],'adapter_unavailable');self.assertFalse(any(x[0]=='release' for x in a.calls))
    def test_cancel_and_backward_clock_hold(self):
        b=self.new();b.cancelled=lambda:True;a=Adapter();r=b.run(a);self.assertEqual(r['reason'],'cancelled');self.assertFalse(a.calls)
        b=self.new();self.time[0]=0;a=Adapter();r=b.run(a);self.assertEqual(r['reason'],'clock_unavailable');self.assertFalse(a.calls)


if __name__=='__main__':unittest.main()

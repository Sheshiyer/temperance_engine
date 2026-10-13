import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('owner_chain',Path(__file__).resolve().parents[1]/'lib/retained-owner-chain.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def creator():return {'pid':101,'uid':501,'birth':'darwin:100:1','kernel_start_token':11}
def process(pid,parent):return {'pid':pid,'uid':501,'birth':'darwin:100:'+str(pid),'kernel_start_token':pid,'parent_pid':parent['pid'],'parent_uid':parent['uid'],'parent_birth':parent['birth']}
def receipt(count):return {'schema':'temperance.cli-launch-budget.v1','operation':'create' if count==0 else 'reserve','status':'created' if count==0 else 'reserved','nonce':'a'*32,'counter':count,'launch_limit':2,**{f:False for f in m.FLAGS}}
def context():return {'schema':'temperance.owner-chain-input.v2','directory':'/private/fixture','creator':creator(),'created_ns':1_000_000_000,'invocation_deadline_ns':121_000_000_000,'exchange_deadline_ns':3_000_000_000,'create_receipt':receipt(0)}
class Test(unittest.TestCase):
    def new(self):self.now=2_000_000_000;self.events=[];return m.OwnerChain(context(),clock=lambda:self.now)
    def reserve(self,c,index):self.events.append(('reserve',index));return receipt(index+1)
    def supervisor(self,c,r):self.events.append(('supervisor',r['counter']));return process(102,creator())
    def worker(self,c,r,p):self.events.append(('worker',r['counter']));return process(103,p)
    def ready(self):p=self.new();p.retain_two(self.reserve,creator);return p
    def super_ready(self):p=self.ready();p.create_supervisor(self.supervisor,creator);return p
    def test_two_original_responses_before_either_create(self):
        p=self.super_ready();p.create_worker(self.worker,lambda:dict(p.supervisor),creator);self.assertEqual(self.events,[('reserve',0),('reserve',1),('supervisor',1),('worker',2)]);r=p.receipt();self.assertTrue(r['worker_creation_admitted']);self.assertFalse(r['native_cleanup_authority']);self.assertFalse(r['execution_authorized'])
    def test_second_lost_no_create_no_retry(self):
        p=self.new()
        def lost(c,i):self.events.append(('reserve',i));return receipt(1) if i==0 else (_ for _ in ()).throw(RuntimeError('private'))
        with self.assertRaises(m.Held):p.retain_two(lost,creator)
        self.assertIsNotNone(p.reservations[0]);self.assertIsNone(p.reservations[1])
        for fn in (lambda:p.retain_two(self.reserve,creator),lambda:p.create_supervisor(self.supervisor,creator)):
            with self.assertRaises(m.Held):fn()
        self.assertEqual(self.events,[('reserve',0),('reserve',1)])
    def test_invalid_second_counter_or_authority_holds_both(self):
        for key,val in [('counter',True),('counter',1),('nonce','b'*32),('launch_limit',3),('execution_authorized',True)]:
            p=self.new()
            def invalid(c,i):r=receipt(i+1);r.update({key:val} if i else {});return r
            with self.assertRaises(m.Held):p.retain_two(invalid,creator)
            self.assertFalse(p.supervisor_attempted)
    def test_creator_drift_post_reserve_keeps_response(self):
        p=self.new();calls=[]
        def obs():calls.append(1);return creator() if len(calls)==1 else {**creator(),'kernel_start_token':12}
        with self.assertRaises(m.Held):p.retain_two(self.reserve,obs)
        self.assertIsNotNone(p.reservations[0]);self.assertFalse(p.reserve_attempted[1])
    def test_late_supervisor_keeps_first_candidate_not_admission(self):
        p=self.ready()
        def late(c,r):self.now=3_000_000_000;return process(102,creator())
        with self.assertRaises(m.Held):p.create_supervisor(late,creator)
        self.assertEqual(p.supervisor['pid'],102);self.assertFalse(p.supervisor_admitted);self.assertTrue(p.receipt()['first_reported_supervisor_token_retained'])
        with self.assertRaises(m.Held):p.create_supervisor(self.supervisor,creator)
    def test_postcreate_owner_drift_keeps_candidate(self):
        p=self.ready();calls=[]
        def obs():calls.append(1);return creator() if len(calls)==1 else {**creator(),'birth':'darwin:200:1'}
        with self.assertRaises(m.Held):p.create_supervisor(self.supervisor,obs)
        self.assertIsNotNone(p.supervisor);self.assertFalse(p.supervisor_admitted)
    def test_lost_supervisor_response_unknown(self):
        p=self.ready()
        def lost(c,r):raise RuntimeError('private')
        with self.assertRaises(m.Held):p.create_supervisor(lost,creator)
        self.assertIsNone(p.supervisor);self.assertTrue(p.supervisor_attempted)
    def test_worker_late_and_postsupervisor_drift_preserve_candidate(self):
        p=self.super_ready()
        def late(c,r,parent):self.now=3_000_000_000;return process(103,parent)
        with self.assertRaises(m.Held):p.create_worker(late,lambda:dict(p.supervisor),creator)
        self.assertEqual(p.worker['pid'],103);self.assertFalse(p.worker_admitted)
        p=self.super_ready();calls=[]
        def obs():calls.append(1);r=dict(p.supervisor);r['kernel_start_token']+=int(len(calls)>1);return r
        with self.assertRaises(m.Held):p.create_worker(self.worker,obs,creator)
        self.assertIsNotNone(p.worker);self.assertFalse(p.worker_admitted)
    def test_wrong_worker_parent_and_supervisor_pre_drift(self):
        p=self.super_ready()
        with self.assertRaises(m.Held):p.create_worker(lambda c,r,parent:process(103,creator()),lambda:dict(p.supervisor),creator)
        self.assertIsNotNone(p.worker);self.assertFalse(p.worker_admitted)
        p=self.super_ready()
        with self.assertRaises(m.Held):p.create_worker(self.worker,lambda:{**dict(p.supervisor),'birth':'darwin:200:1'},creator)
        self.assertFalse(p.worker_attempted)
    def test_duplicate_creation_no_overwrite(self):
        p=self.super_ready();before=p.supervisor
        with self.assertRaises(m.Held):p.create_supervisor(self.supervisor,creator)
        self.assertIs(p.supervisor,before);self.assertEqual(self.events.count(('supervisor',1)),1)
    def test_original_time_bounds_and_detached(self):
        for name in ('invocation_deadline_ns','exchange_deadline_ns'):
            c=context();c[name]+=1
            with self.assertRaises(m.Held):m.OwnerChain(c,clock=lambda:2_000_000_000)
        c=context();p=m.OwnerChain(c,clock=lambda:2_000_000_000);c['creator']['pid']=999;self.assertEqual(p.creator['pid'],101)
    def test_hostile_keys_and_aggregate_bound(self):
        calls=[]
        class Key:
            def __hash__(self):calls.append(1);return 1
            def __eq__(self,v):calls.append(2);return False
        c=context();c.pop('schema');c[Key()]=1;calls.clear()
        with self.assertRaises(m.Held):m.OwnerChain(c,clock=lambda:2_000_000_000)
        self.assertFalse(calls)
        c=context();c['directory']='/'+('\x01'*4095)
        with self.assertRaises(m.Held):m.OwnerChain(c,clock=lambda:2_000_000_000)
    def test_exception_string_not_called_and_clock_sticky(self):
        class Trap(Exception):
            def __str__(self):raise AssertionError('trap')
        p=self.new()
        def fail(c,index):raise Trap('private')
        with self.assertRaises(m.Held) as e:p.retain_two(fail,creator)
        self.assertEqual(e.exception.args,('reservation_response_unknown',))
        p=self.ready();self.now=1_999_999_999
        with self.assertRaises(m.Held):p.create_supervisor(self.supervisor,creator)
        self.assertFalse(p.supervisor_attempted)
    def test_lost_worker_response_no_invented_candidate_or_retry(self):
        p=self.super_ready();calls=[]
        def lost(c,r,parent):calls.append(1);raise RuntimeError('private')
        for _ in range(2):
            with self.assertRaises(m.Held):p.create_worker(lost,lambda:dict(p.supervisor),creator)
        self.assertEqual(calls,[1]);self.assertIsNone(p.worker);self.assertTrue(p.worker_attempted);self.assertFalse(p.worker_admitted)
    def test_relation_failure_preserves_supervisor_and_worker_candidates(self):
        for key,value in [('parent_pid',999),('uid',502),('pid',101)]:
            p=self.ready();reported={**process(102,creator()),key:value}
            with self.assertRaises(m.Held):p.create_supervisor(lambda c,r:reported,creator)
            self.assertEqual(dict(p.supervisor),reported);self.assertFalse(p.supervisor_admitted);self.assertFalse(p.receipt()['native_cleanup_authority']);before=p.supervisor
            with self.assertRaises(m.Held):p.create_supervisor(self.supervisor,creator)
            self.assertIs(p.supervisor,before)
        for key,value in [('parent_pid',101),('uid',502),('pid',102)]:
            p=self.super_ready();reported={**process(103,p.supervisor),key:value}
            with self.assertRaises(m.Held):p.create_worker(lambda c,r,parent:reported,lambda:dict(p.supervisor),creator)
            self.assertEqual(dict(p.worker),reported);self.assertFalse(p.worker_admitted);before=p.worker
            with self.assertRaises(m.Held):p.create_worker(self.worker,lambda:dict(p.supervisor),creator)
            self.assertIs(p.worker,before)
    def test_malformed_shape_keeps_candidate_unknown(self):
        p=self.ready()
        with self.assertRaises(m.Held):p.create_supervisor(lambda c,r:{'pid':102},creator)
        self.assertIsNone(p.supervisor)
if __name__=='__main__':unittest.main()

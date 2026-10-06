"""Real disposable issuer writes; mocked birth/clock and endpoint operations."""
from pathlib import Path
import hashlib
import importlib.util
import os
import sys
import tempfile
import unittest
from types import MappingProxyType

ROOT = Path(__file__).resolve().parents[1]
def load(file, pin=None, folder='lib'):
    p=ROOT/folder/file
    with p.open('rb') as f: raw=f.read(65537)
    if len(raw)>65536 or pin and hashlib.sha256(raw).hexdigest()!=pin: raise RuntimeError('source drift')
    name='bridge_fixture_'+file.replace('-','_').replace('.','_')
    spec=importlib.util.spec_from_loader(name,loader=None)
    module=importlib.util.module_from_spec(spec);module.__file__=str(p);sys.modules[name]=module
    exec(compile(raw,str(p),'exec'),module.__dict__)
    return module
B=load('retained-capability-bridge.py')
L=load('launch-budget.py',B.ISSUER_SHA)
F=load('test_fifo_allocation_wrapper.py',folder='test')

class Tests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.path=str(Path(self.temp.name).resolve());os.chmod(self.path,0o700)
        self.now=1_000_000_000;self.clock=B.SharedClock(lambda:self.now);self.created=self.clock()
        self.token=dict(pid=os.getpid(),uid=os.getuid(),birth='darwin:1234:5',kernel_start_token=17)
        self.owner=L.LaunchBudget(L.Dependencies(clock=self.clock,birth=lambda p,u:self.token['birth']))
        self.ctx=dict(directory=self.path,creator=dict(self.token),created_ns=self.created,invocation_deadline_ns=self.created+120_000_000_000,exchange_deadline_ns=self.created+2_000_000_000)
        self.calls=[]
    def tearDown(self):self.temp.cleanup()
    def bridge(self,observe=None,owner=None):return B.Bridge(L,B.ISSUER_SHA,owner or self.owner,self.clock,self.ctx,observe or (lambda:dict(self.token)))
    def prepare(self,receipts,created,deadline,clock):
        self.calls.append(receipts)
        self.assertEqual((created,deadline),(self.created,self.created+2_000_000_000));self.assertIs(clock,self.clock)
        self.assertEqual([r['counter'] for r in receipts],[1,2]);return True
    def test_actual_issuer_then_mock_preparation(self):
        b=self.bridge();r=b.run(self.prepare)
        self.assertEqual(r['status'],'prepared-mock');self.assertEqual(r['owner_operation_intents'],3)
        self.assertEqual(len(list(Path(self.path).glob('*.json'))),1)
        self.assertEqual(r['first_results_retained'],3);self.assertEqual(r['reservations_admitted'],2)
        self.assertFalse(r['native_authentication']);b.run(self.prepare);self.assertEqual(len(self.calls),1)
    def test_actual_unchanged_preparation_wrapper_mock_join(self):
        ops=F.Ops();prepared=[]
        def prepare(receipts,created,deadline,clock):
            self.assertEqual(self.owner._retained_record['counter'],2)
            w=F.W['Wrapper'](ops,created,deadline,clock,receipts)
            p=F.A['Preparation'](created,deadline,clock,F.P['plan_actions'])
            result=p.run(receipts,w.allocate,w.identity,w.close);prepared.append(result)
            p.teardown(w.identity,w.close);w.cleanup()
            return result['status']=='prepared-metadata'
        self.assertEqual(self.bridge().run(prepare)['status'],'prepared-mock')
        self.assertEqual(len(ops.closed),18);self.assertEqual(len(ops.unlinked),5)
    def test_lost_second_ack_consumes_no_allocation_or_retry(self):
        original=self.owner.reserve_retained;calls=[]
        def reserve(handle):
            calls.append(1);v=original(handle)
            if len(calls)==2:raise RuntimeError('private')
            return v
        self.owner.reserve_retained=reserve;b=self.bridge();r=b.run(self.prepare)
        self.assertEqual(r['status'],'held');self.assertEqual(self.owner._retained_record['counter'],2)
        self.assertEqual(r['first_results_retained'],2);self.assertEqual(self.calls,[])
        b.run(self.prepare);self.assertEqual(len(calls),2)
    def test_late_second_return_retained_before_hold(self):
        old=self.owner.reserve_retained;calls=[]
        def reserve(handle):
            calls.append(1);v=old(handle)
            if len(calls)==2:self.now=self.created+1_500_000_000
            return v
        self.owner.reserve_retained=reserve;b=self.bridge();r=b.run(self.prepare)
        self.assertEqual(r['first_results_retained'],3);self.assertEqual(r['reservations_admitted'],1)
        self.assertEqual(r['reason'],'deadline');self.assertEqual(self.calls,[])
    def test_owner_drift_after_return_retains_first(self):
        old=self.owner.create_retained
        def create(*args,**kwargs):v=old(*args,**kwargs);self.token['kernel_start_token']=18;return v
        self.owner.create_retained=create;b=self.bridge();r=b.run(self.prepare)
        self.assertEqual(r['reason'],'owner_changed');self.assertEqual(r['first_results_retained'],1);self.assertEqual(self.calls,[])
    def test_issuer_record_birth_must_match_independent_creator(self):
        self.owner.deps=L.Dependencies(clock=self.clock,birth=lambda p,u:'darwin:9999:1')
        b=self.bridge();r=b.run(self.prepare)
        self.assertEqual(r['reason'],'owner_changed');self.assertEqual(r['first_results_retained'],1);self.assertEqual(r['reservations_admitted'],0);self.assertEqual(self.calls,[])
    def test_shared_clock_regression_sticky(self):
        b=self.bridge();self.now-=1;r=b.run(self.prepare);self.assertEqual(r['reason'],'clock_unavailable')
        self.now+=2;b.run(self.prepare);self.assertEqual(r['owner_operation_intents'],0)
    def test_unpaired_clock_and_arbitrary_owner_rejected(self):
        other=L.LaunchBudget(L.Dependencies(clock=lambda:self.now,birth=lambda p,u:'darwin:1234:5'))
        with self.assertRaises(B.Held):self.bridge(owner=other)
        with self.assertRaises(B.Held):self.bridge(owner=object())
    def test_crossissuer_spent_handle_and_receipt_only_cannot_reserve(self):
        b=self.bridge();b.run(self.prepare)
        with self.assertRaises(L.Held):self.owner.reserve_retained(b.results[1].handle)
        with self.assertRaises(L.Held):L.LaunchBudget(self.owner.deps).reserve_retained(b.results[-1].handle)
        with self.assertRaises(L.Held):self.owner.reserve_retained(dict(b.receipts[-1]))
    def test_clock_dependency_changed_before_effect_holds(self):
        b=self.bridge();self.owner.deps=L.Dependencies(clock=lambda:self.now,birth=lambda p,u:self.token['birth'])
        r=b.run(self.prepare);self.assertEqual(r['reason'],'issuer_unavailable');self.assertEqual(r['owner_operation_intents'],0)
    def test_original_anchor_not_reset(self):
        self.ctx['created_ns']-=1
        with self.assertRaises(B.Held):self.bridge()
        self.ctx['created_ns']=self.created;self.ctx['exchange_deadline_ns']+=1
        with self.assertRaises(B.Held):self.bridge()
    def test_path_literal_json_escape_aggregate_bound(self):
        self.ctx['directory']='/'+'\x01'*4095
        with self.assertRaises(B.Held):self.bridge()
        self.assertEqual(list(Path(self.path).iterdir()),[])
    def test_unsafe_keys_no_callback_during_intake(self):
        class Key:
            calls=0
            def __hash__(self):self.calls+=1;return 7
            def __eq__(self,other):self.calls+=1;return False
        key=Key();del self.ctx['directory'];self.ctx[key]=1;before=key.calls
        with self.assertRaises(B.Held):self.bridge()
        self.assertEqual(key.calls,before)
    def test_finite_exception_no_string_conversion(self):
        class Bad(B.Held):
            def __str__(self):raise AssertionError('must not stringify')
        self.owner.create_retained=lambda *a,**k:(_ for _ in ()).throw(Bad('private'))
        b=self.bridge();r=b.run(self.prepare);self.assertEqual(r['reason'],'issuer_unavailable');self.assertEqual(r['first_results_retained'],0)
    def test_receipt_proxy_overbound_never_allocates(self):
        old=self.owner.create_retained
        def create(*a,**k):
            v=old(*a,**k);raw=dict(v.receipt);raw['schema']='x'*20000
            return L.RetainedResult(MappingProxyType(raw),v.handle)
        self.owner.create_retained=create;r=self.bridge().run(self.prepare)
        self.assertEqual(r['reason'],'receipt_invalid');self.assertEqual(self.calls,[])

if __name__=='__main__':unittest.main()

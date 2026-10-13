import importlib.util
from pathlib import Path
import unittest
import sys
from types import MappingProxyType
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('pre_reserved',Path(__file__).resolve().parents[1]/'lib/launch-pre-reserved-profile.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def receipt(counter):return {'schema':'temperance.cli-launch-budget.v1','operation':'create' if counter==0 else 'reserve','status':'created' if counter==0 else 'reserved','nonce':'a'*32,'counter':counter,'launch_limit':4,**{f:False for f in m.FLAGS}}
def token():return {'pid':101,'uid':501,'birth':'darwin:100:1'}
def context():return {'directory':'/private/fixture','create_receipt':receipt(0),'creator':token(),'created_ns':1_000_000_000,'invocation_deadline_ns':121_000_000_000,'exchange_deadline_ns':3_000_000_000}
class Test(unittest.TestCase):
    def new(self):self.now=2_000_000_000;self.events=[];return m.PreReservedProfile(context(),clock=lambda:self.now)
    def reserve(self,h):self.events.append('reserve');return receipt(1)
    def create(self,h,r):self.events.append('create');return True
    def ack(self,p):r={k:v for k,v in p.handle.items() if k!='directory'};r.update(schema='temperance.cli-launch-ack.v1',counter=1);return r
    def test_order_supplier_no_second_mutation_and_none_ack(self):
        p=self.new();p.reserve_and_create(self.reserve,self.create,token);self.assertEqual(self.events,['reserve','create']);self.assertEqual(p.receipt_supplier(dict(p.handle)),receipt(1));self.assertIsNone(p.retain_ack(self.ack(p),True));self.assertTrue(p.receipt()['codec_ack_observed']);self.assertFalse(p.receipt()['execution_authorized'])
    def test_lost_reserve_no_create_no_retry(self):
        p=self.new()
        def lost(h):self.events.append('reserve');raise RuntimeError('private')
        for _ in range(2):
            with self.assertRaises(m.Held):p.reserve_and_create(lost,self.create,token)
        self.assertEqual(self.events,['reserve']);self.assertTrue(p.reserve_attempted);self.assertFalse(p.create_attempted)
    def test_bad_reservation_closed_before_create(self):
        for key,v in [('counter',True),('nonce','b'*32),('launch_limit',3),('execution_authorized',True),('status','created')]:
            p=self.new();r=receipt(1);r[key]=v
            with self.assertRaises(m.Held):p.reserve_and_create(lambda h:r,self.create,token)
            self.assertFalse(p.create_attempted)
    def test_creation_lost_response_retains_slot_sticky(self):
        p=self.new()
        def lost(h,r):self.events.append('create');raise RuntimeError('private')
        with self.assertRaises(m.Held):p.reserve_and_create(self.reserve,lost,token)
        self.assertTrue(p.reservation);self.assertTrue(p.create_attempted)
        with self.assertRaises(m.Held):p.reserve_and_create(self.reserve,self.create,token)
        self.assertEqual(self.events,['reserve','create'])
    def test_creator_drift_around_reserve(self):
        p=self.new();calls=[]
        def obs():calls.append(1);return token() if len(calls)==1 else {**token(),'birth':'darwin:100:2'}
        with self.assertRaises(m.Held):p.reserve_and_create(self.reserve,self.create,obs)
        self.assertTrue(p.reservation);self.assertFalse(p.create_attempted)
    def test_late_callback_no_create_no_new_deadline(self):
        p=self.new()
        def late(h):self.now=3_000_000_000;return receipt(1)
        with self.assertRaises(m.Held):p.reserve_and_create(late,self.create,token)
        self.assertEqual(p.deadline,121_000_000_000);self.assertEqual(p.exchange,3_000_000_000);self.assertFalse(p.create_attempted)
    def test_handle_directory_correlated_but_absent_ack(self):
        p=self.new();p.reserve_and_create(self.reserve,self.create,token);h=dict(p.handle);h['directory']='/other'
        with self.assertRaises(m.Held):p.receipt_supplier(h)
        self.assertIsNone(p.ack)
    def test_supplier_once(self):
        p=self.new();p.reserve_and_create(self.reserve,self.create,token);p.receipt_supplier(dict(p.handle))
        with self.assertRaises(m.Held):p.receipt_supplier(dict(p.handle))
        self.assertEqual(self.events,['reserve','create'])
    def test_ack_eof_loss_and_wrong_counter_sticky(self):
        for eof,change in ((False,None),(True,'counter')):
            p=self.new();p.reserve_and_create(self.reserve,self.create,token);p.receipt_supplier(dict(p.handle));a=self.ack(p)
            if change:a[change]=2
            with self.assertRaises(m.Held):p.retain_ack(a,eof)
            with self.assertRaises(m.Held):p.retain_ack(self.ack(p),True)
            self.assertIsNone(p.ack)
    def test_intake_unknown_unicode_bound_and_detached(self):
        for change in ({'directory':'/'+('é'*2048)},{'extra':True},{'creator':{**token(),'extra':1}}):
            c=context();c.update(change)
            with self.assertRaises(m.Held):m.PreReservedProfile(c,clock=lambda:2_000_000_000)
        c=context();p=m.PreReservedProfile(c,clock=lambda:2_000_000_000);c['creator']['birth']='darwin:200:1';c['create_receipt']['counter']=3;self.assertEqual(p.creator['birth'],'darwin:100:1');self.assertEqual(p.created_receipt['counter'],0)
    def test_exception_string_never_called(self):
        class Trap(Exception):
            def __str__(self):raise AssertionError('string trap')
        p=self.new()
        def fail(h):raise Trap('private')
        with self.assertRaises(m.Held) as e:p.reserve_and_create(fail,self.create,token)
        self.assertEqual(e.exception.args,('callback_unavailable',))
    def test_hostile_key_no_hash_or_equality_during_intake(self):
        calls=[]
        class Key:
            def __hash__(self):calls.append('hash');return 1
            def __eq__(self,other):calls.append('eq');return False
        c=context();c.pop('directory');c[Key()]='/private/fixture';calls.clear()
        with self.assertRaises(m.Held):m.PreReservedProfile(c,clock=lambda:2_000_000_000)
        self.assertFalse(calls)
    def test_original_anchor_bounds_not_remaining_ttl(self):
        for key in ('invocation_deadline_ns','exchange_deadline_ns'):
            c=context();c[key]+=1
            with self.assertRaises(m.Held):m.PreReservedProfile(c,clock=lambda:2_000_000_000)
        p=self.new();self.assertEqual(p.deadline-p.created,120_000_000_000);self.assertEqual(p.exchange-p.created,2_000_000_000)
    def test_actual_codec_callback_seams_injected_channel(self):
        source=Path(__file__).resolve().parents[1]/'lib/launch-handle-codec.py';spec=importlib.util.spec_from_file_location('profile_codec',source);codec=importlib.util.module_from_spec(spec);sys.modules[spec.name]=codec;spec.loader.exec_module(codec)
        p=self.new();p.reserve_and_create(self.reserve,self.create,token);bridge=m.TrustedCodecBridge(p);h=dict(p.handle);a=self.ack(p);confirm=dict(a,schema=codec.CONFIRM);events=[]
        class Channel:
            def __init__(self,role,fds,deps):self.role=role;self.reads=iter([h,confirm] if role=='child' else [a])
            def bind(self,h):pass
            def check(self):pass
            def read_frame(self,fd):return next(self.reads)
            def write_frame(self,fd,v):events.append((self.role,'write',v['schema']))
            def eof(self,fd):events.append((self.role,'eof'))
            def close(self,fd):pass
            def finish(self):pass
        with patch.object(codec,'_Channel',Channel):
            self.assertEqual(codec._child_exchange(bridge.reserve)['status'],'metadata-ready')
            self.assertEqual(codec._owner_exchange(h,bridge.retain_ack)['status'],'metadata-ready')
        self.assertTrue(p.receipt()['codec_ack_observed']);self.assertEqual(self.events,['reserve','create']);self.assertLess(events.index(('owner','eof')),events.index(('owner','write',codec.CONFIRM)))
    def test_bridge_rejects_arbitrary_mapping_and_sticky(self):
        p=self.new();p.reserve_and_create(self.reserve,self.create,token);bridge=m.TrustedCodecBridge(p)
        class Mapping:
            def items(self):raise AssertionError('must not invoke')
        with self.assertRaises(m.Held):bridge.reserve(Mapping())
        with self.assertRaises(m.Held):bridge.reserve(MappingProxyType(dict(p.handle)))
    def test_bridge_aggregate_bound_before_serialization(self):
        with self.assertRaises(m.Held):m.trusted_codec_copy({str(i):'x'*4096 for i in range(10)})
        self.assertEqual(m.trusted_codec_copy({'small':'safe'}),{'small':'safe'})
if __name__=='__main__':unittest.main()

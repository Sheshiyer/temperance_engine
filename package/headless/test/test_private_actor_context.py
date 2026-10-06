import copy
import importlib.util
import json
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('private_actor_context',Path(__file__).resolve().parents[1]/'lib/private-actor-context.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def context(worker=False):
    flags={flag:False for flag in m.FLAGS};nonce='a'*32
    def receipt(count):return {'schema':'temperance.cli-launch-budget.v1','operation':'create' if count==0 else 'reserve','status':'created' if count==0 else 'reserved','nonce':nonce,'counter':count,'launch_limit':2,**flags}
    handle={'schema':'temperance.cli-launch-handle.v1','directory':'/private/inert-fixture','nonce':nonce,'expected_counter':int(worker),'launch_limit':2,'invocation_deadline_ns':120000000100,'exchange_deadline_ns':2000000100,**flags}
    value={'schema':'temperance.private-actor-context.v2','role':m.ROLES[int(worker)],'directory':handle['directory'],'creator':{'pid':100,'uid':501,'birth':'darwin:1000:123','kernel_start_token':77},'create_receipt':receipt(0),'supervisor_reservation':receipt(1),'worker_reservation':receipt(2),'handle':handle,'created_ns':100,'invocation_deadline_ns':handle['invocation_deadline_ns'],'exchange_deadline_ns':handle['exchange_deadline_ns'],'marker':'inert-metadata-bootstrap-v2',**flags}
    if worker:value['supervisor']={'pid':101,'uid':501,'birth':'darwin:1001:234','kernel_start_token':78,'parent_pid':100,'parent_uid':501,'parent_birth':'darwin:1000:123'}
    return value

def wire(value):return json.dumps(value,separators=(',',':')).encode()

class Test(unittest.TestCase):
    def test_both_role_roundtrip_and_immutable_private_output(self):
        for worker in (False,True):
            value=context(worker);frame=m.encode_frame(value,101);decoder=m.ContextFrame(value,101)
            self.assertIsNone(decoder.feed(frame[:7],False,102));result=decoder.feed(frame[7:],True,103)
            self.assertEqual(dict(result['handle']),value['handle']);self.assertEqual(len(result),16 if worker else 15)
            with self.assertRaises(TypeError):result['creator']['pid']=9
            self.assertEqual(decoder.raw,bytearray());self.assertEqual(decoder.receipt()['status'],'decoded')
    def test_expected_context_independent_snapshot_and_mismatch(self):
        expected=context(True);decoder=m.ContextFrame(expected,101);expected['creator']['pid']=999
        frame=m.encode_frame(context(True),101);self.assertEqual(decoder.feed(frame,True,102)['creator']['pid'],100)
        changed=context(True);changed['supervisor']['kernel_start_token']=88
        with self.assertRaisesRegex(m.Held,'context_mismatch'):m.decode_payload(wire(changed),context(True),101)
    def test_retained_expected_context_nested_mutation_rejected(self):
        decoder=m.ContextFrame(context(True),101)
        for record,key,value in ((decoder.expected,'exchange_deadline_ns',99999999999),(decoder.expected['creator'],'pid',999),(decoder.expected['handle'],'nonce','b'*32)):
            with self.assertRaises(TypeError):record[key]=value
        result=decoder.feed(m.encode_frame(context(True),101),True,102)
        self.assertEqual(result['creator']['pid'],100);self.assertEqual(result['handle']['nonce'],'a'*32)
    def test_shape_counter_nonce_flag_and_unknown_fields(self):
        for record,key,value in [('handle','expected_counter',True),('worker_reservation','counter',1),('supervisor_reservation','nonce','b'*32),('create_receipt','launch_limit',4),('handle','execution_authorized',True)]:
            c=context(True);c[record][key]=value
            with self.assertRaises(m.Held):m.encode_frame(c,101)
        c=context();c['supervisor']=context(True)['supervisor']
        with self.assertRaises(m.Held):m.encode_frame(c,101)
    def test_wrong_relation_retention_remains_owner_chain_responsibility(self):
        for key,value in [('parent_pid',999),('parent_uid',502),('parent_birth','darwin:2000:0'),('uid',502),('pid',100)]:
            c=context(True);c['supervisor'][key]=value
            with self.assertRaisesRegex(m.Held,'context_relation_invalid'):m.encode_frame(c,101)
    def test_original_anchor_expiry_and_no_reset(self):
        c=context()
        with self.assertRaisesRegex(m.Held,'context_stale'):m.encode_frame(c,c['exchange_deadline_ns'])
        c['exchange_deadline_ns']+=1;c['handle']['exchange_deadline_ns']+=1
        with self.assertRaises(m.Held):m.encode_frame(c,101)
        decoder=m.ContextFrame(context(),101);decoder.feed(b'\x00',False,102)
        with self.assertRaisesRegex(m.Held,'context_stale'):decoder.feed(b'',False,2000000100)
        self.assertFalse(decoder.raw)
    def test_exact_byte_boundary_before_decode(self):
        c=context();raw=wire(c);padded=raw+b' '*(16384-len(raw))
        self.assertEqual(m.decode_payload(padded,c,101)['role'],m.ROLES[0])
        with self.assertRaisesRegex(m.Held,'wire_bound'):m.decode_payload(padded+b' ',c,101)
        decoder=m.ContextFrame(c,101)
        with self.assertRaisesRegex(m.Held,'frame_bound'):decoder.feed((16385).to_bytes(4,'big'),False,102)
        self.assertFalse(decoder.raw)
    def test_prefix_admitted_before_any_combined_payload_retention(self):
        class ObservedBuffer(bytearray):
            def __init__(self):super().__init__();self.extends=[]
            def extend(self,value):self.extends.append(len(value));super().extend(value)
        for prefix,reason in ((16385,'frame_bound'),(1,'frame_extra')):
            decoder=m.ContextFrame(context(),101);buffer=ObservedBuffer();decoder.raw=buffer
            with self.assertRaisesRegex(m.Held,reason):decoder.feed(prefix.to_bytes(4,'big')+b'x'*100,True,102)
            self.assertEqual(buffer.extends,[4]);self.assertFalse(buffer)
        decoder=m.ContextFrame(context(),101);buffer=ObservedBuffer();decoder.raw=buffer
        decoder.feed(b'\x00\x00',False,102)
        with self.assertRaisesRegex(m.Held,'frame_bound'):decoder.feed(b'\x40\x01'+b'x'*100,True,103)
        self.assertEqual(buffer.extends,[2,2]);self.assertFalse(buffer)
    def test_utf8_path_limit_and_escaped_encoder_bound(self):
        for path in ('/'+'a'*4095,'/'+'é'*2047):
            c=context();c['directory']=path;c['handle']['directory']=path
            frame=m.encode_frame(c,101);self.assertLessEqual(len(frame),16388)
            self.assertEqual(m.decode_payload(frame[4:],c,101)['directory'],path)
        c=context();c['directory']='/'+'é'*2048;c['handle']['directory']=c['directory']
        with self.assertRaises(m.Held):m.encode_frame(c,101)
        c=context();c['directory']='/'+'\x01'*4095;c['handle']['directory']=c['directory']
        with self.assertRaisesRegex(m.Held,'context_bound'):m.encode_frame(c,101)
    def test_duplicate_escaped_keys_malformed_unicode_numbers(self):
        c=context();raw=wire(c);duplicate=raw.replace(b'"pid":100',b'"pid":100,"p\\u0069d":100',1)
        with self.assertRaisesRegex(m.Held,'wire_duplicate'):m.decode_payload(duplicate,c,101)
        for raw in (b'\xff',b'{"x":1.1}',b'{"x":NaN}',b'{"x":123456789012345678901}'):
            with self.assertRaises(m.Held):m.decode_payload(raw,c,101)
    def test_depth_node_budget_before_parser_promotion(self):
        m.prescan('[[[0]]]')
        with self.assertRaisesRegex(m.Held,'wire_bound'):m.prescan('[[[[0]]]]')
        m.prescan('['+','.join('0' for _ in range(191))+']')
        with self.assertRaisesRegex(m.Held,'wire_bound'):m.prescan('['+','.join('0' for _ in range(192))+']')
    def test_partial_extra_repeat_and_backwards_sticky_clear(self):
        c=context();frame=m.encode_frame(c,101)
        for chunk,reason in ((frame[:-1],'frame_incomplete'),(frame+b'\n','frame_extra'),(frame+frame,'frame_extra')):
            decoder=m.ContextFrame(c,101)
            with self.assertRaisesRegex(m.Held,reason):decoder.feed(chunk,True,102)
            self.assertFalse(decoder.raw)
            with self.assertRaisesRegex(m.Held,reason):decoder.feed(frame,True,103)
        decoder=m.ContextFrame(c,101);decoder.feed(frame,True,102)
        with self.assertRaisesRegex(m.Held,'frame_already_consumed'):decoder.feed(b'',True,103)
        decoder=m.ContextFrame(c,101);decoder.feed(frame[:4],False,103)
        with self.assertRaisesRegex(m.Held,'frame_invalid'):decoder.feed(frame[4:],True,102)
    def test_hostile_inputs_no_mapping_or_key_callbacks(self):
        calls=[]
        class Key:
            def __hash__(self):calls.append('hash');return hash('role')
            def __eq__(self,value):calls.append('eq');return True
        c=context();del c['role'];c[Key()]=m.ROLES[0];calls.clear()
        with self.assertRaises(m.Held):m.encode_frame(c,101)
        self.assertFalse(calls)
        class Mapping:
            def get(self,*args):calls.append('get');raise RuntimeError()
        with self.assertRaises(m.Held):m.encode_frame(Mapping(),101)
        self.assertFalse(calls)
    def test_projection_redacted_false_authority(self):
        decoder=m.ContextFrame(context(True),101);receipt=dict(decoder.receipt());encoded=json.dumps(receipt)
        for secret in ('private/inert','darwin:', 'kernel_start_token','nonce','creator','supervisor_reservation'):
            self.assertNotIn(secret,encoded)
        for flag in (*m.FLAGS,'native_authentication','native_cleanup_authority'):self.assertIs(receipt[flag],False)
        self.assertEqual(receipt['role'],m.ROLES[1])
    def test_cancellation_sticky_private_clear_no_replacement(self):
        c=context();decoder=m.ContextFrame(c,101);decoder.feed(m.encode_frame(c,101)[:9],False,102)
        with self.assertRaisesRegex(m.Held,'frame_cancelled'):decoder.cancel()
        self.assertFalse(decoder.raw)
        with self.assertRaisesRegex(m.Held,'frame_cancelled'):decoder.feed(m.encode_frame(c,101),True,103)

if __name__=='__main__':unittest.main()

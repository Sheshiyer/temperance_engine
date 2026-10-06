import importlib.util
import json
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('bootstrap_context',Path(__file__).resolve().parents[1]/'lib/pre-reserved-bootstrap-context.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def context():
    flags={f:False for f in m.FLAGS};base={'schema':'temperance.cli-launch-budget.v1','nonce':'a'*32,'launch_limit':1,**flags}
    return {'schema':'temperance.pre-reserved-bootstrap-context.v1','creator':{'pid':101,'uid':501,'birth':'darwin:100:1'},'create_receipt':{**base,'operation':'create','status':'created','counter':0},'reservation_receipt':{**base,'operation':'reserve','status':'reserved','counter':1},'handle':{'schema':'temperance.cli-launch-handle.v1','directory':'/private/fixture','nonce':'a'*32,'expected_counter':0,'launch_limit':1,'invocation_deadline_ns':121_000_000_000,'exchange_deadline_ns':3_000_000_000,**flags},'created_ns':1_000_000_000,'point_deadline_ns':3_000_000_000,'marker':'inert-metadata-bootstrap-v1',**flags}
class Test(unittest.TestCase):
    def test_frame_fragment_exact_eof_immutable(self):
        c=context();frame=m.encode_frame(c,2_000_000_000);reader=m.ContextFrame()
        for offset in range(0,len(frame),7):self.assertIsNone(reader.feed(frame[offset:offset+7],False,2_000_000_000))
        result=reader.feed(b'',True,2_000_000_000);self.assertEqual(dict(result['creator']),c['creator']);self.assertFalse(result['execution_authorized']);self.assertFalse(reader.raw)
        with self.assertRaises(TypeError):result['creator']['pid']=200
        with self.assertRaises(m.Held):reader.feed(b'',True,2_000_000_000)
    def test_exact_counter_shape_and_false_flags(self):
        for field,value in [('counter',True),('counter',2),('nonce','b'*32),('launch_limit',2),('operation','create'),('status','created'),('execution_authorized',True)]:
            c=context();c['reservation_receipt'][field]=value
            with self.assertRaises(m.Held):m.encode_frame(c,2_000_000_000)
    def test_original_anchor_bounds_no_renew(self):
        for target,key in [('top','point_deadline_ns'),('handle','invocation_deadline_ns'),('handle','exchange_deadline_ns')]:
            c=context();record=c if target=='top' else c[target];record[key]+=1
            with self.assertRaises(m.Held):m.encode_frame(c,2_000_000_000)
        c=context();self.assertTrue(m.encode_frame(c,2_999_999_999))
        with self.assertRaises(m.Held):m.encode_frame(c,3_000_000_000)
        with self.assertRaises(m.Held):m.encode_frame(c,999_999_999)
    def test_duplicate_nested_and_top_before_promotion(self):
        raw=json.dumps(context()).encode()
        for item in (raw.replace(b'"counter": 1',b'"counter": 1,"counter":0'),raw.replace(b'"marker":',b'"schema":"other","marker":')):
            with self.assertRaises(m.Held) as e:m.decode_payload(item,2_000_000_000)
            self.assertEqual(e.exception.args,('wire_duplicate',))
    def test_prescan_depth_nodes_and_integer_before_json(self):
        for raw in (b'[[[[1]]]]',b'['+b','.join([b'1']*129)+b']',b'1'*21,b'1.5',b'NaN',b'Infinity'):
            with self.assertRaises(m.Held):m.decode_payload(raw,2_000_000_000)
    def test_invalid_utf8_and_surrogate_encoder(self):
        with self.assertRaises(m.Held):m.decode_payload(b'\xff',2_000_000_000)
        c=context();c['handle']['directory']='/\ud800'
        with self.assertRaises(m.Held):m.encode_frame(c,2_000_000_000)
    def test_birth_pid_uid_nonce_marker_closed(self):
        for target,key,value in [('creator','birth','darwin:0:1'),('creator','birth','darwin:1:1000000'),('creator','pid',True),('creator','uid',2**32),('handle','nonce','a'*33),('top','marker','other')]:
            c=context();(c if target=='top' else c[target])[key]=value
            with self.assertRaises(m.Held):m.encode_frame(c,2_000_000_000)
    def test_plain_closed_keys_no_hostile_hash_callbacks(self):
        calls=[]
        class Key:
            def __hash__(self):calls.append('hash');return 1
            def __eq__(self,value):calls.append('eq');return False
        c=context();c.pop('marker');c[Key()]='x';calls.clear()
        with self.assertRaises(m.Held):m.encode_frame(c,2_000_000_000)
        self.assertFalse(calls)
    def test_frame_bounds_extra_partial_and_sticky(self):
        for wire in ((16385).to_bytes(4,'big'),b'\x00',m.encode_frame(context(),2_000_000_000)+b'x'):
            r=m.ContextFrame()
            with self.assertRaises(m.Held):r.feed(wire,True,2_000_000_000)
            self.assertFalse(r.raw)
            with self.assertRaises(m.Held):r.feed(m.encode_frame(context(),2_000_000_000),True,2_000_000_000)
    def test_expiry_during_fragments_and_backwards_time(self):
        frame=m.encode_frame(context(),2_000_000_000);r=m.ContextFrame();r.feed(frame,False,2_000_000_000)
        with self.assertRaises(m.Held):r.feed(b'',True,3_000_000_000)
        r=m.ContextFrame();r.feed(frame[:4],False,2_000_000_000)
        with self.assertRaises(m.Held):r.feed(b'',False,1_999_999_999)
    def test_literal_utf8_and_preencoding_aggregate(self):
        c=context();c['handle']['directory']='/'+('é'*1000);wire=m.encode_frame(c,2_000_000_000);self.assertIn('é'.encode(),wire);self.assertTrue(m.decode_payload(wire[4:],2_000_000_000))
        c=context();c['handle']['directory']='/'+('\x01'*4095)
        with self.assertRaises(m.Held) as e:m.encode_frame(c,2_000_000_000)
        self.assertEqual(e.exception.args,('context_bound',))
    def test_no_mapping_or_unknown_nested_keys(self):
        c=context();c['creator']['extra']=1
        with self.assertRaises(m.Held):m.encode_frame(c,2_000_000_000)
        class Mapping:
            def items(self):raise AssertionError('trap')
        with self.assertRaises(m.Held):m.encode_frame(Mapping(),2_000_000_000)
if __name__=='__main__':unittest.main()

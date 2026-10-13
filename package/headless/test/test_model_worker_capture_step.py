import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('capture_step',Path(__file__).resolve().parents[1]/'lib/model-worker-capture-step.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Adapter:
    def __init__(self):
        self.keys={n:(1,i,4096) for i,n in enumerate(m.NAMES)};self.data={n:[] for n in m.NAMES};self.reads=[];self.closed=[];self.keepers=0;self.aborted=0
        self.term={'exited':False,'exit_code':None,'final_write_completed':False}
    def identity(self,n):return self.keys[n]
    def read(self,n,maximum):
        self.reads.append((n,maximum))
        return self.data[n].pop(0) if self.data[n] else None
    def terminal(self):return dict(self.term)
    def close_keeper(self):self.keepers+=1;return True
    def abort_keeper(self):self.aborted+=1;return True
    def close(self,n):self.closed.append(n)

class Tests(unittest.TestCase):
    def new(self):
        self.now=[1_000_000_000];self.a=Adapter()
        return m.CaptureStep(self.a,dict(self.a.keys),self.now[0]+10_000_000_000,clock=lambda:self.now[0])
    def complete(self):self.a.term={'exited':True,'exit_code':0,'final_write_completed':True}
    def test_three_reads_nonblocking_and_exact_payload(self):
        b=self.new();self.a.data={'stdout':[b'{}\n',b''],'stderr':[b'warning',b''],'final':[b'exact',b'']}
        self.assertEqual(b.step()['status'],'pending');self.assertEqual(len(self.a.reads),3)
        self.complete();self.assertEqual(b.step()['status'],'completed');self.assertEqual(b.payload()['final'],b'exact');self.assertEqual(self.a.keepers,1)
    def test_prewriter_final_eof_not_finalized_empty(self):
        b=self.new();self.a.data={'stdout':[b''],'stderr':[b''],'final':[b'',b'']}
        self.assertEqual(b.step()['status'],'pending');self.assertFalse(b.eof['final']);self.assertEqual(self.a.keepers,0)
        self.complete();self.assertEqual(b.step()['status'],'completed');self.assertEqual(b.payload()['final'],b'')
    def test_no_exit_only_proof(self):
        b=self.new();self.a.term={'exited':True,'exit_code':0,'final_write_completed':False};r=b.step()
        self.assertEqual(r['reason'],'terminal_uncertain');self.assertEqual(self.a.keepers,0);self.assertEqual(set(self.a.closed),set(m.NAMES));self.assertEqual(self.a.aborted,1)
    def test_identity_never_overwritten_or_replacement_closed(self):
        b=self.new();retained=b.keys['stdout'];self.a.keys['stdout']=(2,9,4096)
        self.assertEqual(b.step()['reason'],'identity_changed');self.assertEqual(b.keys['stdout'],retained);self.assertNotIn('stdout',self.a.closed);self.assertIn('stderr',self.a.closed)
    def test_constructor_invalid_deadline_and_duplicate_cleanup(self):
        a=Adapter();b=m.CaptureStep(a,dict(a.keys),1,clock=lambda:1);self.assertEqual(b.status,'held');self.assertEqual(len(a.closed),3)
        a=Adapter();a.keys['stderr']=a.keys['stdout'];b=m.CaptureStep(a,dict(a.keys),1000,clock=lambda:1);self.assertEqual(b.status,'held');self.assertEqual(len(a.closed),2)
    def test_fragment_frame_bound_before_append(self):
        b=self.new();self.a.data['stdout']=[b'x'*m.CHUNK]*4+[b'x'];
        for _ in range(4):self.assertEqual(b.step()['status'],'pending')
        r=b.step();self.assertEqual(r['reason'],'frame_bound');self.assertTrue(all(not x for x in b.buffers.values()))
    def test_stream_aggregate_bounds_before_retention(self):
        b=self.new();b.buffers['final']=bytearray(m.CAPS['final']);self.a.data['final']=[b'x'];r=b.step();self.assertEqual(r['reason'],'capture_bound');self.assertEqual(self.a.reads[-1][1],1)
        b=self.new();b.buffers['stdout']=bytearray(m.CAPS['stdout']);b.buffers['stderr']=bytearray(m.CAPS['stderr']);self.a.data['final']=[b'x'];self.assertEqual(b.step()['reason'],'capture_bound')
    def test_partial_eof_and_terminal_mismatch(self):
        b=self.new();self.complete();self.a.data={'stdout':[b'partial',b''],'stderr':[b''],'final':[b'']};b.step();self.assertEqual(b.step()['reason'],'partial_frame')
        b=self.new();self.complete();b.step();self.a.term['exit_code']=1;self.assertEqual(b.step()['reason'],'terminal_changed')
    def test_late_poll_callback_and_drain(self):
        b=self.new();self.now[0]+=m.POLL+1;self.assertEqual(b.step()['reason'],'poll_late');self.assertFalse(self.a.reads)
        b=self.new();fn=self.a.read
        def read(*args):r=fn(*args);self.now[0]+=m.POLL+1;return r
        self.a.read=read;self.assertEqual(b.step()['reason'],'poll_late')
        b=self.new();self.complete();b.step()
        for _ in range(4):self.now[0]+=m.POLL;b.step()
        self.now[0]+=m.POLL;self.assertEqual(b.step()['reason'],'drain_deadline')
    def test_cleanup_independent_failures_and_late_success_hold(self):
        b=self.new()
        def close(n):
            self.a.closed.append(n)
            if n=='stdout':raise OSError('private')
        self.a.close=close;self.a.term={'exited':True,'exit_code':1,'final_write_completed':False};b.step();self.assertEqual(len(self.a.closed),3)
        b=self.new();self.a.data={'stdout':[b'{}\n',b''],'stderr':[b'private diagnostic',b''],'final':[b'private final',b'']};b.step();self.complete();fn=self.a.close
        def late(n):fn(n);self.now[0]+=m.POLL+1
        self.a.close=late;self.assertEqual(b.step()['status'],'held')
        self.assertTrue(all(not value for value in b.buffers.values()))
        with self.assertRaises(m.Held):b.payload()
        self.assertEqual(b.coordination_step()['status'],'failed')
    def test_caps_immutable(self):
        with self.assertRaises(TypeError):m.CAPS['stdout']=1
    def test_projection_matches_coordination_seam(self):
        b=self.new();self.assertEqual(set(b.coordination_step()),{'status','terminal_observed','exit_code','final_write_completed'})
        b.cancelled=lambda:True;self.assertEqual(b.coordination_step()['status'],'failed')

if __name__=='__main__':unittest.main()

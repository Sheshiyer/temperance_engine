import errno
import fcntl
import importlib.util
import os
from pathlib import Path
import stat
from types import SimpleNamespace
import unittest

root=Path(__file__).resolve().parents[1]/'lib'
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,root/path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
m=load('capture_fd','model-worker-capture-fd.py');capture=load('capture_fd_step','model-worker-capture-step.py')
FDS={'stdout':10,'stderr':11,'final':12,'keeper':13}

class Ops:
    def __init__(self):
        self.keys={fd:(1,fd if fd!=13 else 12,stat.S_IFIFO) for fd in FDS.values()};self.fl={fd:os.O_WRONLY if fd==13 else os.O_RDONLY for fd in FDS.values()};self.df={fd:0 for fd in FDS.values()};self.close_calls=[];self.read_calls=[];self.stat_calls=[];self.mutations=[];self.data={fd:[] for fd in FDS.values()};self.badclose=None
    def fstat(self,fd):
        self.stat_calls.append(fd)
        if fd not in self.keys:raise OSError('private')
        dev,ino,mode=self.keys[fd];return SimpleNamespace(st_dev=dev,st_ino=ino,st_mode=mode)
    def getfl(self,fd):return self.fl[fd]
    def getfd(self,fd):return self.df[fd]
    def setfl(self,fd,value):self.mutations.append(('fl',fd));self.fl[fd]=value
    def setfd(self,fd,value):self.mutations.append(('fd',fd));self.df[fd]=value
    def read(self,fd,maximum):
        self.read_calls.append((fd,maximum))
        if self.data[fd]:return self.data[fd].pop(0)
        raise BlockingIOError(errno.EAGAIN,'private')
    def close(self,fd):
        self.close_calls.append(fd)
        if fd==self.badclose:raise OSError('private')
        self.keys.pop(fd,None)

class Tests(unittest.TestCase):
    def new(self,ops=None,descriptors=None):
        self.now=[1_000_000_000];self.ops=Ops() if ops is None else ops;self.term={'exited':False,'exit_code':None,'final_write_completed':False}
        return m.FDAdapter(FDS if descriptors is None else descriptors,self.now[0]+10_000_000_000,lambda:dict(self.term),syscalls=self.ops,clock=lambda:self.now[0])
    def test_flags_nonblock_cloexec_read_zero_wait(self):
        a=self.new();self.assertIsNone(a.reason)
        for fd in FDS.values():self.assertTrue(self.ops.fl[fd]&os.O_NONBLOCK);self.assertTrue(self.ops.df[fd]&fcntl.FD_CLOEXEC)
        self.assertIsNone(a.read('stdout',1));self.ops.data[10]=[b''];self.assertEqual(a.read('stdout',1),b'')
        with self.assertRaises(m.Held):a.read('stdout',16385)
        self.assertEqual(len(self.ops.read_calls),2)
    def test_invalid_first_valid_peers_no_leak(self):
        fd=dict(FDS);fd['stdout']=-1;a=self.new(descriptors=fd)
        self.assertEqual(a.reason,'descriptor_invalid');self.assertEqual(set(self.ops.close_calls),{11,12,13})
        ops=Ops();ops.keys.pop(10);a=self.new(ops);self.assertEqual(set(self.ops.close_calls),{11,12,13})
    def test_duplicate_descriptors_and_wrong_keeper(self):
        fd=dict(FDS);fd['stderr']=10;a=self.new(descriptors=fd);self.assertEqual(self.ops.close_calls.count(10),1)
        ops=Ops();ops.keys[13]=(1,999,stat.S_IFIFO);a=self.new(ops);self.assertEqual(a.reason,'descriptor_identity')
    def test_type_mode_and_initial_flags_retained(self):
        ops=Ops();ops.fl[10]=os.O_RDWR;a=self.new(ops);self.assertEqual(a.reason,'descriptor_mode')
        ops=Ops();ops.keys[10]=(1,10,stat.S_IFREG);a=self.new(ops);self.assertEqual(a.reason,'descriptor_type')
        a=self.new();self.assertEqual(a.initial_fl[10],os.O_RDONLY);self.assertEqual(a.initial_fd[10],0)
    def test_replacement_before_mutation_not_overwritten_or_closed(self):
        ops=Ops();fn=ops.getfl
        def getfl(fd):
            value=fn(fd)
            if fd==13:ops.keys[10]=(2,99,stat.S_IFIFO)
            return value
        ops.getfl=getfl;a=self.new(ops);self.assertEqual(a.reason,'identity_changed');self.assertNotIn(10,ops.close_calls);self.assertFalse(ops.mutations);self.assertEqual(a.keys[10],(1,10,stat.S_IFIFO))
    def test_replacement_during_read_discards_and_cleanup(self):
        a=self.new();fn=self.ops.read
        def read(fd,maximum):self.ops.keys[fd]=(2,99,stat.S_IFIFO);return b'private'
        self.ops.read=read
        with self.assertRaises(m.Held):a.read('stdout',10)
        self.assertNotIn(10,self.ops.close_calls);self.assertEqual(set(self.ops.close_calls),{11,12,13})
    def test_expired_constructor_zero_flags_and_finite_cleanup(self):
        ops=Ops();a=m.FDAdapter(FDS,1,lambda:None,syscalls=ops,clock=lambda:1)
        self.assertEqual(a.reason,'deadline');self.assertFalse(ops.mutations);self.assertEqual(len(ops.close_calls),4)
        before=len(ops.stat_calls);a.teardown();self.assertEqual(len(ops.stat_calls),before)
    def test_close_exception_once_continue_peers(self):
        a=self.new();self.ops.badclose=10;before=len(self.ops.stat_calls);a.teardown()
        self.assertEqual(len(self.ops.stat_calls)-before,4);self.assertEqual(len(self.ops.close_calls),4)
        with self.assertRaises(m.Held):a.close('stdout')
        a.teardown();self.assertEqual(self.ops.close_calls.count(10),1)
    def test_flags_changed_hold(self):
        a=self.new();self.ops.fl[10]=os.O_RDWR
        with self.assertRaises(m.Held):a.read('stdout',1)
        self.assertFalse(self.ops.read_calls);self.assertEqual(a.reason,'flags_changed')
    def test_actual_capture_step_with_mocked_syscalls(self):
        a=self.new();keys={n:a.keys[FDS[n]] for n in FDS if n!='keeper'}
        c=capture.CaptureStep(a,keys,a.deadline,clock=lambda:self.now[0])
        self.ops.data[10]=[b'{',b'}\n',b''];self.ops.data[11]=[b'private stderr',b''];self.ops.data[12]=[b'exact final',b'']
        c.step();c.step();self.ops.data[12].append(b'');self.term={'exited':True,'exit_code':0,'final_write_completed':True};r=c.step()
        self.assertEqual(r['status'],'completed');self.assertEqual(c.payload()['final'],b'exact final');self.assertEqual(set(self.ops.close_calls),set(FDS.values()))
    def test_expired_outer_identity_automatically_closes_original_peers(self):
        a=self.new();c=capture.CaptureStep(a,{n:a.keys[FDS[n]] for n in ('stdout','stderr','final')},a.deadline,clock=lambda:self.now[0])
        self.now[0]=a.deadline
        r=c.step();self.assertEqual(r['status'],'held');self.assertEqual(set(self.ops.close_calls),set(FDS.values()))
        before=list(self.ops.close_calls);a.teardown();self.assertEqual(self.ops.close_calls,before)
    def test_capture_close_failure_holds_completion(self):
        a=self.new();c=capture.CaptureStep(a,{n:a.keys[FDS[n]] for n in ('stdout','stderr','final')},a.deadline,clock=lambda:self.now[0])
        self.term={'exited':True,'exit_code':0,'final_write_completed':True};self.ops.data={fd:[b''] for fd in FDS.values()};self.ops.badclose=10
        r=c.step();self.assertEqual(r['status'],'held');self.assertEqual(set(self.ops.close_calls),set(FDS.values()));self.assertEqual(self.ops.close_calls.count(10),1)
    def test_capture_step_bound_remaining_probe_and_held_clear(self):
        a=self.new();c=capture.CaptureStep(a,{n:a.keys[FDS[n]] for n in ('stdout','stderr','final')},a.deadline,clock=lambda:self.now[0]);c.buffers['final']=bytearray(capture.CAPS['final']);self.ops.data[12]=[b'x']
        r=c.step();self.assertEqual(r['reason'],'capture_bound');self.assertTrue(all(not b for b in c.buffers.values()));self.assertIn((12,1),self.ops.read_calls)

if __name__=='__main__':unittest.main()

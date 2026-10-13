import ctypes
import importlib.util
import os
from pathlib import Path
import sys
import time
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('native_metadata',Path(__file__).resolve().parents[1]/'lib/model-worker-native-observation.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Mock:
    def __init__(self):self.bad=None;self.status=4;self.start=777;self.birth=100;self.level=2;self.calls=0
    def pidinfo(self,pid,flavor,arg,pointer,size):
        self.calls+=1
        if flavor==3:
            v=ctypes.cast(pointer,ctypes.POINTER(m.BsdInfo)).contents
            v.pid=pid;v.uid=501;v.ppid=101;v.status=self.status;v.start_sec=self.birth;v.start_usec=1
        else:
            v=ctypes.cast(pointer,ctypes.POINTER(m.TaskInfo)).contents;v.resident_size=1234
        return True if self.bad=='bool' else size-1 if self.bad=='short' else size
    def rusage(self,pid,flavor,pointer):
        v=ctypes.cast(pointer,ctypes.POINTER(m.RusageInfoV0)).contents
        v.start=self.start;v.exit=1 if self.bad=='exit' else 0;v.physical=2345
        if self.bad=='change':self.birth=200
        return True if self.bad=='rbool' else -1 if self.bad=='rerror' else 0
    def sysctl(self,name,pointer,size,new,newsize):
        ctypes.cast(pointer,ctypes.POINTER(ctypes.c_int)).contents.value=self.level
        if self.bad=='psize':ctypes.cast(size,ctypes.POINTER(ctypes.c_size_t)).contents.value=1
        return -1 if self.bad=='perror' else 0

class Tests(unittest.TestCase):
    def new(self):
        self.mock=Mock();self.now=[1]
        return m.Backend(1000,clock=lambda:self.now[0],pidinfo=self.mock.pidinfo,rusage=self.mock.rusage,sysctl=self.mock.sysctl,platform='darwin')
    def test_constructor_expired_does_not_load_and_failures_redacted(self):
        with patch.object(m.ctypes,'CDLL') as loader:
            with self.assertRaisesRegex(m.Held,'^deadline$'):m.Backend(1,clock=lambda:1,platform='darwin')
            loader.assert_not_called()
        with patch.object(m.ctypes,'CDLL',side_effect=OSError('private loader payload')):
            with self.assertRaisesRegex(m.Held,'^native_unavailable$'):m.Backend(1000,clock=lambda:1,platform='darwin')
        with patch.object(m.ctypes,'CDLL') as loader:
            for deadline in (2**63,120_000_000_002):
                with self.assertRaises(m.Held):m.Backend(deadline,clock=lambda:1,platform='darwin')
            loader.assert_not_called()
    def test_constructor_loader_overruns_retained_deadline(self):
        now=[1]
        def load(*args,**kwargs):now[0]=1000;return object()
        with patch.object(m.ctypes,'CDLL',side_effect=load) as loader:
            with self.assertRaisesRegex(m.Held,'^deadline$'):m.Backend(1000,clock=lambda:now[0],platform='darwin')
            self.assertEqual(loader.call_count,1)
    def test_fixed_sdk_layout(self):self.assertEqual(m.layout(),(136,120,128,96,8,96,72,80,88))
    def test_valid_sandwich_and_start_retained(self):
        b=self.new();expected=b.identity(102,501);usage=b.sample(expected)
        self.assertEqual(usage['rss_bytes'],1234);self.assertEqual(usage['physical_bytes'],2345)
        self.mock.start=778
        with self.assertRaises(m.Held):b.sample(expected)
        self.assertEqual(next(iter(b.starts.values())),777)
    def test_bad_sizes_states_results_exit(self):
        for bad in ('bool','short','rbool','rerror','exit','change'):
            b=self.new();expected=b.identity(102,501);self.mock.bad=bad
            with self.assertRaises(m.Held):b.sample(expected)
        for state in (0,1,5,6):
            b=self.new();self.mock.status=state
            with self.assertRaises(m.Held):b.identity(102,501)
    def test_uid_pid_parent_drift(self):
        b=self.new()
        with self.assertRaises(m.Held):b.identity(102,502)
        with self.assertRaises(m.Held):b.identity(True,501)
        expected=b.identity(102,501);expected['parent_pid']=999
        with self.assertRaises(m.Held):b.sample(expected)
    def test_retained_pid_birth_not_replaced_and_targets_bounded(self):
        b=self.new();e=b.identity(102,501);b.sample(e)
        self.mock.birth=200;replacement=b.identity(102,501)
        with self.assertRaises(m.Held):b.sample(replacement)
        self.mock.birth=100;b.sample(b.identity(103,501))
        with self.assertRaises(m.Held):b.sample(b.identity(104,501))
        self.assertEqual(len(b.starts),2)
        with self.assertRaises(m.Held):m.Backend(1000,pidinfo=self.mock.pidinfo,platform='darwin')
    def test_kernel_zero(self):
        b=self.new();expected=b.identity(102,501);self.mock.start=0
        with self.assertRaises(m.Held):b.sample(expected)
    def test_pressure_closed_levels_size(self):
        for level,status in ((1,'normal'),(2,'host_pressure_elevated'),(4,'host_pressure_elevated'),(0,'host_pressure_unavailable'),(3,'host_pressure_unavailable')):
            b=self.new();self.mock.level=level;self.assertEqual(b.pressure(),status)
        for bad in ('psize','perror'):
            b=self.new();self.mock.bad=bad;self.assertEqual(b.pressure(),'host_pressure_unavailable')
    def test_deadline_and_backwards(self):
        b=self.new();self.now[0]=1000
        with self.assertRaises(m.Held):b.identity(102,501)
        self.assertEqual(self.mock.calls,0)
        b=self.new();self.now[0]=0
        with self.assertRaises(m.Held):b.pressure()
    def test_late_syscall_held(self):
        b=self.new();fn=b.pidinfo
        def late(*args):r=fn(*args);self.now[0]=1000;return r
        b.pidinfo=late
        with self.assertRaises(m.Held):b.identity(102,501)
    def test_exception_redacted(self):
        b=self.new()
        def fail(*args):raise OSError('private payload')
        b.pidinfo=fail
        with self.assertRaisesRegex(m.Held,'^native_unavailable$'):b.identity(102,501)
    def test_platform_unsupported_and_receipt(self):
        with self.assertRaises(m.Held):m.Backend(1000,platform='linux')
        r=m.metadata_receipt('host_pressure_elevated')
        self.assertTrue(all(v is False for k,v in r.items() if k.endswith(('authorized','authorization','contained','verified','proven'))))
    @unittest.skipUnless(sys.platform=='darwin','Darwin metadata only')
    def test_current_process_only_native_metadata(self):
        b=m.Backend(time.monotonic_ns()+1_000_000_000)
        expected=b.identity(os.getpid(),os.getuid());usage=b.sample(expected)
        self.assertGreater(usage['kernel_start'],0);self.assertGreater(usage['rss_bytes'],0)
        self.assertIn(b.pressure(),('normal','host_pressure_elevated','host_pressure_unavailable'))

if __name__=='__main__':unittest.main()

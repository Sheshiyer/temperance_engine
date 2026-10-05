import ctypes
import errno
import importlib.util
import os
from pathlib import Path
import sys
import time
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('inventory',Path(__file__).resolve().parents[1]/'lib/model-worker-inventory.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


def row(pid,parent=0,birth=None,state='live'):
    return {'pid':pid,'uid':501,'parent_pid':parent,'birth':birth or f'darwin:{pid}:1','state':state,'rss_bytes':1}


class Mock:
    def __init__(self):self.count=2;self.bad=None
    def listing(self,flavor,uid,buf,size):
        assert flavor==4 and size==4097*4
        for i in range(min(self.count,4097)):buf[i]=i+100
        if self.bad=='duplicate':buf[1]=buf[0]
        return True if self.bad=='bool' else 3 if self.bad=='alignment' else self.count*4
    def info(self,pid,flavor,arg,p,size):
        if self.bad=='esrch':ctypes.set_errno(errno.ESRCH);return 0
        if self.bad=='error':ctypes.set_errno(errno.EPERM);return 0
        if flavor==2:
            v=ctypes.cast(p,ctypes.POINTER(m.TaskAllInfo)).contents;b=v.bsd;v.task.resident_size=123
        else:b=ctypes.cast(p,ctypes.POINTER(m.native.BsdInfo)).contents
        b.pid=pid;b.uid=501;b.ppid=99;b.status=5 if self.bad in ('zombie','zombiemismatch') else 2;b.start_sec=pid;b.start_usec=1
        if self.bad=='uid':b.uid=502
        if self.bad=='zombiemismatch' and flavor==3:b.start_sec+=1
        return 136 if flavor==3 or self.bad in ('zombie','zombiemismatch') else size


class Tests(unittest.TestCase):
    def capture(self):
        self.mock=Mock();return m.Capture(501,1000,clock=lambda:1,listpids=self.mock.listing,pidinfo=self.mock.info,platform='darwin')
    def lifetime(self,limit=256):return m.Lifetime(row(100),1000,limit=limit,clock=lambda:1)
    def identity(self,rows):return lambda pid:(rows[pid]['uid'],rows[pid]['birth'])
    def test_count_bounds_before_rows(self):
        b=self.capture();self.mock.count=4096;self.assertEqual(len(b.read()),4096)
        self.mock.count=4097
        with self.assertRaises(m.Held):b.read()
        for bad in ('bool','alignment','duplicate'):
            b=self.capture();self.mock.bad=bad
            with self.assertRaises(m.Held):b.read()
    def test_error_identity_zombie_disappearance(self):
        for bad in ('error','uid','zombiemismatch'):
            b=self.capture();self.mock.bad=bad
            with self.assertRaises(m.Held):b.read()
        b=self.capture();self.mock.bad='esrch';self.assertEqual(b.read(),{})
        b=self.capture();self.mock.bad='zombie';self.assertTrue(all(r['state']=='zombie' and r['rss_bytes']==0 for r in b.read().values()))
    def test_constructor_expiry_error(self):
        with patch.object(m.ctypes,'CDLL') as loader:
            with self.assertRaises(m.Held):m.Capture(501,1,clock=lambda:1,platform='darwin')
            loader.assert_not_called()
        with patch.object(m.ctypes,'CDLL',side_effect=OSError('private')):
            with self.assertRaisesRegex(m.Held,'^native_unavailable$'):m.Capture(501,1000,clock=lambda:1,platform='darwin')
    def test_query_deadline(self):
        b=self.capture();now=[1];b.timer.clock=lambda:now[0];fn=b.listpids
        def late(*args):r=fn(*args);now[0]=1000;return r
        b.listpids=late
        with self.assertRaisesRegex(m.Held,'^deadline$'):b.read()
    def test_root_only_allfalse(self):
        b=self.lifetime();rows={100:row(100)};r=b.collect(rows,self.identity(rows))
        self.assertEqual(r['tracked_count'],1);self.assertFalse(r['cleanup_verified'])
    def test_unknown_and_reuse_not_empty(self):
        for rows in ({},{100:row(100,birth='darwin:999:1')}):
            b=self.lifetime()
            with self.assertRaises(m.Held):b.collect(rows,self.identity(rows))
            self.assertTrue(b.frozen);self.assertEqual(b.tracked[100],(501,'darwin:100:1'))
        b=self.lifetime();rows={100:row(100)}
        with self.assertRaises(m.Held):b.collect(rows,lambda pid:None)
    def test_linear_deep_descendants_cap_and_nooverwrite(self):
        b=self.lifetime();rows={100:row(100)}
        for pid in range(101,356):rows[pid]=row(pid,pid-1)
        with self.assertRaisesRegex(m.Held,'^descendant_limit$'):b.collect(rows,self.identity(rows))
        self.assertEqual(len(b.tracked),256)
        rows[101]['birth']='darwin:999:1'
        with self.assertRaises(m.Held):b.collect(rows,self.identity(rows),cleanup=True)
        self.assertEqual(b.tracked[101],(501,'darwin:101:1'))
    def test_once_cleanup_frame_frozen_bound(self):
        b=self.lifetime(limit=1);rows={100:row(100),101:row(101,100)}
        with self.assertRaises(m.Held):b.collect(rows,self.identity(rows))
        self.assertEqual(len(b.tracked),1)
        rows.update({p:row(p,100) for p in range(102,4196)})
        with self.assertRaises(m.Held):b.collect(rows,self.identity(rows),cleanup=True)
        self.assertEqual(len(b.tracked),4096);self.assertTrue(b.cleanup_frame)
        later={100:row(100),5000:row(5000,100)}
        with self.assertRaises(m.Held):b.collect(later,self.identity(later),cleanup=True)
        self.assertNotIn(5000,b.tracked)
    def test_all_entry_failures_sticky_and_cleanup_once(self):
        for malformed in (None, {100:row(100),101:{**row(101),'uid':502}}, {100:{'pid':100}}):
            b=self.lifetime()
            with self.assertRaises(m.Held):b.collect(malformed,lambda pid:None)
            self.assertTrue(b.frozen);reason=b.reason
            with self.assertRaises(m.Held):b.collect({100:row(100)},self.identity({100:row(100)}))
            self.assertEqual(b.reason,reason)
            with self.assertRaises(m.Held):b.collect({100:row(100)},self.identity({100:row(100)}),cleanup=True)
            self.assertTrue(b.cleanup_frame);self.assertEqual(b.reason,reason)
        b=self.lifetime()
        with self.assertRaises(m.Held):b.collect(None,lambda pid:None)
        with self.assertRaises(m.Held):b.collect({},lambda pid:None,cleanup=True)
        self.assertEqual(b.reason,'frame_invalid')
        b=self.lifetime();b.timer.clock=lambda:1000
        with self.assertRaises(m.Held):b.collect({},lambda pid:None)
        self.assertTrue(b.frozen);self.assertEqual(b.reason,'deadline')
    def test_group_not_ancestry_and_malformed(self):
        b=self.lifetime();rows={100:row(100),101:row(101,999)};r=b.collect(rows,self.identity(rows));self.assertEqual(r['tracked_count'],1)
        rows[101]['uid']=502
        with self.assertRaises(m.Held):b.collect(rows,self.identity(rows))
    @unittest.skipUnless(sys.platform=='darwin','Darwin inventory only')
    def test_current_host_uid_counts_only(self):
        b=m.Capture(os.getuid(),time.monotonic_ns()+2_000_000_000);rows=b.read()
        self.assertLessEqual(len(rows),4096);self.assertIn(os.getpid(),rows)

if __name__=='__main__':unittest.main()

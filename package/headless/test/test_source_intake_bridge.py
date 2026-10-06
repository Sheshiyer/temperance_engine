"""Four-source intake bridge; defaults use mocked OS, never a real point."""
from pathlib import Path
from types import MappingProxyType
import hashlib
import os
import stat
import errno
import time
import json
import sys
import unittest

OWNER_PIN='5f0aa74c8679944f1eedd5656155a84f7ac38cc5a3c55560b38ce226a4a83129'
PINS={'owner':OWNER_PIN,'planner':'6247e67239cde45713f59bac223c0ba765804b9a7969b0a3bbbeb5b8fc700b1f','adapter':'bc69e73b3cb6128271ce034356bffb509b33023a08a3305e6a0412791c542ccf'}
ORDER=('self','owner','planner','adapter')
class Held(Exception):pass

def integer(v,lo,hi):
    if type(v) is not int or not lo<=v<=hi:raise Held('metadata_invalid')
    return v

def metadata(v):
    keys={'device','inode','mode','size','mtime','ctime','parents'}
    if type(v) is not dict or len(v)!=7 or any(type(k) is not str or len(k)>64 for k in v) or set(v)!=keys:raise Held('metadata_invalid')
    for k in keys-{'parents'}:integer(v[k],0,2**63-1)
    if v['mode']&0o170000!=0o100000 or not v['inode'] or not 1<=v['size']<=65536:raise Held('metadata_invalid')
    if type(v['parents']) is not tuple or not 1<=len(v['parents'])<=32:raise Held('metadata_invalid')
    for row in v['parents']:
        if type(row) is not tuple or len(row)!=3:raise Held('metadata_invalid')
        for value in row:integer(value,0,2**63-1)
        if row[1]==0 or row[2]&0o170000!=0o40000:raise Held('metadata_invalid')
    return MappingProxyType(dict(v))

class Bridge:
    def __init__(self,created,deadline,clock,self_pin):
        self.created=integer(created,0,2**63-1);self.deadline=integer(deadline,1,2**63-1)
        if not 500_000_000<deadline-created<=2_000_000_000 or deadline>2**63-1-500_000_000:raise Held('deadline')
        if type(self_pin) is not str or len(self_pin)!=64 or any(c not in '0123456789abcdef' for c in self_pin):raise Held('metadata_invalid')
        self.pins=dict(PINS,self=self_pin);self.clock=clock;self.last=created;self.started=False;self.reason=None;self.unknown=False;self.emergency=False
        self.entries={};self.attempts=set();self.close_intents=set();self.transfer=set();self.bytes_requested=0;self.owner=None;self.result=None
    def sample(self):
        now=integer(self.clock(),0,2**63-1)
        if now<self.last:raise Held('clock_regressed')
        self.last=now;return now
    def check(self,cleanup=False):
        now=self.sample()
        if cleanup:
            if now>=self.deadline:self.unknown=True;self.emergency=True
            if now>=self.deadline+500_000_000:raise Held('deadline')
        elif now>=self.deadline-500_000_000:raise Held('deadline')
        return now
    def call(self,fn,*args):self.check();v=fn(*args);self.check();return v
    def read(self,ops,fd,size,offset):
        integer(size,1,65536);integer(offset,0,65536)
        if self.bytes_requested+size>131072:raise Held('intake_bound')
        self.bytes_requested+=size
        return self.call(ops.pread,fd,size,offset)
    def close_one(self,ops,name):
        if name in self.attempts:return
        self.attempts.add(name);entry=self.entries[name]
        if entry['meta'] is None:self.unknown=True;return
        try:
            self.check(True);m=metadata(ops.fstat(entry['fd']));self.check(True)
            if m!=entry['meta']:self.unknown=True;return
            self.close_intents.add(name);r=ops.close(entry['fd']);self.check(True)
            if r is not True:self.unknown=True
        except Exception:self.unknown=True
    def cleanup(self,ops):
        for name in self.entries:
            if name not in self.transfer:self.close_one(ops,name)
        if self.owner is not None:
            self.unknown=self.unknown or self.owner.unknown
            self.emergency=self.emergency or self.owner.emergency
    def collect(self,ops,prepare):
        if self.started:return self.receipt()
        self.started=True;pending=False;captured={}
        try:
            pre={name:metadata(self.call(ops.preflight,name)) for name in ORDER}
            if sum(v['size'] for v in pre.values())+4>131072:raise Held('intake_bound')
            for name in ORDER:
                self.check();pending=True;fd=ops.open(name);integer(fd,0,2**31-1)
                if any(e['fd']==fd for e in self.entries.values()):raise Held('metadata_invalid')
                self.entries[name]={'fd':fd,'meta':None};pending=False;self.check()
                m=metadata(self.call(ops.fstat,fd))
                if m!=pre[name]:raise Held('source_changed')
                self.entries[name]['meta']=m
            for name in ('self','owner'):
                fd=self.entries[name]['fd'];size=pre[name]['size'];b=self.read(ops,fd,size,0)
                if type(b) is not bytes or len(b)!=size or self.read(ops,fd,1,size)!=b'':raise Held('source_changed')
                if metadata(self.call(ops.fstat,fd))!=pre[name] or metadata(self.call(ops.preflight,name))!=pre[name] or hashlib.sha256(b).hexdigest()!=self.pins[name]:raise Held('source_changed')
                self.check();captured[name]=b;self.close_one(ops,name)
                if self.unknown:raise Held('cleanup_unknown')
            self.check();ns={'__name__':'captured_source_owner'};exec(compile(captured['owner'],'<fixed-owner>','exec'),ns);self.check()
            self.reviewed_mock_prepare=ns['Tests'].prepare
            self.owner=ns['SourceOwner'](self.created,self.deadline,self.sample)
            bridge=self
            class FS:
                def preflight(_,name):
                    m=metadata(ops.preflight(name))
                    if m!=pre[name]:raise Held('source_changed')
                    return dict(m)
                def open(_,name):
                    if name not in ('planner','adapter') or name in bridge.transfer:raise Held('source_changed')
                    bridge.transfer.add(name);return bridge.entries[name]['fd']
                def fstat(_,fd):return dict(metadata(ops.fstat(fd)))
                def pread(_,fd,size,offset):return bridge.read(ops,fd,size,offset)
                def close(_,fd):
                    name=next(n for n in ('planner','adapter') if bridge.entries[n]['fd']==fd)
                    if name in bridge.attempts:raise Held('cleanup_unknown')
                    bridge.attempts.add(name);bridge.close_intents.add(name);return ops.close(fd)
            self.result=self.owner.run(FS(),prepare);self.check()
            if self.result['status']!='attested-mock-wrapper':raise Held('source_changed')
        except Exception as error:
            a=BaseException.args.__get__(error);allowed={'metadata_invalid','clock_regressed','deadline','intake_bound','source_changed','cleanup_unknown'}
            self.reason=a[0] if type(a) is tuple and len(a)==1 and type(a[0]) is str and len(a[0])<=64 and a[0] in allowed else 'boundary_unavailable'
            self.unknown=self.unknown or pending;captured.clear();self.result=None
        self.cleanup(ops);return self.receipt()
    def receipt(self):return dict(status='held' if self.reason or self.unknown else ('attested-injected-intake' if self.result else 'pending'),reason=self.reason,intake_requested_bytes=self.bytes_requested,source_ownership_entries_visited=len(self.attempts),source_close_intent_count=len(self.close_intents),transferred_source_count=len(self.transfer),cleanup_unknown=self.unknown,emergency_cleanup_used=self.emergency,actual_native_readiness=False,native_authentication=False,execution_authorized=False,capacity_authorization=False,inference_authorized=False)

class RealOps:
    """Fixed read-only OS adapter. Defined, not invoked by default/mock tests."""
    def __init__(self):
        root=Path(__file__).absolute().parents[1]
        self.paths={'self':Path(__file__).absolute(),'owner':root/'test'/'test_attested_preparation_wrapper.py','planner':root/'lib'/'bootstrap-fd-action-plan.py','adapter':root/'lib'/'bootstrap-fd-preparation.py'}
        self.fd_names={};self.close_attempts=set();self.ebadf_verified=0
    def preflight(self,name):
        path=self.paths[name]
        parents=tuple(reversed(path.parents))
        if not 1<=len(parents)<=32:raise Held('metadata_invalid')
        rows=[]
        for parent in parents:
            m=os.lstat(parent)
            if not stat.S_ISDIR(m.st_mode):raise Held('metadata_invalid')
            rows.append((m.st_dev,m.st_ino,m.st_mode))
        m=os.lstat(path)
        if not stat.S_ISREG(m.st_mode):raise Held('metadata_invalid')
        return dict(device=m.st_dev,inode=m.st_ino,mode=m.st_mode,size=m.st_size,mtime=m.st_mtime_ns,ctime=m.st_ctime_ns,parents=tuple(rows))
    def open(self,name):
        fd=os.open(self.paths[name],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        self.fd_names[fd]=name;return fd
    def fstat(self,fd):
        path_meta=self.preflight(self.fd_names[fd]);m=os.fstat(fd)
        return dict(device=m.st_dev,inode=m.st_ino,mode=m.st_mode,size=m.st_size,mtime=m.st_mtime_ns,ctime=m.st_ctime_ns,parents=path_meta['parents'])
    def pread(self,fd,size,offset):return os.pread(fd,size,offset)
    def close(self,fd):
        if fd in self.close_attempts:raise Held('cleanup_unknown')
        self.close_attempts.add(fd);os.close(fd)
        # No intervening allocation or reuse by this fixture before immediate query.
        try:os.fstat(fd)
        except OSError as error:
            if error.errno==errno.EBADF:self.ebadf_verified+=1;return True
        return False

def point(expected_sha,clock=time.monotonic_ns,ops_factory=RealOps,serialize=json.dumps):
    """Trusted exact fixture entry. No execution happens until explicit --point."""
    bridge=None;ops=None
    fallback=dict(status='held',reason='entry_unavailable',cleanup_unknown=True,actual_native_readiness=False,native_authentication=False,execution_authorized=False,capacity_authorization=False,inference_authorized=False,native_endpoint_candidate=False)
    try:
        created=integer(clock(),0,2**63-1-2_500_000_000)
        if type(expected_sha) is not str or len(expected_sha)!=64 or any(c not in '0123456789abcdef' for c in expected_sha):raise Held('expected_hash_invalid')
        bridge=Bridge(created,created+2_000_000_000,clock,expected_sha)
        bridge.check();ops=ops_factory();bridge.check()
        def prepare(p):
            # Reuse captured reviewed fixture's mock allocations; no real endpoints.
            class State:pass
            state=State();state.prepared=[]
            return bridge.reviewed_mock_prepare(state,p)
        receipt=dict(bridge.collect(ops,prepare));bridge.check()
        receipt['status']='source-intake-point-complete' if receipt['status']=='attested-injected-intake' else 'held'
        receipt['native_endpoint_candidate']=False
        receipt['verified_immediate_ebadf_count']=getattr(ops,'ebadf_verified',0)
        bridge.check();encoded=serialize(receipt,ensure_ascii=True,separators=(',',':'));bridge.check()
        if type(encoded) is not str or len(encoded)>4096:raise Held('finalization_invalid')
        return receipt,encoded
    except Exception as error:
        a=BaseException.args.__get__(error)
        if type(a) is tuple and len(a)==1 and type(a[0]) is str and len(a[0])<=64 and a[0] in ('metadata_invalid','deadline','clock_regressed','expected_hash_invalid','finalization_invalid'):fallback['reason']=a[0]
        if bridge is not None:
            if ops is not None:bridge.cleanup(ops)
            fallback.update(intake_requested_bytes=bridge.bytes_requested,source_close_intent_count=len(bridge.close_intents),verified_immediate_ebadf_count=getattr(ops,'ebadf_verified',0) if ops is not None else 0,cleanup_unknown=True,emergency_cleanup_used=bridge.emergency)
        # Fixed already-held fallback; it cannot turn late failure into success.
        return fallback,json.dumps(fallback,ensure_ascii=True,separators=(',',':'))

# Trusted reviewed fixture bootstrap; these capped local fixture reads are not a point.
def values_fixture():
    base=Path(__file__).resolve().parents[1];values={}
    files={'self':Path(__file__),'owner':base/'test'/'test_attested_preparation_wrapper.py','planner':base/'lib'/'bootstrap-fd-action-plan.py','adapter':base/'lib'/'bootstrap-fd-preparation.py'}
    for name,p in files.items():
        with p.open('rb') as f:b=f.read(65537)
        if len(b)>65536 or name!='self' and hashlib.sha256(b).hexdigest()!=PINS[name]:raise RuntimeError('fixture drift')
        values[name]=b
    return values
class Ops:
    def __init__(self,values):self.values=values;self.names={10+i:n for i,n in enumerate(ORDER)};self.opens=[];self.reads=[];self.closes=[];self.bad=None
    def preflight(self,n):return dict(device=1,inode=1+ORDER.index(n),mode=0o100644,size=len(self.values[n]),mtime=1,ctime=1,parents=((1,8,0o40755),))
    def open(self,n):self.opens.append(n);return 10+ORDER.index(n)
    def fstat(self,fd):m=self.preflight(self.names[fd]);m['inode']+=1 if self.bad==fd else 0;return m
    def pread(self,fd,size,offset):self.reads.append((fd,size,offset));return self.values[self.names[fd]][offset:offset+size]
    def close(self,fd):self.closes.append(fd);return True

class Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.values=values_fixture()
    def setup(self):self.now=0;self.b=Bridge(0,2_000_000_000,lambda:self.now,hashlib.sha256(self.values['self']).hexdigest());self.ops=Ops(self.values);self.preps=[]
    def prepare(self,p):self.preps.append(p);return MappingProxyType(dict(status='prepared-metadata'))
    def test_samebytes_no_double_read_transfer(self):
        self.setup();r=self.b.collect(self.ops,self.prepare);self.assertEqual(r['status'],'attested-injected-intake');self.assertEqual(len(self.ops.opens),4);self.assertEqual(self.ops.closes,[10,11,12,13]);self.assertEqual(len(self.ops.reads),8);self.assertEqual(r['intake_requested_bytes'],sum(map(len,self.values.values()))+4);self.assertEqual(self.preps[0].created,0);self.assertEqual(self.preps[0].deadline,2_000_000_000)
    def test_actual_reviewed_mock_preparation(self):
        self.setup();ns={'__name__':'reviewed_fixture'};exec(compile(self.values['owner'],'<reviewed-fixture>','exec'),ns)
        fixture=ns['Tests']();fixture.prepared=[]
        r=self.b.collect(self.ops,fixture.prepare);self.assertEqual(r['status'],'attested-injected-intake');self.assertEqual(self.b.owner.result['planner_owned_count'],18)
    def test_transferred_emergency_propagated(self):
        self.setup();old=self.ops.pread
        def read(fd,*args):
            v=old(fd,*args)
            if fd==12:self.now=2_000_000_001
            return v
        self.ops.pread=read;r=self.b.collect(self.ops,self.prepare)
        self.assertEqual(r['status'],'held');self.assertTrue(r['cleanup_unknown']);self.assertTrue(r['emergency_cleanup_used']);self.assertEqual(self.ops.closes,[10,11,12,13])
    def test_transferred_late_read_safe_cleanup(self):
        self.setup();old=self.ops.pread
        def read(fd,*args):
            v=old(fd,*args)
            if fd==12:self.now=1_500_000_000
            return v
        self.ops.pread=read;r=self.b.collect(self.ops,self.prepare);self.assertEqual(r['status'],'held');self.assertEqual(self.ops.closes,[10,11,12,13]);self.assertEqual(self.preps,[])
    def test_fourth_invalid_zero_reads(self):
        self.setup();self.ops.bad=13;r=self.b.collect(self.ops,self.prepare);self.assertEqual(self.ops.reads,[]);self.assertTrue(r['cleanup_unknown']);self.assertNotIn(13,self.ops.closes)
    def test_fourth_preflight_invalid_zero_open(self):
        self.setup();old=self.ops.preflight
        def pf(n):m=old(n);m['size']=65537 if n=='adapter' else m['size'];return m
        self.ops.preflight=pf;r=self.b.collect(self.ops,self.prepare);self.assertEqual(self.ops.opens,[]);self.assertEqual(self.ops.reads,[])
    def test_slow_first_read_zero_preparation(self):
        self.setup();old=self.ops.pread
        def read(*a):v=old(*a);self.now=1_500_000_000;return v
        self.ops.pread=read;r=self.b.collect(self.ops,self.prepare);self.assertEqual(self.preps,[]);self.assertEqual(r['status'],'held');self.assertEqual(len(self.ops.closes),4)
    def test_close_failure_independent(self):
        self.setup()
        def close(fd):
            self.ops.closes.append(fd)
            if fd==10:raise RuntimeError('private')
            return True
        self.ops.close=close;r=self.b.collect(self.ops,self.prepare);self.assertEqual(self.ops.closes,[10,11,12,13]);self.assertTrue(r['cleanup_unknown']);self.assertEqual(self.preps,[])
    def test_transferred_failure_not_double_closed(self):
        self.setup();old=self.ops.pread
        def read(fd,*args):
            if fd==12:raise RuntimeError('private')
            return old(fd,*args)
        self.ops.pread=read;r=self.b.collect(self.ops,self.prepare);self.assertEqual(self.ops.closes,[10,11,12,13]);self.assertEqual(r['status'],'held')
    def test_sticky(self):
        self.setup();self.ops.bad=13;self.b.collect(self.ops,self.prepare);before=list(self.ops.opens);self.ops.bad=None;self.b.collect(self.ops,self.prepare);self.assertEqual(before,self.ops.opens)
class EntryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.values=values_fixture()
    def test_bad_hash_zero_intake(self):
        calls=[];r,_=point('bad',clock=lambda:0,ops_factory=lambda:calls.append(1));self.assertEqual(r['reason'],'expected_hash_invalid');self.assertEqual(calls,[])
    def test_mock_point_same_anchor(self):
        ops=Ops(self.values);pin=hashlib.sha256(self.values['self']).hexdigest()
        r,encoded=point(pin,clock=lambda:0,ops_factory=lambda:ops);self.assertEqual(r['status'],'source-intake-point-complete');self.assertEqual(ops.closes,[10,11,12,13]);self.assertFalse(r['native_endpoint_candidate']);self.assertLess(len(encoded),4096)
    def test_late_finalization_held(self):
        ops=Ops(self.values);now=[0];pin=hashlib.sha256(self.values['self']).hexdigest()
        def serialize(*args,**kw):now[0]=1_500_000_000;return json.dumps(*args,**kw)
        r,_=point(pin,clock=lambda:now[0],ops_factory=lambda:ops,serialize=serialize);self.assertEqual(r['status'],'held');self.assertTrue(r['cleanup_unknown'])
    def test_clock_error_no_str(self):
        class Error(Exception):
            def __str__(self):raise AssertionError('never stringify')
        def clock():raise Error('private')
        r,_=point('a'*64,clock=clock);self.assertEqual(r['status'],'held');self.assertEqual(r['reason'],'entry_unavailable')

if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1]=='--point':
        expected=sys.argv[3] if len(sys.argv)==4 and sys.argv[2]=='--expected-source-sha' else None
        receipt,encoded=point(expected);print(encoded);raise SystemExit(0 if receipt['status']=='source-intake-point-complete' else 1)
    unittest.main()

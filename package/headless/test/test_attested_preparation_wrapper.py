"""Injected fixed source snapshot owner; no native source-owner point."""
from pathlib import Path
from types import MappingProxyType
import hashlib
import unittest

PINS={'planner':'6247e67239cde45713f59bac223c0ba765804b9a7969b0a3bbbeb5b8fc700b1f','adapter':'bc69e73b3cb6128271ce034356bffb509b33023a08a3305e6a0412791c542ccf'}
NAMES=('planner','adapter')
class Held(Exception):pass

def integer(v,lo,hi):
    if type(v) is not int or not lo<=v<=hi:raise Held('metadata_invalid')
    return v

def closed(v,keys):
    if type(v) is not dict or len(v)!=len(keys) or any(type(k) is not str or len(k)>64 for k in v) or set(v)!=keys:raise Held('metadata_invalid')

def meta(value):
    closed(value,{'device','inode','mode','size','mtime','ctime','parents'})
    for k in ('device','inode','mode','size','mtime','ctime'):integer(value[k],0,2**63-1)
    if value['mode']&0o170000!=0o100000 or value['inode']==0 or not 1<=value['size']<=65536:raise Held('metadata_invalid')
    parents=value['parents']
    if type(parents) is not tuple or not 1<=len(parents)<=32:raise Held('metadata_invalid')
    for row in parents:
        if type(row) is not tuple or len(row)!=3:raise Held('metadata_invalid')
        for x in row:integer(x,0,2**63-1)
        if row[1]==0 or row[2]&0o170000!=0o40000:raise Held('metadata_invalid')
    return MappingProxyType(dict(value))

class SourceOwner:
    def __init__(self,created,deadline,clock):
        self.created=integer(created,0,2**63-1);self.deadline=integer(deadline,1,2**63-1)
        if not 500_000_000<deadline-created<=2_000_000_000 or deadline>2**63-1-500_000_000:raise Held('deadline')
        self.last=created;self.clock=clock;self.started=False;self.reason=None;self.fds={};self.attempted=set();self.close_intents=set();self.unknown=False;self.emergency=False;self.result=None
    def check(self,cleanup=False):
        now=integer(self.clock(),0,2**63-1)
        if now<self.last:raise Held('clock_regressed')
        self.last=now
        if cleanup:
            if now>=self.deadline:self.emergency=True;self.unknown=True
            if now>=self.deadline+500_000_000:raise Held('deadline')
        elif now>=self.deadline-500_000_000:raise Held('deadline')
        return now
    def call(self,cb,*args):self.check();r=cb(*args);self.check();return r
    def cleanup(self,fs):
        for fd,expected in self.fds.items():
            if fd in self.attempted:continue
            try:self.check(True)
            except Exception:self.unknown=True;break
            self.attempted.add(fd)
            if expected is None:self.unknown=True;continue
            try:
                m=meta(fs.fstat(fd));self.check(True)
                if m!=expected:self.unknown=True;continue
                self.close_intents.add(fd);r=fs.close(fd);self.check(True)
                if r is not True:self.unknown=True
            except Exception:self.unknown=True
        if len(self.attempted)<len(self.fds):self.unknown=True
    def run(self,fs,prepare):
        if self.started:return self.receipt()
        self.started=True;buffers={};pending_open=False
        try:
            pre={name:meta(self.call(fs.preflight,name)) for name in NAMES}
            if sum(m['size'] for m in pre.values())>131072:raise Held('metadata_invalid')
            # BOTH identities correlated before ANY content callback.
            for name in NAMES:
                self.check();pending_open=True;fd=fs.open(name);integer(fd,0,2**31-1)
                if fd in self.fds:raise Held('metadata_invalid')
                self.fds[fd]=None;pending_open=False;self.check()
                m=meta(self.call(fs.fstat,fd))
                if m!=pre[name]:raise Held('source_changed')
                self.fds[fd]=m
            for name,fd in zip(NAMES,self.fds):
                b=self.call(fs.pread,fd,pre[name]['size'],0)
                if type(b) is not bytes or len(b)!=pre[name]['size']:raise Held('source_changed')
                growth=self.call(fs.pread,fd,1,len(b))
                if type(growth) is not bytes or growth!=b'':raise Held('source_changed')
                if meta(self.call(fs.fstat,fd))!=pre[name] or meta(self.call(fs.preflight,name))!=pre[name]:raise Held('source_changed')
                if hashlib.sha256(b).hexdigest()!=PINS[name]:raise Held('source_changed')
                self.check();buffers[name]=b
            self.cleanup(fs)
            if self.unknown or len(self.close_intents)!=2:raise Held('cleanup_unknown')
            namespaces={}
            for name in NAMES:
                self.check();ns={'__name__':'attested_'+name};exec(compile(buffers[name],'<fixed-'+name+'>','exec'),ns);self.check();namespaces[name]=ns
            self.check()
            # Wrapper clock preserves intake history, no renewed constructor window.
            prep=namespaces['adapter']['Preparation'](self.created,self.deadline,lambda:self.check(),namespaces['planner']['plan_actions'])
            self.check();self.result=prepare(prep);self.check()
            if type(self.result) is not MappingProxyType or self.result['status']!='prepared-metadata':raise Held('boundary_unavailable')
        except Exception as e:
            a=BaseException.args.__get__(e)
            allowed={'metadata_invalid','deadline','clock_regressed','source_changed','cleanup_unknown'}
            self.reason=a[0] if type(a) is tuple and len(a)==1 and type(a[0]) is str and len(a[0])<=64 and a[0] in allowed else 'boundary_unavailable'
            self.unknown=self.unknown or pending_open
            self.result=None;buffers.clear();self.cleanup(fs)
        return self.receipt()
    def receipt(self):return dict(status='held' if self.reason or self.unknown else ('attested-mock-wrapper' if self.result is not None else 'pending'),reason=self.reason,source_close_intent_count=len(self.close_intents),cleanup_unknown=self.unknown,emergency_cleanup_used=self.emergency,actual_native_readiness=False,native_authentication=False,execution_authorized=False,capacity_authorization=False,inference_authorized=False)

# Source-grounded inert fixture bytes; bounded reads, not OS snapshot attestation.
def fixture_bytes():
    result={};base=Path(__file__).resolve().parents[1]/'lib'
    for name,file in (('planner','bootstrap-fd-action-plan.py'),('adapter','bootstrap-fd-preparation.py')):
        with (base/file).open('rb') as stream:b=stream.read(65537)
        if len(b)>65536 or hashlib.sha256(b).hexdigest()!=PINS[name]:raise RuntimeError('fixture source drift')
        result[name]=b
    return result

class FS:
    def __init__(self,values):self.values=values;self.names={10:'planner',11:'adapter'};self.reads=[];self.closes=[];self.bad=None;self.growth=False
    def preflight(self,n):return dict(device=1,inode=1 if n=='planner' else 2,mode=0o100600,size=len(self.values[n]),mtime=1,ctime=1,parents=((1,3,0o40700),))
    def open(self,n):return 10 if n=='planner' else 11
    def fstat(self,fd):m=self.preflight(self.names[fd]);m['inode']+=1 if self.bad==fd else 0;return m
    def pread(self,fd,size,offset):self.reads.append((fd,size,offset));return b'x' if self.growth and offset else self.values[self.names[fd]][offset:offset+size]
    def close(self,fd):self.closes.append(fd);return True

class Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.values=fixture_bytes()
    def setup(self):self.now=0;self.owner=SourceOwner(0,2_000_000_000,lambda:self.now);self.fs=FS(self.values);self.prepared=[]
    def prepare(self,p):
        self.prepared.append(p);rows={};next_fd=20
        roles=('codec_read','codec_write','status_write','release_read','context_read');access=(0,1,1,0,0)
        def allocate(label,source):
            nonlocal next_fd
            fd=next_fd;next_fd+=1
            if source:row=dict(source,fd=fd,descriptor_flags=source['descriptor_flags']|1)
            else:
                kind='fifo';a=0;inode=999
                if label=='parent':kind='directory';inode=1
                elif label=='null':kind='character';a=2;inode=2
                else:
                    role,side=label.rsplit('-',1);i=roles.index(role);a=access[i] if side=='child' else 1-access[i];inode=100+i
                row=dict(fd=fd,device=1,inode=inode,kind=kind,access_mode=a,status_flags=a,descriptor_flags=0)
            rows[fd]=row;return fd
        receipts=tuple(dict(nonce='a'*32,counter=i,launch_limit=2) for i in (1,2))
        return p.run(receipts,allocate,lambda fd:dict(rows[fd]),lambda fd:True)
    def test_exact_source_detached_join_original_clock(self):
        self.setup();r=self.owner.run(self.fs,self.prepare);self.assertEqual(r['status'],'attested-mock-wrapper');self.assertEqual(self.fs.closes,[10,11]);self.assertEqual(self.prepared[0].created,0);self.assertEqual(self.prepared[0].deadline,2_000_000_000);self.assertFalse(r['execution_authorized']);self.assertEqual(self.owner.result['status'],'prepared-metadata');self.assertEqual(self.owner.result['planner_owned_count'],18)
    def test_second_bad_open_identity_zero_reads(self):
        self.setup();self.fs.bad=11;r=self.owner.run(self.fs,self.prepare);self.assertEqual(self.fs.reads,[]);self.assertEqual(self.prepared,[]);self.assertTrue(r['cleanup_unknown']);self.assertEqual(self.fs.closes,[10])
    def test_second_bad_preflight_zero_reads(self):
        self.setup();old=self.fs.preflight
        def pre(n):m=old(n);m['size']=65537 if n=='adapter' else m['size'];return m
        self.fs.preflight=pre;r=self.owner.run(self.fs,self.prepare);self.assertEqual(self.fs.reads,[]);self.assertEqual(self.fs.closes,[]);self.assertEqual(r['status'],'held')
    def test_slow_intake_zero_prepare(self):
        self.setup();old=self.fs.pread
        def read(*a):r=old(*a);self.now=1_500_000_000;return r
        self.fs.pread=read;r=self.owner.run(self.fs,self.prepare);self.assertEqual(self.prepared,[]);self.assertEqual(r['status'],'held')
    def test_growth_hold(self):
        self.setup();self.fs.growth=True;r=self.owner.run(self.fs,self.prepare);self.assertEqual(r['reason'],'source_changed');self.assertEqual(self.prepared,[])
    def test_close_failure_safe_peer(self):
        self.setup()
        # second explicitly confirms success, first exception cannot skip it
        def close(fd):
            self.fs.closes.append(fd)
            if fd==10:raise RuntimeError('private')
            return True
        self.fs.close=close;r=self.owner.run(self.fs,self.prepare);self.assertEqual(self.fs.closes,[10,11]);self.assertTrue(r['cleanup_unknown']);self.assertEqual(self.prepared,[])
    def test_replaced_peer_not_closed(self):
        self.setup();old=self.fs.pread
        def read(fd,*args):r=old(fd,*args);self.fs.bad=10;return r
        self.fs.pread=read;r=self.owner.run(self.fs,self.prepare);self.assertNotIn(10,self.fs.closes);self.assertTrue(r['cleanup_unknown'])
    def test_preparation_held_not_promoted(self):
        self.setup();r=self.owner.run(self.fs,lambda p:p.run((),lambda *a:None,lambda *a:None,lambda *a:None));self.assertEqual(r['status'],'held');self.assertIsNone(self.owner.result)
    def test_clock_regression_blocks(self):
        self.setup();self.now=100;self.owner.check();self.now=99;r=self.owner.run(self.fs,self.prepare);self.assertEqual(r['reason'],'clock_regressed');self.assertEqual(self.fs.reads,[])
    def test_sticky_no_reexecution(self):
        self.setup();self.fs.bad=11;self.owner.run(self.fs,self.prepare);self.fs.bad=None;self.owner.run(self.fs,self.prepare);self.assertEqual(self.prepared,[])
if __name__=='__main__':unittest.main()

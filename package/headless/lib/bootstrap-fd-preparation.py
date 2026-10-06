"""Injected descriptor preparation only: no file/native/process API."""
from types import MappingProxyType
import hashlib

ROLES=('codec_read','codec_write','status_write','release_read','context_read')
ACCESS=(0,1,1,0,0)
KEYS={'fd','device','inode','kind','access_mode','status_flags','descriptor_flags'}
PLANNER_SHA='6247e67239cde45713f59bac223c0ba765804b9a7969b0a3bbbeb5b8fc700b1f'
REASONS={'metadata_invalid','deadline','clock_regressed','receipt_invalid','fd_collision','identity_changed','boundary_unavailable','source_invalid'}
class Held(Exception): pass

def closed(v,keys):
    if type(v) is not dict or len(v)!=len(keys) or any(type(k) is not str or len(k)>64 for k in v) or set(v)!=keys:raise Held('metadata_invalid')
def integer(v,lo,hi):
    if type(v) is not int or not lo<=v<=hi:raise Held('metadata_invalid')
    return v

def record(v):
    closed(v,KEYS)
    integer(v['fd'],0,2**31-1);integer(v['device'],0,2**63-1);integer(v['inode'],1,2**63-1)
    if type(v['kind']) is not str or v['kind'] not in ('fifo','directory','character'):raise Held('metadata_invalid')
    integer(v['access_mode'],0,2);integer(v['status_flags'],0,2**31-1);integer(v['descriptor_flags'],0,2**31-1)
    if v['status_flags']&3!=v['access_mode']:raise Held('metadata_invalid')
    return dict(v)

def reason(e):
    a=BaseException.args.__get__(e)
    return a[0] if type(a) is tuple and len(a)==1 and type(a[0]) is str and len(a[0])<=64 and a[0] in REASONS else 'boundary_unavailable'

def source_snapshots(metadata,read):
    """Trusted injected owner snapshot boundary; does not perform OS reads."""
    closed(metadata,{'planner','adapter'});total=0;expected={}
    for name in ('planner','adapter'):
        m=metadata[name];closed(m,{'size','sha256','continuous'})
        n=integer(m['size'],1,65536);total+=n
        h=m['sha256']
        if type(h) is not str or len(h)!=64 or any(c not in '0123456789abcdef' for c in h) or m['continuous'] is not True:raise Held('source_invalid')
        if name=='planner' and h!=PLANNER_SHA:raise Held('source_invalid')
        expected[name]=(n,h)
    if total>131072:raise Held('source_invalid')
    result={}
    for name in ('planner','adapter'):
        value=read(name)
        if type(value) is not bytes or len(value)!=expected[name][0] or hashlib.sha256(value).hexdigest()!=expected[name][1]:raise Held('source_invalid')
        result[name]=value
    return MappingProxyType(result)

class Preparation:
    def __init__(self,created_ns,deadline_ns,clock,planner,diagnostic=False):
        self.created=integer(created_ns,0,2**63-1);self.deadline=integer(deadline_ns,1,2**63-1)
        if not 500_000_000<self.deadline-self.created<=2_000_000_000 or type(diagnostic) is not bool:raise Held('deadline')
        self.emergency_deadline=self.deadline+500_000_000
        if self.emergency_deadline>2**63-1:raise Held('deadline')
        self.last=self.created;self.clock=clock;self.planner=planner;self.diagnostic=diagnostic
        self.emergency_used=False;self.teardown_started=False;self.pending_allocation=False;self.started=False;self.reason=None;self.candidates=[];self.identities={};self.attempted=set();self.close_intents=set();self.closed_count=0;self.cleanup_unknown=False;self.plan=None;self.sentinel=None
    def check(self):
        if self.teardown_started:raise Held('boundary_unavailable')
        now=integer(self.clock(),0,2**63-1)
        if now<self.last:raise Held('clock_regressed')
        self.last=now
        if now>=self.deadline-500_000_000:raise Held('deadline')
    def acquire(self,label,allocate,identity,source=None):
        if self.teardown_started:raise Held('boundary_unavailable')
        self.check();self.pending_allocation=True;fd=allocate(label,source)
        integer(fd,0,2**31-1)
        self.pending_allocation=False
        if fd in self.candidates:raise Held('fd_collision')
        self.candidates.append(fd)  # first candidate before clock/identity callbacks
        self.check();r=record(identity(fd))
        if r['fd']!=fd:raise Held('identity_changed')
        self.identities[fd]=MappingProxyType(dict(r))
        self.check();return r
    def run(self,receipts,allocate,identity,close):
        if self.started:return self.receipt()
        self.started=True
        try:
            if type(receipts) is not tuple or len(receipts)!=2:raise Held('receipt_invalid')
            nonce=None
            for count,r in enumerate(receipts,1):
                closed(r,{'nonce','counter','launch_limit'})
                if type(r['nonce']) is not str or len(r['nonce'])!=32 or any(c not in '0123456789abcdef' for c in r['nonce']) or integer(r['counter'],1,2)!=count or integer(r['launch_limit'],2,2)!=2 or nonce is not None and nonce!=r['nonce']:raise Held('receipt_invalid')
                nonce=r['nonce']
            parent=self.acquire('parent',allocate,identity);null=self.acquire('null',allocate,identity)
            channels={}
            for role in ROLES:
                channels[role]={'child':self.acquire(role+'-child',allocate,identity),'parent':self.acquire(role+'-parent',allocate,identity)}
            stages={}
            for role in (*ROLES,'null'):
                src=null if role=='null' else channels[role]['child']
                stages[role]=self.acquire(role+'-stage',allocate,identity,MappingProxyType(dict(src)))
            context=dict(schema='temperance.bootstrap-fd-metadata.v1',parent=parent,null=null,channels=channels,stages=stages,cloexec_default_reported=False)
            self.check();planned=self.planner(context);self.check();self.plan=planned
            if self.diagnostic:
                r=self.acquire('sentinel',allocate,identity)
                if r['fd']<8 or r['kind']!='fifo' or r['device']<=0:raise Held('metadata_invalid')
                self.sentinel=MappingProxyType(dict(schema='temperance.inert-sentinel-context.v1',sentinel_fd=r['fd'],sentinel_device=r['device'],sentinel_inode=r['inode'],sentinel_kind='fifo'))
            return self.receipt()
        except Exception as e:
            self.reason=self.reason or reason(e);self.cleanup_unknown=self.cleanup_unknown or self.pending_allocation;self.teardown(identity,close);return self.receipt()
    def cleanup_check(self):
        now=integer(self.clock(),0,2**63-1)
        if now<self.last:raise Held('clock_regressed')
        self.last=now
        if now>=self.deadline:self.emergency_used=True;self.cleanup_unknown=True
        if now>=self.emergency_deadline:raise Held('deadline')
    def teardown(self,identity,close):
        # One original+500ms window; synchronous callbacks cannot be preempted.
        self.teardown_started=True
        self.plan=None;self.sentinel=None
        for fd in self.candidates:
            if fd in self.attempted:continue
            try:self.cleanup_check()
            except Exception:self.cleanup_unknown=True;break
            self.attempted.add(fd)
            expected=self.identities.get(fd)
            if expected is None:self.cleanup_unknown=True;continue
            try:
                current=record(identity(fd));self.cleanup_check()
                if current!=expected:self.cleanup_unknown=True;continue
                self.cleanup_check();self.close_intents.add(fd)
                result=close(fd);self.cleanup_check()
                if result is not True:self.cleanup_unknown=True
                else:self.closed_count+=1
            except Exception:self.cleanup_unknown=True
        if len(self.attempted)<len(self.candidates):self.cleanup_unknown=True
    def receipt(self):
        return MappingProxyType(dict(schema='temperance.bootstrap-fd-preparation.v1',status='held' if self.reason or self.teardown_started and self.cleanup_unknown else ('settled-metadata' if self.teardown_started else ('prepared-metadata' if self.plan is not None else 'pending')),reason=self.reason or ('teardown' if self.teardown_started else None),returned_candidate_count=len(self.candidates),planner_owned_count=18 if self.plan is not None else 0,diagnostic_extra_count=1 if self.sentinel else 0,ownership_entries_visited=len(self.attempted),close_attempt_count=len(self.close_intents),injected_close_confirmed_count=self.closed_count,cleanup_unknown=self.cleanup_unknown,emergency_cleanup_used=self.emergency_used,actual_native_readiness=False,unknown_inherited_fd_closure_verified=False,native_authentication=False,execution_authorized=False,capacity_authorization=False,inference_authorized=False))

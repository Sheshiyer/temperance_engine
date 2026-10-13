"""Injected nonblocking three-stream capture steps; no FD operations or process launch."""
import time
from types import MappingProxyType

NAMES=('stdout','stderr','final')
CAPS=MappingProxyType({'stdout':4*1024**2,'stderr':1024**2,'final':256*1024})
AGGREGATE=5*1024**2
FRAME=64*1024
CHUNK=16*1024
POLL=50_000_000
DRAIN=250_000_000


class Held(Exception):pass


class CaptureStep:
    def __init__(self,adapter,expected,deadline_ns,*,clock=time.monotonic_ns,cancelled=lambda:False):
        self.adapter=adapter;self.keys={};self.buffers={n:bytearray() for n in NAMES};self.eof={n:False for n in NAMES}
        self.clock,self.cancelled=clock,cancelled;self.deadline=deadline_ns;self.last=None;self.last_step=None
        self.frame_bytes=0;self.reason=None;self.status='pending';self.terminal=None;self.drain_deadline=None;self.keeper_closed=False;self.closed=False
        # Caller transfers trusted retained identities, not raw selectable FDs.
        invalid=type(expected) is not dict or set(expected)!=set(NAMES)
        if type(expected) is dict:
            for name in NAMES:
                key=expected.get(name)
                if type(key) is tuple and len(key)==3 and all(type(v) is int and 0<=v<=2**63-1 for v in key):self.keys[name]=key
                else:invalid=True
        try:
            if invalid or len(set(self.keys.values()))!=3:self.fail('identity_invalid')
            if type(deadline_ns) is not int or not 1<=deadline_ns<=2**63-1:self.fail('deadline_invalid')
            now=self.check()
            if deadline_ns-now>120_000_000_000:self.fail('deadline_invalid')
            self.last_step=now
            for name in NAMES:self.identity(name)
        except Exception:
            if self.reason is None:self.reason='adapter_unavailable';self.status='held'
            self.close()

    def fail(self,reason):
        self.reason=self.reason or reason;self.status='held';raise Held(self.reason)

    def check(self):
        if self.reason is not None:raise Held(self.reason)
        try:cancel=self.cancelled();now=self.clock()
        except Exception:self.fail('clock_unavailable')
        if cancel is not False:self.fail('cancelled')
        if type(now) is not int or not 0<=now<=2**63-1 or self.last is not None and now<self.last:self.fail('clock_unavailable')
        self.last=now
        if now>=self.deadline:self.fail('deadline')
        if self.last_step is not None and now-self.last_step>POLL:self.fail('poll_late')
        if self.drain_deadline is not None and now>=self.drain_deadline:self.fail('drain_deadline')
        return now

    def call(self,fn,*args):
        self.check()
        try:r=fn(*args)
        except Exception:self.fail('adapter_unavailable')
        self.check();return r

    def identity(self,name):
        key=self.call(self.adapter.identity,name)
        if type(key) is not tuple or len(key)!=3 or any(type(v) is not int for v in key) or key!=self.keys[name]:self.fail('identity_changed')

    def observe_terminal(self):
        value=self.call(self.adapter.terminal)
        if type(value) is not dict or set(value)!= {'exited','exit_code','final_write_completed'} or type(value['exited']) is not bool or type(value['final_write_completed']) is not bool:self.fail('terminal_invalid')
        if not value['exited']:
            if value['exit_code'] is not None or value['final_write_completed']:self.fail('terminal_invalid')
            if self.terminal is not None:self.fail('terminal_changed')
            return
        if type(value['exit_code']) is not int or not 0<=value['exit_code']<=255:self.fail('terminal_invalid')
        token=(value['exit_code'],value['final_write_completed'])
        if self.terminal is not None and token!=self.terminal:self.fail('terminal_changed')
        if token!=(0,True):self.fail('terminal_uncertain')
        if self.terminal is None:
            self.terminal=token;self.drain_deadline=min(self.deadline,self.check()+DRAIN)
            self.identity('final')
            if self.call(self.adapter.close_keeper) is not True:self.fail('keeper_close_unverified')
            self.keeper_closed=True

    def step(self):
        if self.status!='pending':return self.receipt()
        try:
            self.check();self.observe_terminal()
            for name in NAMES:
                if self.eof[name]:continue
                self.identity(name)
                remaining=CAPS[name]-len(self.buffers[name]);aggregate=AGGREGATE-sum(map(len,self.buffers.values()))
                maximum=min(CHUNK,remaining+1,aggregate+1)
                data=self.call(self.adapter.read,name,maximum) # adapter must return immediately; no readiness wait
                self.identity(name)
                if data is None:continue
                if type(data) is not bytes or len(data)>maximum:self.fail('read_invalid')
                if not data:
                    if name!='final' or self.keeper_closed:self.eof[name]=True
                    continue # prewriter final EOF never completes
                if len(data)>remaining or len(data)>aggregate:self.fail('capture_bound')
                if name=='stdout':
                    for part in data.split(b'\n')[:-1]:
                        if self.frame_bytes+len(part)>FRAME:self.fail('frame_bound')
                        self.frame_bytes=0
                    tail=data.rsplit(b'\n',1)[-1]
                    self.frame_bytes=(0 if b'\n' in data else self.frame_bytes)+len(tail)
                    if self.frame_bytes>FRAME:self.fail('frame_bound')
                self.buffers[name].extend(data)
            self.observe_terminal()
            if self.terminal is not None and all(self.eof.values()):
                if self.frame_bytes:self.fail('partial_frame')
                self.status='completed';self.close()
                if self.reason is None:self.check()
            self.last_step=self.check()
        except Exception:
            if self.reason is None:self.reason='adapter_unavailable';self.status='held'
            self.close()
        return self.receipt()

    def close(self):
        if self.reason is not None:
            self.status='held'
            for buffer in self.buffers.values():buffer.clear()
        if self.closed:return
        self.closed=True
        if not self.keeper_closed and 'final' in self.keys:
            try:
                current=self.adapter.identity('final')
                if type(current) is tuple and len(current)==3 and all(type(v) is int for v in current) and current==self.keys['final']:
                    if self.adapter.abort_keeper() is not True:self.reason=self.reason or 'cleanup_unavailable'
                else:self.reason=self.reason or 'cleanup_identity_changed'
            except Exception:self.reason=self.reason or 'cleanup_unavailable'
        seen=set()
        for name,key in self.keys.items():
            if key in seen:continue
            seen.add(key)
            try:
                current=self.adapter.identity(name)
                if type(current) is tuple and len(current)==3 and all(type(v) is int for v in current) and current==key:self.adapter.close(name)
                else:self.reason=self.reason or 'cleanup_identity_changed'
            except Exception:self.reason=self.reason or 'cleanup_unavailable'
        if self.reason is not None:
            self.status='held'
            for buffer in self.buffers.values():buffer.clear()

    def payload(self):
        if self.status!='completed' or self.reason is not None:raise Held('payload_unavailable')
        try:
            self.check();result={n:bytes(b) for n,b in self.buffers.items()};self.check();return result
        except Exception:
            self.status='held'
            for b in self.buffers.values():b.clear()
            raise Held(self.reason or 'payload_unavailable') from None

    def coordination_step(self):
        r=self.step()
        return {'status':'failed' if r['status']=='held' else r['status'],
                'terminal_observed':r['terminal_observed'],'exit_code':r['exit_code'],
                'final_write_completed':r['final_write_completed']}

    def receipt(self):
        return {'status':self.status,'terminal_observed':self.status=='completed','exit_code':0 if self.status=='completed' else None,
                'final_write_completed':self.status=='completed','reason':self.reason,
                'execution_authorized':False,'capacity_authorization':False,'resource_contained':False,'cleanup_verified':False,
                'pre_effect_proven':False,'replay_authorized':False}

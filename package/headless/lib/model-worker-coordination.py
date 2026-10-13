"""Pure explicit-step supervisor coordination. No native process/pipe implementation."""
import importlib.util
from pathlib import Path
import sys
import time

_spec=importlib.util.spec_from_file_location('worker_coordination_contracts',Path(__file__).with_name('model-worker-observation.py'))
basis=importlib.util.module_from_spec(_spec);sys.modules[_spec.name]=basis;_spec.loader.exec_module(basis)
Held=basis.Held
POLL_NS=50_000_000
RESERVE_NS=500_000_000


class Coordinator:
    def __init__(self,policy,owner,child,channels,*,clock=time.monotonic_ns,cancelled=lambda:False):
        self.policy=basis.Policy.parse(policy);self.owner=basis.Owner.parse(owner);self.child=basis.Process.parse(child)
        if self.child.pid==self.owner.creator_pid or self.child.uid!=self.owner.uid:raise Held('identity_invalid')
        basis.closed(channels,('schema','launch_ack_fd','launch_confirm_fd','stopped_status_fd','release_fd'))
        if channels!={'schema':'temperance.worker-coordinate-channels.v1','launch_ack_fd':4,'launch_confirm_fd':3,'stopped_status_fd':5,'release_fd':6} or any(type(channels[k]) is not int for k in ('launch_ack_fd','launch_confirm_fd','stopped_status_fd','release_fd')):raise Held('channels_invalid')
        self.deadline=min(self.owner.invocation_deadline_ns,self.owner.created_ns+self.policy.wall_ns)
        self.clock,self.cancelled=clock,cancelled;self.last=None;self.last_poll=None
        self.reason=None;self.status='retained-stopped';self.released=False;self.cleanup_attempted=False;self.emergency_deadline=None;self.steps=0
        self.last_poll=self.check()

    def hold(self,reason):
        self.reason=self.reason or reason;self.status='held';raise Held(self.reason)

    def now(self):
        try:value=self.clock()
        except Exception:self.hold('clock_unavailable')
        if type(value) is not int or not 0<=value<=2**63-1 or value<self.owner.created_ns or self.last is not None and value<self.last:self.hold('clock_unavailable')
        self.last=value;return value

    def check(self):
        if self.reason is not None:raise Held(self.reason)
        try:cancel=self.cancelled()
        except Exception:self.hold('cancelled')
        if cancel is not False:self.hold('cancelled')
        now=self.now()
        if now>=self.deadline-RESERVE_NS:self.hold('cleanup_reserve')
        if self.last_poll is not None and now-self.last_poll>POLL_NS:self.hold('poll_late')
        return now

    def callback(self,fn,*args):
        start=self.check()
        try:result=fn(*args)
        except Exception:self.hold('adapter_unavailable')
        end=self.check()
        if end-start>POLL_NS:self.hold('poll_late')
        return result

    def resource(self,adapter,*,stopped):
        r=self.callback(adapter.observe)
        basis.closed(r,('creator_pid','creator_uid','creator_birth','pid','uid','birth','parent_pid','state','pressure','rss_bytes','physical_bytes','descendants','lifetime_count','identity_certain'))
        expected=(self.owner.creator_pid,self.owner.uid,self.owner.creator_birth,self.child.pid,self.child.uid,self.child.birth,self.owner.creator_pid)
        actual=tuple(r[k] for k in ('creator_pid','creator_uid','creator_birth','pid','uid','birth','parent_pid'))
        for k in ('creator_pid','creator_uid','pid','uid','parent_pid'):
            if type(r[k]) is not int:self.hold('identity_unavailable')
        if actual!=expected or r['identity_certain'] is not True or r['state'] not in ('live','stopped') or stopped and r['state']!='stopped':self.hold('identity_unavailable')
        if r['pressure']!='normal':self.hold('pressure_unavailable')
        for key,limit in (('rss_bytes',self.policy.rss_bytes),('physical_bytes',self.policy.physical_bytes),('descendants',self.policy.active_descendants)):
            if type(r[key]) is not int or not 0<=r[key]<=limit:self.hold('resource_limit')
        if type(r['lifetime_count']) is not int or not 1<=r['lifetime_count']<=self.policy.lifetime_identities:self.hold('resource_limit')
        self.last_poll=self.check()

    def release(self,adapter):
        if self.released or self.status!='retained-stopped':raise Held('release_already_attempted')
        # Mark intent before callback; uncertain acknowledgement never repeats release.
        self.released=True
        try:
            self.resource(adapter,stopped=True)
            if self.callback(adapter.close_parent_channels) is not True:self.hold('parent_close_unverified')
            self.resource(adapter,stopped=True)
            if self.callback(adapter.release) is not True:self.hold('release_unverified')
            self.status='injected-release-observed'
        except Held:
            if self.reason is None:self.reason='adapter_unavailable';self.status='held'
        except Exception:self.reason='adapter_unavailable';self.status='held'
        return self.receipt()

    def step(self,adapter,capture):
        try:
            self.check()
            if not self.released or self.status!='injected-release-observed':self.hold('capture_not_ready')
            if self.steps>=256:self.hold('step_bound')
            self.resource(adapter,stopped=False)
            result=self.callback(capture.step)
            basis.closed(result,('status','terminal_observed','exit_code','final_write_completed'))
            if result['status']=='pending':
                if result['terminal_observed'] is not False or result['exit_code'] is not None or result['final_write_completed'] is not False:self.hold('capture_invalid')
            elif result['status']=='completed':
                if result['terminal_observed'] is not True or type(result['exit_code']) is not int or result['exit_code']!=0 or result['final_write_completed'] is not True:self.hold('capture_uncertain')
                self.status='injected-completion-observed'
            elif result['status']=='failed':self.hold('capture_failed')
            else:self.hold('capture_invalid')
            self.steps+=1;self.last_poll=self.check()
        except Held:
            if self.reason is None:self.reason='adapter_unavailable';self.status='held'
        except Exception:self.reason='adapter_unavailable';self.status='held'
        return self.receipt()

    def cleanup(self,adapter):
        if self.cleanup_attempted:return self.receipt()
        self.cleanup_attempted=True;self.status='held';self.reason=self.reason or 'cleanup_only'
        try:
            now=self.now();limit=self.deadline
            if now>=limit:self.emergency_deadline=min(2**63-1,now+RESERVE_NS);limit=self.emergency_deadline
            if now>=limit:return self.receipt()
            r=adapter.cleanup_identity()
            now=self.now()
            basis.closed(r,('pid','uid','birth'))
            if type(r['pid']) is not int or type(r['uid']) is not int or (r['pid'],r['uid'],r['birth'])!=(self.child.pid,self.child.uid,self.child.birth) or now>=limit:return self.receipt()
            adapter.terminate()
            self.now() # observation only; no exact termination or cleanup proof
        except Exception:pass  # preserve finite first reason; cleanup remains unverified
        return self.receipt()

    def receipt(self):
        return {'schema':'temperance.worker-coordination.v1','status':self.status,'reason':self.reason,'steps':self.steps,
                'launch_slot_retained':True,'cleanup_attempted':self.cleanup_attempted,'emergency_cleanup':self.emergency_deadline is not None,
                'execution_authorized':False,'capacity_authorization':False,'resource_contained':False,'cleanup_verified':False,
                'actual_phase_role_verified':False,'inference_verified':False,'pre_effect_proven':False,'replay_authorized':False}

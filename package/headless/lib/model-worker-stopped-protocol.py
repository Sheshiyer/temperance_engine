"""Pure injected stopped adapter protocol. No process, FD, native call or signal."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import time

_spec=importlib.util.spec_from_file_location('stopped_protocol_basis',Path(__file__).with_name('model-worker-observation.py'))
basis=importlib.util.module_from_spec(_spec);sys.modules[_spec.name]=basis;_spec.loader.exec_module(basis)
Held=basis.Held


def darwin_birth(value):
    if type(value) is not str or len(value)>48:raise Held('birth_invalid')
    match=re.fullmatch(r'darwin:([0-9]{1,20}):([0-9]{1,20})',value)
    if match is None or int(match[1])<=0 or int(match[2])>=1_000_000:raise Held('birth_invalid')
    raw=value.encode('ascii')
    if len(raw)>48:raise Held('birth_invalid')
    return raw


def decode_status(raw,owner,pid):
    if type(raw) is not bytes or len(raw)>480:raise Held('status_bound')
    try:
        text=raw.decode('utf-8','strict');depth=0;quoted=False;escaped=False
        for ch in text:
            if quoted:
                if escaped:escaped=False
                elif ch=='\\':escaped=True
                elif ch=='"':quoted=False
            elif ch=='"':quoted=True
            elif ch in '[{':
                depth+=1
                if depth>4:raise Held('status_invalid')
            elif ch in ']}':depth-=1
        def pairs(items):
            result={}
            for key,value in items:
                if key in result:raise Held('status_invalid')
                result[key]=value
            return result
        value=json.loads(text,object_pairs_hook=pairs,parse_constant=lambda _:(_ for _ in ()).throw(Held('status_invalid')))
        pending=[value];nodes=0
        while pending:
            item=pending.pop();nodes+=1
            if nodes>32:raise Held('status_invalid')
            if type(item) is dict:
                pending.extend(item.keys());pending.extend(item.values())
            elif type(item) is list:pending.extend(item)
        basis.closed(value,('schema','nonce','counter','pid','stage'))
        expected={'schema':'temperance.worker-stopped-status.v1','nonce':owner.nonce,'counter':owner.counter,'pid':pid,'stage':'before-payload-exec'}
        if type(value['counter']) is not int or type(value['pid']) is not int or value!=expected:raise Held('status_invalid')
        return value
    except Exception:raise Held('status_invalid') from None


def control(owner,pid,uid,birth):
    basis.integer(pid,2,2**31-1);basis.integer(uid,0,2**32-1)
    basis.integer(owner.invocation_deadline_ns,1,2**63-1)
    return b'TWR1'+bytes.fromhex(owner.nonce)+owner.counter.to_bytes(1,'big')+owner.invocation_deadline_ns.to_bytes(8,'big')+pid.to_bytes(4,'big')+uid.to_bytes(4,'big')+hashlib.sha256(darwin_birth(birth)).digest()


class StoppedProtocol:
    def __init__(self,policy,owner,child_pid,*,clock=time.monotonic_ns,cancelled=lambda:False):
        self.policy=basis.Policy.parse(policy);self.owner=basis.Owner.parse(owner)
        self.pid=basis.integer(child_pid,2,2**31-1)
        if self.pid==self.owner.creator_pid:raise Held('pid_invalid')
        darwin_birth(self.owner.creator_birth)
        self.clock,self.cancelled=clock,cancelled;self.deadline=min(self.owner.invocation_deadline_ns,self.owner.created_ns+self.policy.wall_ns)
        self.last=None;self.last_step=None;self.reason=None;self.phase='owner-ack';self.steps=0
        self.raw=bytearray();self.length=None;self.child=None;self.write_attempted=False;self.continue_attempted=False;self.write_count_verified=False;self.owner_ack_observed=False
        self.last_step=self.check()

    def fail(self,reason):
        self.reason=self.reason or reason;self.phase='held';self.raw.clear();raise Held(self.reason)

    def check(self):
        if self.reason is not None:raise Held(self.reason)
        try:now=self.clock();cancel=self.cancelled()
        except Exception:self.fail('clock_unavailable')
        if type(now) is not int or not self.owner.created_ns<=now<=2**63-1 or self.last is not None and now<self.last:self.fail('clock_unavailable')
        self.last=now
        if cancel is not False:self.fail('cancelled')
        if now>=self.deadline-500_000_000:self.fail('cleanup_reserve')
        if self.last_step is not None and now-self.last_step>50_000_000:self.fail('poll_late')
        return now

    def call(self,fn,*args):
        self.check()
        try:r=fn(*args)
        except Exception:self.fail('adapter_unavailable')
        self.check();return r

    def resource(self,adapter):
        r=self.call(adapter.observe_stopped)
        if r is None:return False
        basis.closed(r,('creator_pid','creator_uid','creator_birth','pid','uid','birth','parent_pid','state','pressure','rss_bytes','physical_bytes','descendants','lifetime_count'))
        for key in ('creator_pid','creator_uid','pid','uid','parent_pid'):
            if type(r[key]) is not int:self.fail('identity_unavailable')
        if (r['creator_pid'],r['creator_uid'],r['creator_birth'],r['pid'],r['uid'],r['parent_pid'])!=(self.owner.creator_pid,self.owner.uid,self.owner.creator_birth,self.pid,self.owner.uid,self.owner.creator_pid):self.fail('identity_unavailable')
        darwin_birth(r['birth'])
        token=(self.pid,self.owner.uid,r['birth'])
        if self.child is not None and self.child!=token:self.fail('birth_changed')
        if r['state']!='stopped':self.fail('not_stopped')
        if r['pressure']!='normal':self.fail('pressure_unavailable')
        for key,limit in (('rss_bytes',self.policy.rss_bytes),('physical_bytes',self.policy.physical_bytes),('descendants',0)):
            if type(r[key]) is not int or not 0<=r[key]<=limit:self.fail('resource_limit')
        if type(r['lifetime_count']) is not int or not 1<=r['lifetime_count']<=self.policy.lifetime_identities:self.fail('resource_limit')
        if self.child is None:self.child=token
        return True

    def step(self,adapter):
        if self.phase in ('held','injected-continuation-observed'):return self.receipt()
        try:
            self.check()
            if self.steps>=256:self.fail('step_bound')
            if self.phase=='owner-ack':
                ack=self.call(adapter.retained_owner_ack)
                expected={'schema':'temperance.trusted-worker-owner-ack.v1','nonce':self.owner.nonce,'counter':self.owner.counter,'deadline_ns':self.owner.invocation_deadline_ns,'creator_pid':self.owner.creator_pid,'uid':self.owner.uid,'creator_birth':self.owner.creator_birth,'ack_eof_retained':True}
                if type(ack) is not dict or set(ack)!=set(expected) or any(type(ack[k]) is not int for k in ('counter','deadline_ns','creator_pid','uid')) or ack.get('ack_eof_retained') is not True or ack!=expected:self.fail('owner_ack_unavailable')
                self.owner_ack_observed=True
                if self.call(adapter.close_parent_copies) is not True:self.fail('parent_close_unverified')
                self.phase='status'
            elif self.phase=='status':
                maximum=min(64,485-len(self.raw))
                data=self.call(adapter.read_status,maximum)
                if data is not None:
                    if type(data) is not bytes or len(data)>maximum:self.fail('status_invalid')
                    if data:
                        if len(self.raw)+len(data)>484:self.fail('status_bound')
                        self.raw.extend(data)
                        if len(self.raw)>=4:
                            self.length=int.from_bytes(self.raw[:4],'big')
                            if not 1<=self.length<=480 or len(self.raw)>self.length+4:self.fail('status_bound')
                    else:
                        if self.length is None or len(self.raw)!=self.length+4:self.fail('status_incomplete')
                        decode_status(bytes(self.raw[4:]),self.owner,self.pid);self.raw.clear();self.phase='native-stop'
            elif self.phase=='native-stop':
                if self.resource(adapter):self.phase='control'
            elif self.phase=='control':
                if not self.resource(adapter):self.fail('identity_unavailable')
                bound=self.call(adapter.atomic_pipe_bound)
                if type(bound) is not int or bound<69:self.fail('atomic_bound_unavailable')
                packet=control(self.owner,*self.child);self.write_attempted=True
                result=self.call(adapter.write_control,packet)
                if type(result) is not int or result!=69:self.fail('control_write_uncertain')
                self.write_count_verified=True
                if self.call(adapter.close_control_writer) is not True:self.fail('control_close_unverified')
                if not self.resource(adapter):self.fail('identity_unavailable')
                self.continue_attempted=True
                if self.call(adapter.continue_child) is not True:self.fail('continuation_uncertain')
                self.phase='injected-continuation-observed'
            self.steps+=1;self.last_step=self.check()
        except Exception:
            if self.reason is None:self.reason='adapter_unavailable'
            self.phase='held';self.raw.clear()
        return self.receipt()

    def receipt(self):
        return {'schema':'temperance.worker-stopped-protocol.v1','status':self.phase,'reason':self.reason,'steps':self.steps,
                'trusted_owner_slot_precondition':True,'owner_ack_observed':self.owner_ack_observed,'control_write_attempted':self.write_attempted,'write_return_count_verified':self.write_count_verified,
                'continuation_attempted':self.continue_attempted,'execution_authorized':False,'capacity_authorization':False,
                'resource_contained':False,'cleanup_verified':False,'actual_phase_role_verified':False,'pre_effect_proven':False,'replay_authorized':False}

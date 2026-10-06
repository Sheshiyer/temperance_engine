"""Pure injected dual-reservation/owner-chain state. No native or process effects."""
import re
import time
from types import MappingProxyType
FLAGS=('execution_authorized','capacity_authorization','inference_authorized')
RECEIPT={'schema','operation','status','nonce','counter','launch_limit',*FLAGS}
TOKEN={'pid','uid','birth','kernel_start_token'}
PROCESS=TOKEN|{'parent_pid','parent_uid','parent_birth'}
class Held(Exception):pass
def closed(v,keys):
    if type(v) is not dict or len(v)!=len(keys) or any(type(k) is not str or len(k)>64 for k in v) or set(v)!=keys:raise Held('metadata_invalid')
def integer(v,lo,hi):
    if type(v) is not int or not lo<=v<=hi:raise Held('metadata_invalid')
def birth(v):
    if type(v) is not str or len(v)>48:raise Held('metadata_invalid')
    m=re.fullmatch(r'darwin:([0-9]{1,20}):([0-9]{1,20})',v)
    if m is None or int(m[1])<=0 or int(m[2])>=1000000:raise Held('metadata_invalid')
def token(v,process=False):
    closed(v,PROCESS if process else TOKEN);integer(v['pid'],2,2**31-1);integer(v['uid'],0,2**32-1);integer(v['kernel_start_token'],1,2**63-1);birth(v['birth'])
    if process:integer(v['parent_pid'],2,2**31-1);integer(v['parent_uid'],0,2**32-1);birth(v['parent_birth'])
    return MappingProxyType(dict(v))
def receipt(v,nonce,count):
    closed(v,RECEIPT);expected={'schema':'temperance.cli-launch-budget.v1','operation':'create' if count==0 else 'reserve','status':'created' if count==0 else 'reserved','nonce':nonce,'counter':count,'launch_limit':2,**{f:False for f in FLAGS}}
    if any(type(v[k]) is not type(expected[k]) or v[k]!=expected[k] for k in RECEIPT):raise Held('receipt_invalid')
    return MappingProxyType(dict(v))
def escaped_size(v):
    try:return len(v.encode('utf8'))+sum(5 if ord(c)<32 else 1 if c in ('"','\\') else 0 for c in v)+2
    except UnicodeError:raise Held('metadata_invalid') from None
class OwnerChain:
    def __init__(self,context,*,clock=time.monotonic_ns):
        closed(context,{'schema','directory','creator','created_ns','invocation_deadline_ns','exchange_deadline_ns','create_receipt'})
        if type(context['schema']) is not str or context['schema']!='temperance.owner-chain-input.v2':raise Held('metadata_invalid')
        path=context['directory']
        if type(path) is not str or not 1<=len(path)<=4096 or not path.startswith('/') or '\x00' in path or any(p in ('','.','..') for p in path.split('/')[1:]):raise Held('metadata_invalid')
        try:
            if len(path.encode('utf8'))>4096:raise Held('metadata_invalid')
        except UnicodeError:raise Held('metadata_invalid') from None
        r=context['create_receipt'];closed(r,RECEIPT);nonce=r['nonce']
        if type(nonce) is not str or len(nonce)!=32 or re.fullmatch('[0-9a-f]{32}',nonce) is None:raise Held('metadata_invalid')
        creator=token(context['creator']);created_receipt=receipt(r,nonce,0)
        for k in ('created_ns','invocation_deadline_ns','exchange_deadline_ns'):integer(context[k],0 if k=='created_ns' else 1,2**63-1)
        created=context['created_ns'];deadline=context['invocation_deadline_ns'];exchange=context['exchange_deadline_ns']
        if not 0<deadline-created<=120000000000 or not 0<exchange-created<=2000000000 or exchange>deadline:raise Held('metadata_invalid')
        bound=2
        for record in (context,dict(creator),dict(created_receipt)):
            for k,v in record.items():
                bound+=escaped_size(k)+3
                if type(v) is str:bound+=escaped_size(v)
                elif type(v) is int:bound+=20
                elif type(v) is bool:bound+=5
                elif type(v) is dict:bound+=2
                else:raise Held('metadata_invalid')
        if bound>16384:raise Held('metadata_bound')
        self.context=MappingProxyType({**context,'creator':creator,'create_receipt':created_receipt});self.creator=creator;self.nonce=nonce;self.clock=clock;self.created=created;self.deadline=deadline;self.exchange=exchange
        self.last=None;self.reason=None;self.reserve_attempted=[False,False];self.reservations=[None,None];self.supervisor=None;self.worker=None;self.supervisor_attempted=False;self.worker_attempted=False;self.supervisor_admitted=False;self.worker_admitted=False;self.check()
    def fail(self,reason):self.reason=self.reason or reason;raise Held(self.reason)
    def check(self):
        if self.reason:raise Held(self.reason)
        try:now=self.clock()
        except Exception:self.fail('clock_unavailable')
        if type(now) is not int or not self.created<=now<=2**63-1 or self.last is not None and now<self.last:self.fail('clock_unavailable')
        self.last=now
        if now>=self.exchange:self.fail('deadline')
        return now
    def call(self,fn,*args):
        self.check()
        try:v=fn(*args)
        except Exception:self.fail('callback_unavailable')
        self.check();return v
    def observe(self,fn,expected,process=False):
        try:v=token(self.call(fn),process)
        except Held:self.fail('identity_unavailable')
        if dict(v)!=dict(expected):self.fail('identity_changed')
    def retain_two(self,reserve,observe_creator):
        self.check()
        if any(self.reserve_attempted):self.fail('reservation_already_attempted')
        for index in range(2):
            self.observe(observe_creator,self.creator);self.reserve_attempted[index]=True
            try:v=reserve(self.context,index)
            except Exception:self.fail('reservation_response_unknown')
            try:self.reservations[index]=receipt(v,self.nonce,index+1)
            except Held:self.fail('reservation_invalid')
            self.check();self.observe(observe_creator,self.creator)
        return self.receipt()
    def reported_process(self,value):
        try:v=token(value,True)
        except Held:self.fail('reported_token_invalid')
        return v
    def relation(self,v,parent,exclude):
        if v['pid'] in exclude or v['uid']!=self.creator['uid'] or (v['parent_pid'],v['parent_uid'],v['parent_birth'])!=(parent['pid'],parent['uid'],parent['birth']):self.fail('reported_chain_invalid')
    def create_supervisor(self,create,observe_creator):
        self.check()
        if not all(self.reservations):self.fail('reservations_missing')
        if self.supervisor_attempted:self.fail('creation_already_attempted')
        self.observe(observe_creator,self.creator);self.supervisor_attempted=True
        try:value=create(self.context,self.reservations[0])
        except Exception:self.fail('creation_response_unknown')
        self.supervisor=self.reported_process(value) # retain bounded candidate before relation/clock/identity
        self.relation(self.supervisor,self.creator,{self.creator['pid']});self.check();self.observe(observe_creator,self.creator);self.supervisor_admitted=True
        return self.receipt()
    def create_worker(self,create,observe_supervisor,observe_creator):
        self.check()
        if not all(self.reservations) or not self.supervisor_admitted:self.fail('supervisor_not_admitted')
        if self.worker_attempted:self.fail('creation_already_attempted')
        self.observe(observe_creator,self.creator);self.observe(observe_supervisor,self.supervisor,True);self.worker_attempted=True
        try:value=create(self.context,self.reservations[1],self.supervisor)
        except Exception:self.fail('creation_response_unknown')
        self.worker=self.reported_process(value) # cleanup candidate, not authority
        self.relation(self.worker,self.supervisor,{self.creator['pid'],self.supervisor['pid']});self.check();self.observe(observe_creator,self.creator);self.observe(observe_supervisor,self.supervisor,True);self.worker_admitted=True
        return self.receipt()
    def receipt(self):return {'schema':'temperance.owner-chain-receipt.v2','status':'held' if self.reason else 'reported-worker-admitted' if self.worker_admitted else 'reported-supervisor-admitted' if self.supervisor_admitted else 'pending','reason':self.reason,'reservation_attempt_count':sum(self.reserve_attempted),'reservation_response_retained_count':sum(v is not None for v in self.reservations),'supervisor_create_attempted':self.supervisor_attempted,'worker_create_attempted':self.worker_attempted,'first_reported_supervisor_token_retained':self.supervisor is not None,'first_reported_worker_token_retained':self.worker is not None,'supervisor_creation_admitted':self.supervisor_admitted,'worker_creation_admitted':self.worker_admitted,'native_authentication':False,'native_cleanup_authority':False,**{f:False for f in FLAGS}}

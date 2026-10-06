"""Pure trusted-owner profile; no budget creation, file, FD or process operations."""
import re
import time
from types import MappingProxyType
FLAGS=('execution_authorized','capacity_authorization','inference_authorized')
BUDGET_KEYS={'schema','operation','status','nonce','counter','launch_limit',*FLAGS}
HANDLE_KEYS={'schema','directory','nonce','expected_counter','launch_limit','invocation_deadline_ns','exchange_deadline_ns',*FLAGS}
ACK_KEYS=(HANDLE_KEYS-{'directory'})|{'counter'}
class Held(Exception):pass
def closed(value,keys):
    if type(value) is not dict or len(value)!=len(keys):raise Held('context_invalid')
    if any(type(k) is not str or len(k)>64 for k in value):raise Held('context_invalid')
    if set(value)!=keys:raise Held('context_invalid')
    return value
def integer(v,lo,hi):
    if type(v) is not int or not lo<=v<=hi:raise Held('context_invalid')
    return v
def creator(v):
    closed(v,{'pid','uid','birth'});integer(v['pid'],2,2**31-1);integer(v['uid'],0,2**32-1)
    b=v['birth']
    if type(b) is not str or len(b)>48:raise Held('context_invalid')
    match=re.fullmatch(r'darwin:([0-9]{1,20}):([0-9]{1,20})',b)
    if not match or int(match[1])<=0 or int(match[2])>=1_000_000:raise Held('context_invalid')
    return MappingProxyType(dict(v))
def budget(v,nonce,limit,counter):
    closed(v,BUDGET_KEYS)
    expected={'schema':'temperance.cli-launch-budget.v1','operation':'create' if counter==0 else 'reserve','status':'created' if counter==0 else 'reserved','nonce':nonce,'counter':counter,'launch_limit':limit,**{f:False for f in FLAGS}}
    if any(type(v[k]) is not type(expected[k]) or v[k]!=expected[k] for k in expected):raise Held('receipt_invalid')
    return MappingProxyType(dict(v))
class PreReservedProfile:
    def __init__(self,context,*,clock=time.monotonic_ns):
        closed(context,{'directory','create_receipt','creator','created_ns','invocation_deadline_ns','exchange_deadline_ns'})
        path=context['directory']
        if type(path) is not str or not 1<=len(path)<=4096 or not path.startswith('/') or '\x00' in path or any(p in ('','.','..') for p in path.split('/')[1:]):raise Held('context_invalid')
        try:valid=len(path.encode('utf8'))<=4096
        except UnicodeError:valid=False
        if not valid:raise Held('context_invalid')
        r=closed(context['create_receipt'],BUDGET_KEYS);nonce=r['nonce'];limit=integer(r['launch_limit'],1,4)
        if type(nonce) is not str or len(nonce)!=32 or re.fullmatch('[0-9a-f]{32}',nonce) is None:raise Held('context_invalid')
        self.created=integer(context['created_ns'],0,2**63-1);self.deadline=integer(context['invocation_deadline_ns'],1,2**63-1);self.exchange=integer(context['exchange_deadline_ns'],1,self.deadline)
        self.creator=creator(context['creator']);self.created_receipt=budget(r,nonce,limit,0)
        self.handle=MappingProxyType({'schema':'temperance.cli-launch-handle.v1','directory':path,'nonce':nonce,'expected_counter':0,'launch_limit':limit,'invocation_deadline_ns':self.deadline,'exchange_deadline_ns':self.exchange,**{f:False for f in FLAGS}})
        self.clock=clock;self.last=None;self.reason=None;self.reserve_attempted=False;self.create_attempted=False;self.supply_attempted=False;self.retain_attempted=False;self.reservation=None;self.ack=None;self.injected_create_observed=False
        now=self.check()
        if not 0<self.deadline-self.created<=120_000_000_000 or not 0<self.exchange-self.created<=2_000_000_000:self.fail('context_invalid')
    def fail(self,reason):self.reason=self.reason or reason;raise Held(self.reason)
    def check(self):
        if self.reason:raise Held(self.reason)
        try:now=self.clock()
        except Exception:self.fail('clock_unavailable')
        if type(now) is not int or not self.created<=now<=2**63-1 or self.last is not None and now<self.last:self.fail('clock_unavailable')
        self.last=now
        if now>=self.exchange or now>=self.deadline:self.fail('deadline')
        return now
    def call(self,fn,*args):
        self.check()
        try:r=fn(*args)
        except Exception:self.fail('callback_unavailable')
        self.check();return r
    def observe(self,fn):
        try:value=creator(self.call(fn))
        except Held:self.fail('creator_unavailable')
        if dict(value)!=dict(self.creator):self.fail('creator_changed')
    def reserve_and_create(self,reserve,create,observe):
        self.check()
        if self.reserve_attempted:self.fail('reserve_already_attempted')
        self.observe(observe);self.reserve_attempted=True
        value=self.call(reserve,self.handle)
        try:self.reservation=budget(value,self.handle['nonce'],self.handle['launch_limit'],1)
        except Held:self.fail('reservation_unavailable')
        self.observe(observe);self.check();self.create_attempted=True
        value=self.call(create,self.handle,self.reservation)
        if value is not True:self.fail('creation_unverified')
        self.observe(observe);self.injected_create_observed=True
        return self.receipt()
    def receipt_supplier(self,received_handle):
        self.check()
        if self.supply_attempted:self.fail('supply_already_attempted')
        self.supply_attempted=True
        if self.reservation is None or not self.injected_create_observed:self.fail('reservation_unavailable')
        try:closed(received_handle,HANDLE_KEYS)
        except Held:self.fail('handle_unavailable')
        if any(type(received_handle[k]) is not type(self.handle[k]) or received_handle[k]!=self.handle[k] for k in HANDLE_KEYS):self.fail('handle_unavailable')
        return dict(self.reservation)
    def retain_ack(self,ack,ack_eof_retained):
        self.check()
        if self.retain_attempted:self.fail('retain_already_attempted')
        self.retain_attempted=True
        if not self.supply_attempted or self.reservation is None or ack_eof_retained is not True:self.fail('ack_unavailable')
        try:closed(ack,ACK_KEYS)
        except Held:self.fail('ack_unavailable')
        expected={k:v for k,v in self.handle.items() if k!='directory'};expected.update(schema='temperance.cli-launch-ack.v1',counter=1)
        if any(type(ack[k]) is not type(expected[k]) or ack[k]!=expected[k] for k in ACK_KEYS):self.fail('ack_unavailable')
        self.ack=MappingProxyType(dict(ack));return None
    def receipt(self):return {'schema':'temperance.pre-reserved-profile.v1','status':'held' if self.reason else 'injected-create-observed' if self.injected_create_observed else 'pending','reason':self.reason,'reserve_attempted':self.reserve_attempted,'reservation_response_retained':self.reservation is not None,'create_attempted':self.create_attempted,'codec_ack_observed':self.ack is not None,**{f:False for f in FLAGS}}

def trusted_codec_copy(value):
    """Only codec-owned closed frozen scalar DTOs; not arbitrary Mapping intake."""
    if type(value) not in (dict,MappingProxyType) or len(value)>10:raise Held('codec_context_invalid')
    result={};encoded_upper=2
    for k,v in value.items():
        if type(k) is not str or len(k)>64:raise Held('codec_context_invalid')
        if type(v) is str:
            if len(v)>4096:raise Held('codec_context_invalid')
            try:
                if len(v.encode('utf8'))>4096:raise Held('codec_context_invalid')
            except UnicodeError:raise Held('codec_context_invalid') from None
        elif type(v) is int:
            if not 0<=v<=2**63-1:raise Held('codec_context_invalid')
        elif type(v) is not bool:raise Held('codec_context_invalid')
        # Conservative JSON escape upper bound, without whole-object serialization.
        escaped=lambda s:len(s.encode('utf8'))+sum(5 if ord(ch)<32 else 1 if ch in ('"','\\') else 0 for ch in s)
        encoded_upper+=escaped(k)+6+(escaped(v)+2 if type(v) is str else 20 if type(v) is int else 5)
        if encoded_upper>16384:raise Held('codec_context_invalid')
        result[k]=v
    return result

class TrustedCodecBridge:
    """Retain callback usable only at owner_exchange's already-validated ACK/EOF seam."""
    def __init__(self,profile):self.profile=profile
    def reserve(self,handle):
        try:value=trusted_codec_copy(handle)
        except Held:self.profile.fail('handle_unavailable')
        return self.profile.receipt_supplier(value)
    def retain_ack(self,ack):
        try:value=trusted_codec_copy(ack)
        except Held:self.profile.fail('ack_unavailable')
        # Caller binding to existing owner_exchange is the trusted EOF precondition.
        return self.profile.retain_ack(value,True)

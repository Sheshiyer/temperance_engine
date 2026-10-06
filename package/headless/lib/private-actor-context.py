"""Pure private v2 actor context codec. No native, FD, process or budget effects."""
import json
import re
from types import MappingProxyType

MAX_BYTES=16384
MAX_NODES=192
FLAGS=('execution_authorized','capacity_authorization','inference_authorized')
ROLES=('original-owner-to-supervisor','supervisor-to-worker')
BASE={'schema','role','directory','creator','create_receipt','supervisor_reservation','worker_reservation','handle','created_ns','invocation_deadline_ns','exchange_deadline_ns','marker',*FLAGS}
TOKEN={'pid','uid','birth','kernel_start_token'}
PROCESS=TOKEN|{'parent_pid','parent_uid','parent_birth'}
RECEIPT={'schema','operation','status','nonce','counter','launch_limit',*FLAGS}
HANDLE={'schema','directory','nonce','expected_counter','launch_limit','invocation_deadline_ns','exchange_deadline_ns',*FLAGS}

class Held(Exception):pass

def closed(value,keys):
    if type(value) is not dict or len(value)!=len(keys) or any(type(k) is not str or len(k)>64 for k in value) or set(value)!=keys:raise Held('context_invalid')

def integer(value,lo,hi):
    if type(value) is not int or not lo<=value<=hi:raise Held('context_invalid')

def exact(value,expected):
    if type(value) is not type(expected) or value!=expected:raise Held('context_invalid')

def birth(value):
    if type(value) is not str or len(value)>48:raise Held('context_invalid')
    match=re.fullmatch(r'darwin:([0-9]{1,20}):([0-9]{1,20})',value)
    if match is None or int(match[1])<=0 or int(match[2])>=1000000:raise Held('context_invalid')

def token(value,process=False):
    closed(value,PROCESS if process else TOKEN)
    integer(value['pid'],2,2**31-1);integer(value['uid'],0,2**32-1);integer(value['kernel_start_token'],1,2**63-1);birth(value['birth'])
    if process:integer(value['parent_pid'],2,2**31-1);integer(value['parent_uid'],0,2**32-1);birth(value['parent_birth'])

def escaped_size(value):
    try:return len(value.encode('utf8'))+sum(5 if ord(c)<32 else 1 if c in ('"','\\') else 0 for c in value)+2
    except UnicodeError:raise Held('context_invalid') from None

def validate(context,now_ns):
    # Exact trusted DTOs only; scalar bounds precede copying. No arbitrary Mapping/get/toJSON.
    if type(context) is not dict or len(context) not in (15,16) or any(type(key) is not str or len(key)>64 for key in context) or 'role' not in context:raise Held('context_invalid')
    role=context['role']
    if type(role) is not str or role not in ROLES:raise Held('context_invalid')
    closed(context,BASE if role==ROLES[0] else BASE|{'supervisor'})
    exact(context['schema'],'temperance.private-actor-context.v2');exact(context['marker'],'inert-metadata-bootstrap-v2')
    for flag in FLAGS:exact(context[flag],False)
    path=context['directory']
    if type(path) is not str or not 1<=len(path)<=4096 or not path.startswith('/') or '\x00' in path or any(p in ('','.','..') for p in path.split('/')[1:]):raise Held('context_invalid')
    try:
        if len(path.encode('utf8'))>4096:raise Held('context_invalid')
    except UnicodeError:raise Held('context_invalid') from None
    creator=context['creator'];token(creator)
    if role==ROLES[1]:
        supervisor=context['supervisor'];token(supervisor,True)
        if supervisor['pid']==creator['pid'] or supervisor['uid']!=creator['uid'] or (supervisor['parent_pid'],supervisor['parent_uid'],supervisor['parent_birth'])!=(creator['pid'],creator['uid'],creator['birth']):raise Held('context_relation_invalid')
    handle=context['handle'];closed(handle,HANDLE)
    exact(handle['schema'],'temperance.cli-launch-handle.v1');exact(handle['directory'],path);exact(handle['launch_limit'],2);exact(handle['expected_counter'],0 if role==ROLES[0] else 1)
    nonce=handle['nonce']
    if type(nonce) is not str or len(nonce)!=32 or re.fullmatch('[0-9a-f]{32}',nonce) is None:raise Held('context_invalid')
    for flag in FLAGS:exact(handle[flag],False)
    for name,counter in (('create_receipt',0),('supervisor_reservation',1),('worker_reservation',2)):
        receipt=context[name];closed(receipt,RECEIPT)
        values={'schema':'temperance.cli-launch-budget.v1','operation':'create' if counter==0 else 'reserve','status':'created' if counter==0 else 'reserved','nonce':nonce,'counter':counter,'launch_limit':2,**{flag:False for flag in FLAGS}}
        for key in RECEIPT:exact(receipt[key],values[key])
    for name in ('created_ns','invocation_deadline_ns','exchange_deadline_ns'):integer(context[name],0 if name=='created_ns' else 1,2**63-1)
    created=context['created_ns'];invocation=context['invocation_deadline_ns'];exchange=context['exchange_deadline_ns']
    if not 0<invocation-created<=120000000000 or not 0<exchange-created<=2000000000 or exchange>invocation:raise Held('context_invalid')
    for name in ('invocation_deadline_ns','exchange_deadline_ns'):exact(handle[name],context[name])
    integer(now_ns,0,2**63-1)
    if not created<=now_ns<exchange:raise Held('context_stale')
    # Conservative literal UTF8 JSON (ensure_ascii=False) bound before detached copies/serialization.
    bound=2
    records=(context,creator,context['create_receipt'],context['supervisor_reservation'],context['worker_reservation'],handle,*((context['supervisor'],) if role==ROLES[1] else ()))
    for record in records:
        bound+=2
        for key,value in record.items():
            bound+=escaped_size(key)+2
            if type(value) is str:bound+=escaped_size(value)
            elif type(value) is int:bound+=20
            elif type(value) is bool:bound+=5
            elif type(value) is dict:continue
            else:raise Held('context_invalid')
    if bound>MAX_BYTES:raise Held('context_bound')
    return {key:dict(value) if type(value) is dict else value for key,value in context.items()}

def freeze(context):return MappingProxyType({key:MappingProxyType(value) if type(value) is dict else value for key,value in context.items()})

def encode_frame(context,now_ns):
    value=validate(context,now_ns);raw=json.dumps(value,ensure_ascii=False,separators=(',',':'),sort_keys=True).encode('utf8')
    if len(raw)>MAX_BYTES:raise Held('context_bound')
    return len(raw).to_bytes(4,'big')+raw

def prescan(text):
    depth=0;nodes=0;index=0
    while index<len(text):
        char=text[index]
        if char in ' \t\r\n,:':index+=1;continue
        if char in '{[':
            depth+=1;nodes+=1;index+=1
            if depth>3:raise Held('wire_bound')
        elif char in '}]':depth-=1;index+=1
        elif char=='"':
            nodes+=1;index+=1;finished=False
            while index<len(text):
                if text[index]=='\\':index+=2;continue
                if text[index]=='"':index+=1;finished=True;break
                index+=1
            if not finished:raise Held('wire_invalid')
        else:
            end=index
            while end<len(text) and text[end] not in ' \t\r\n,]}:':end+=1
            word=text[index:end]
            if not (word in ('true','false') or re.fullmatch(r'-?[0-9]{1,20}',word)):raise Held('wire_invalid')
            nodes+=1;index=end
        if nodes>MAX_NODES or depth<0:raise Held('wire_bound')
    if depth!=0:raise Held('wire_invalid')

def decode_payload(raw,expected_context,now_ns):
    # Independent trusted expected context is snapshotted before wire promotion, never selected by packet.
    expected=validate(expected_context,now_ns)
    return _decode_validated(raw,expected,now_ns)

def _decode_validated(raw,expected,now_ns):
    # Private path receives only this codec's already validated retained snapshot.
    if type(raw) is not bytes or not 1<=len(raw)<=MAX_BYTES:raise Held('wire_bound')
    try:text=raw.decode('utf8','strict')
    except UnicodeError:raise Held('wire_invalid') from None
    prescan(text)
    def pairs(items):
        result={}
        for key,value in items:
            if key in result:raise Held('wire_duplicate')
            result[key]=value
        return result
    try:value=json.loads(text,object_pairs_hook=pairs,parse_float=lambda _:(_ for _ in ()).throw(Held('wire_invalid')),parse_constant=lambda _:(_ for _ in ()).throw(Held('wire_invalid')))
    except Held:raise
    except Exception:raise Held('wire_invalid') from None
    actual=validate(value,now_ns)
    if actual!=expected:raise Held('context_mismatch')
    return freeze(actual)

class ContextFrame:
    def __init__(self,expected_context,now_ns):
        self.expected=freeze(validate(expected_context,now_ns));self.last=now_ns;self.raw=bytearray();self.length=None;self.reason=None;self.done=False
    def fail(self,reason):self.reason=self.reason or reason;self.raw.clear();raise Held(self.reason)
    def cancel(self):self.fail('frame_cancelled')
    def feed(self,chunk,eof,now_ns):
        if self.reason:raise Held(self.reason)
        if self.done:self.fail('frame_already_consumed')
        if type(chunk) is not bytes or type(eof) is not bool or type(now_ns) is not int or not 0<=now_ns<=2**63-1 or now_ns<self.last:self.fail('frame_invalid')
        self.last=now_ns
        if not self.expected['created_ns']<=now_ns<self.expected['exchange_deadline_ns']:self.fail('context_stale')
        if len(chunk)>MAX_BYTES+4-len(self.raw):self.fail('frame_bound')
        offset=0
        if self.length is None:
            offset=min(len(chunk),4-len(self.raw))
            self.raw.extend(chunk[:offset]) # prefix only until its declaration is admitted
        if self.length is None and len(self.raw)==4:
            self.length=int.from_bytes(self.raw[:4],'big')
            if not 1<=self.length<=MAX_BYTES:self.fail('frame_bound')
        if self.length is not None:
            if len(chunk)-offset>self.length+4-len(self.raw):self.fail('frame_extra')
            self.raw.extend(chunk[offset:])
        if not eof:return None
        if self.length is None or len(self.raw)!=self.length+4:self.fail('frame_incomplete')
        try:result=_decode_validated(bytes(self.raw[4:]),self.expected,now_ns)
        except Held as error:
            args=BaseException.args.__get__(error);self.fail(args[0] if len(args)==1 and type(args[0]) is str else 'frame_invalid')
        except Exception:self.fail('frame_invalid')
        self.done=True;self.raw.clear();return result
    def receipt(self):
        return MappingProxyType({'schema':'temperance.private-actor-context-status.v2','status':'held' if self.reason else 'decoded' if self.done else 'pending','reason':self.reason,'role':self.expected['role'],'retained_frame_bytes':len(self.raw),'native_authentication':False,'native_cleanup_authority':False,**{flag:False for flag in FLAGS}})

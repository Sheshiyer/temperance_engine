"""Pure bounded context framing; no FD, process, clock callback or budget effects."""
import json
import re
from types import MappingProxyType
MAX_BYTES=16384
FLAGS=('execution_authorized','capacity_authorization','inference_authorized')
TOP={'schema','creator','create_receipt','reservation_receipt','handle','created_ns','point_deadline_ns','marker',*FLAGS}
RECEIPT={'schema','operation','status','nonce','counter','launch_limit',*FLAGS}
HANDLE={'schema','directory','nonce','expected_counter','launch_limit','invocation_deadline_ns','exchange_deadline_ns',*FLAGS}
class Held(Exception):pass
def closed(v,keys):
    if type(v) is not dict or len(v)!=len(keys) or any(type(k) is not str or len(k)>64 for k in v) or set(v)!=keys:raise Held('context_invalid')
def integer(v,lo,hi):
    if type(v) is not int or not lo<=v<=hi:raise Held('context_invalid')
    return v
def flags(v):
    if any(v[f] is not False for f in FLAGS):raise Held('context_invalid')
def birth(v):
    if type(v) is not str or len(v)>48:raise Held('context_invalid')
    match=re.fullmatch(r'darwin:([0-9]{1,20}):([0-9]{1,20})',v)
    if match is None or int(match[1])<=0 or int(match[2])>=1000000:raise Held('context_invalid')
def escaped_size(v):
    try:return len(v.encode('utf8'))+sum(5 if ord(c)<32 else 1 if c in ('"','\\') else 0 for c in v)+2
    except UnicodeError:raise Held('context_invalid') from None
def validate(v,now_ns):
    closed(v,TOP);flags(v)
    if type(v['schema']) is not str or v['schema']!='temperance.pre-reserved-bootstrap-context.v1' or type(v['marker']) is not str or v['marker']!='inert-metadata-bootstrap-v1':raise Held('context_invalid')
    c=v['creator'];closed(c,{'pid','uid','birth'});integer(c['pid'],2,2**31-1);integer(c['uid'],0,2**32-1);birth(c['birth'])
    h=v['handle'];closed(h,HANDLE);flags(h)
    if type(h['schema']) is not str or h['schema']!='temperance.cli-launch-handle.v1':raise Held('context_invalid')
    nonce=h['nonce'];limit=integer(h['launch_limit'],1,4)
    if type(nonce) is not str or len(nonce)!=32 or re.fullmatch('[0-9a-f]{32}',nonce) is None or type(h['expected_counter']) is not int or h['expected_counter']!=0:raise Held('context_invalid')
    path=h['directory']
    if type(path) is not str or not 1<=len(path)<=4096 or not path.startswith('/') or '\x00' in path or any(p in ('','.','..') for p in path.split('/')[1:]):raise Held('context_invalid')
    try:
        if len(path.encode('utf8'))>4096:raise Held('context_invalid')
    except UnicodeError:raise Held('context_invalid') from None
    for name,count in (('create_receipt',0),('reservation_receipt',1)):
        r=v[name];closed(r,RECEIPT)
        expected={'schema':'temperance.cli-launch-budget.v1','operation':'create' if count==0 else 'reserve','status':'created' if count==0 else 'reserved','nonce':nonce,'counter':count,'launch_limit':limit,**{f:False for f in FLAGS}}
        if any(type(r[k]) is not type(expected[k]) or r[k]!=expected[k] for k in RECEIPT):raise Held('context_invalid')
    created=integer(v['created_ns'],0,2**63-1);point=integer(v['point_deadline_ns'],1,2**63-1);invocation=integer(h['invocation_deadline_ns'],1,2**63-1);exchange=integer(h['exchange_deadline_ns'],1,2**63-1)
    if not 0<invocation-created<=120000000000 or not 0<point-created<=2000000000 or not 0<exchange-created<=2000000000 or not exchange<=point<=invocation:raise Held('context_invalid')
    integer(now_ns,0,2**63-1)
    if not created<=now_ns<exchange:raise Held('context_stale')
    result={k:(dict(value) if type(value) is dict else value) for k,value in v.items()}
    # Fixed two-level scalar traversal; literal UTF8 JSON conservative bound before serialization.
    bound=2
    for record in (result,*[result[k] for k in ('creator','create_receipt','reservation_receipt','handle')]):
        bound+=2
        for k,value in record.items():
            bound+=escaped_size(k)+2
            if type(value) is str:bound+=escaped_size(value)
            elif type(value) is int:bound+=20
            elif type(value) is bool:bound+=5
            elif type(value) is dict:continue
            else:raise Held('context_invalid')
    if bound>MAX_BYTES:raise Held('context_bound')
    return result

def prescan(text):
    depth=0;nodes=0;i=0
    while i<len(text):
        c=text[i]
        if c.isspace() or c in ',:':i+=1;continue
        if c in '{[':
            depth+=1;nodes+=1
            if depth>3:raise Held('wire_bound')
            i+=1
        elif c in '}]':depth-=1;i+=1
        elif c=='"':
            nodes+=1;i+=1;finished=False
            while i<len(text):
                if text[i]=='\\':i+=2;continue
                if text[i]=='"':i+=1;finished=True;break
                i+=1
            if not finished:raise Held('wire_invalid')
        else:
            end=i
            while end<len(text) and text[end] not in ' \t\r\n,]}:':end+=1
            token=text[i:end]
            if not (token in ('true','false') or re.fullmatch(r'-?[0-9]{1,20}',token)):raise Held('wire_invalid')
            nodes+=1;i=end
        if nodes>128 or depth<0:raise Held('wire_bound')
    if depth!=0:raise Held('wire_invalid')
def decode_payload(raw,now_ns):
    if type(raw) is not bytes or not 1<=len(raw)<=MAX_BYTES:raise Held('wire_bound')
    try:text=raw.decode('utf8','strict')
    except UnicodeError:raise Held('wire_invalid') from None
    prescan(text)
    def pairs(items):
        result={}
        for k,v in items:
            if k in result:raise Held('wire_duplicate')
            result[k]=v
        return result
    try:value=json.loads(text,object_pairs_hook=pairs,parse_float=lambda _:(_ for _ in ()).throw(Held('wire_invalid')),parse_constant=lambda _:(_ for _ in ()).throw(Held('wire_invalid')))
    except Held:raise
    except Exception:raise Held('wire_invalid') from None
    result=validate(value,now_ns)
    return MappingProxyType({k:MappingProxyType(value) if type(value) is dict else value for k,value in result.items()})
def encode_frame(context,now_ns):
    value=validate(context,now_ns);raw=json.dumps(value,ensure_ascii=False,separators=(',',':'),sort_keys=True).encode('utf8')
    if len(raw)>MAX_BYTES:raise Held('context_bound')
    return len(raw).to_bytes(4,'big')+raw
class ContextFrame:
    def __init__(self):self.raw=bytearray();self.length=None;self.reason=None;self.done=False;self.last=None
    def fail(self,reason):self.reason=self.reason or reason;self.raw.clear();raise Held(self.reason)
    def feed(self,chunk,eof,now_ns):
        if self.reason:raise Held(self.reason)
        if self.done:self.fail('frame_already_consumed')
        if type(chunk) is not bytes or type(eof) is not bool or type(now_ns) is not int or not 0<=now_ns<=2**63-1 or self.last is not None and now_ns<self.last:self.fail('frame_invalid')
        self.last=now_ns
        if len(chunk)>MAX_BYTES+4-len(self.raw):self.fail('frame_bound')
        self.raw.extend(chunk)
        if self.length is None and len(self.raw)>=4:
            self.length=int.from_bytes(self.raw[:4],'big')
            if not 1<=self.length<=MAX_BYTES:self.fail('frame_bound')
        if self.length is not None and len(self.raw)>self.length+4:self.fail('frame_extra')
        if not eof:return None
        if self.length is None or len(self.raw)!=self.length+4:self.fail('frame_incomplete')
        try:result=decode_payload(bytes(self.raw[4:]),now_ns)
        except Held as error:
            args=BaseException.args.__get__(error);self.fail(args[0] if len(args)==1 and type(args[0]) is str else 'frame_invalid')
        except Exception:self.fail('frame_invalid')
        self.done=True;self.raw.clear();return result

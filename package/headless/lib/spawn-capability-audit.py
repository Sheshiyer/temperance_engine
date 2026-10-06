"""Pure trusted-source/profile audit; no native loading or target invocation."""
import re
from types import MappingProxyType

SYMBOLS=('posix_spawn','posix_spawnattr_init','posix_spawnattr_destroy','posix_spawnattr_setflags','posix_spawnattr_getflags','posix_spawn_file_actions_init','posix_spawn_file_actions_destroy','posix_spawn_file_actions_adddup2','posix_spawn_file_actions_addclose')
SOURCES=('spawn.h','sys/spawn.h','libSystem.tbd')
FLAGS=MappingProxyType({'POSIX_SPAWN_START_SUSPENDED':0x80,'POSIX_SPAWN_SETSID':0x400,'POSIX_SPAWN_CLOEXEC_DEFAULT':0x4000})
MAX_I64=2**63-1
class Held(Exception): pass

def closed(value,keys):
    if type(value) is not dict or len(value)!=len(keys): raise Held('input_invalid')
    if any(type(k) is not str or len(k)>64 for k in value): raise Held('input_invalid')
    if set(value)!=set(keys): raise Held('input_invalid')

def integer(v,lo=0,hi=MAX_I64):
    if type(v) is not int or not lo<=v<=hi: raise Held('input_invalid')
    return v

def label(v):
    if type(v) is not str or not 1<=len(v)<=64 or not re.fullmatch(r'[A-Za-z0-9._-]+',v): raise Held('input_invalid')
    return v

def snapshot_sources(value):
    closed(value,SOURCES); total=0; out={}
    for name in SOURCES:
        raw=value[name]
        if type(raw) is not bytes or len(raw)>65536: raise Held('source_bound')
        total+=len(raw)
        if total>262144: raise Held('source_bound')
        try: out[name]=raw.decode('utf-8','strict')
        except UnicodeError: raise Held('source_encoding') from None
    return MappingProxyType(out)

def declared(s):
    # Conservative literal profile for reviewed Darwin SDK excerpts, not a C parser.
    h=s['spawn.h']; f=s['sys/spawn.h']; t=s['libSystem.tbd']
    for typ in ('posix_spawnattr_t','posix_spawn_file_actions_t'):
        if len(re.findall(r'typedef\s+void\s*\*\s*'+typ+r'\s*;',h))!=1: raise Held('declaration_unavailable')
    for sym in SYMBOLS:
        if not re.search(r'\bint\s+'+sym+r'\s*\(',h): raise Held('declaration_unavailable')
        if not re.search(r'(?<![A-Za-z0-9_])_'+sym+r'(?![A-Za-z0-9_])',t): raise Held('symbol_declaration_unavailable')
    if not re.search(r'posix_spawnattr_setflags\s*\(\s*posix_spawnattr_t\s*\*\s*,\s*short\s*\)',h): raise Held('prototype_unavailable')
    for name,expected in FLAGS.items():
        matches=re.findall(r'^\s*#define\s+'+name+r'\s+(0x[0-9a-fA-F]+)\b',f,re.M)
        if len(matches)!=1 or int(matches[0],16)!=expected: raise Held('flag_unavailable')

class Audit:
    def __init__(self,value,clock):
        closed(value,('sources','sdk_platform','sdk_arch','sdk_version','created_ns','deadline_ns'))
        self.sources=snapshot_sources(value['sources'])
        self.platform=label(value['sdk_platform']); self.arch=label(value['sdk_arch']); self.version=label(value['sdk_version'])
        if self.platform!='darwin' or self.arch not in ('arm64','x86_64'): raise Held('platform_arch_mismatch')
        self.created=integer(value['created_ns']); self.deadline=integer(value['deadline_ns'],1)
        if not 0<self.deadline-self.created<=2_000_000_000: raise Held('deadline_invalid')
        self.clock=clock; self.last=self.created; self.attempted=False; self.reason=None; self.available=False; self.version_relation='unobserved'; self.python_flags=False
        self.check()
    def hold(self,reason):
        self.reason=self.reason or reason
        raise Held(self.reason)
    def check(self):
        if self.reason: raise Held(self.reason)
        try: now=self.clock()
        except Exception: self.hold('clock_unavailable')
        if type(now) is not int or not self.last<=now<=MAX_I64: self.hold('clock_invalid')
        self.last=now
        if now>=self.deadline: self.hold('deadline_expired')
    def run(self,observe):
        self.check()
        if self.attempted: self.hold('audit_already_attempted')
        self.attempted=True
        try:
            declared(self.sources)
            self.check()
            try: report=observe()
            except Exception: self.hold('observation_unavailable')
            self.check()
            closed(report,('platform','arch','version','pointer_bits','short_bits','symbols','python_attr_flags_exposed'))
            platform=label(report['platform']); arch=label(report['arch']); version=label(report['version'])
            if platform!=self.platform or arch!=self.arch: self.hold('platform_arch_mismatch')
            if integer(report['pointer_bits'],1,128)!=64 or integer(report['short_bits'],1,64)!=16: self.hold('scalar_mismatch')
            if type(report['python_attr_flags_exposed']) is not bool: self.hold('input_invalid')
            closed(report['symbols'],SYMBOLS)
            if any(type(report['symbols'][s]) is not bool for s in SYMBOLS): self.hold('input_invalid')
            if not all(report['symbols'][s] for s in SYMBOLS): self.hold('reported_symbol_unavailable')
            self.version_relation='same-label-unproved' if version==self.version else 'different-label-compatibility-unknown'
            self.python_flags=report['python_attr_flags_exposed']; self.check(); self.available=True
        except Held as e:
            args=BaseException.args.__get__(e)
            finite=args[0] if type(args) is tuple and len(args)==1 and type(args[0]) is str and len(args[0])<=64 else 'input_invalid'
            self.hold(finite if finite in ('declaration_unavailable','symbol_declaration_unavailable','prototype_unavailable','flag_unavailable','input_invalid','platform_arch_mismatch','scalar_mismatch','reported_symbol_unavailable','observation_unavailable','clock_unavailable','clock_invalid','deadline_expired') else 'input_invalid')
        except Exception: self.hold('observation_unavailable')
        return self.receipt()
    def receipt(self):
        return MappingProxyType({'schema':'temperance.spawn-capability-audit.v1','status':'held' if self.reason else 'reported-profile' if self.available else 'pending','reason':self.reason,'observation_attempted':self.attempted,'reported_symbols_available':self.available,'sdk_runtime_version_relation':self.version_relation,'python_attr_flags_reported':self.python_flags,'audited_target_functions_called':False,'native_readiness':False,'unknown_fd_closure_proven':False,'execution_authorized':False,'capacity_authorization':False,'inference_authorized':False})

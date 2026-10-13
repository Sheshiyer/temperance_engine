"""Attested zero-child adapter: default mocks; --point separately authorized."""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import time
import types
import unittest

HERE=Path(__file__).absolute()
POLICY=HERE.with_name('test_spawn_opaque_lifecycle.py')
SDK=Path('/Library/Developer/CommandLineTools/SDKs/MacOSX27.0.sdk/usr/include')
PATHS={'self':HERE,'policy':POLICY,'spawn.h':SDK/'spawn.h','sys/spawn.h':SDK/'sys/spawn.h'}
PINS={'policy':'fe2dd55395d4626f3ebcae9ee4ba432a4f76ce276cd327488838bf756d225e15','spawn.h':'2d90f16beec60b2080553613234f004b58f384003feaa5eb809fe5e91b42b884','sys/spawn.h':'988afa3a6d7a1ce18df118d234240c02eff0715b5712784ac28b44e7f66254dc'}
LIBRARY='/usr/lib/libSystem.B.dylib'
NAMES=('posix_spawnattr_init','posix_spawnattr_destroy','posix_spawnattr_getflags','posix_spawnattr_setflags','posix_spawn_file_actions_init','posix_spawn_file_actions_destroy','posix_spawn_file_actions_adddup2','posix_spawn_file_actions_addclose')
MAX_I64=2**63-1
CODES=frozenset(('source_invalid','source_bound','source_drift','source_hash','source_close_uncertain','deadline_expired','clock_invalid','boundary_unavailable','metadata_invalid'))
class Held(Exception):pass
def code(e):
 a=BaseException.args.__get__(e)
 return a[0] if type(a) is tuple and len(a)==1 and type(a[0]) is str and len(a[0])<=64 and a[0] in CODES else 'boundary_unavailable'
def metadata(s):return (s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def identity(s):return (s.st_dev,s.st_ino,stat.S_IFMT(s.st_mode))
class Budget:
 def __init__(self,clock):
  self.clock=clock;self.created=self.now();self.last=self.created
  if self.created>MAX_I64-2_500_000_000:raise Held('clock_invalid')
  self.deadline=self.created+2_000_000_000;self.admission=self.deadline-500_000_000
 def now(self):
  v=self.clock()
  if type(v) is not int or not 0<=v<=MAX_I64:raise Held('clock_invalid')
  return v
 def check(self):
  v=self.now()
  if v<self.last:raise Held('clock_invalid')
  self.last=v
  if v>=self.admission:raise Held('deadline_expired')

def ancestry(paths):
 parents=[]
 for path in paths.values():
  chain=list(path.parents)
  if len(chain)>32:raise Held('source_invalid')
  for parent in reversed(chain):
   if parent not in parents:parents.append(parent)
 if len(parents)>32:raise Held('source_invalid')
 return parents

def snapshots(fs,budget,paths=PATHS,pins=PINS):
 owned=[];out={};total=0;error=None;unknown=False;parent_records=[]
 try:
  # Fixed <=32 distinct parent paths, no symlink ancestry observed.
  for path in ancestry(paths):
   budget.check();record=fs.lstat(str(path));budget.check()
   if not stat.S_ISDIR(record.st_mode):raise Held('source_invalid')
   parent_records.append((path,record))
  # Fixed four owners: all sizes counted before ANY content allocation/read.
  for role in ('self','policy','spawn.h','sys/spawn.h'):
   budget.check();pre=fs.lstat(str(paths[role]));budget.check()
   if not stat.S_ISREG(pre.st_mode):raise Held('source_invalid')
   fd=fs.open(str(paths[role]),os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);owned.append([fd,None,role]);s=fs.fstat(fd);owned[-1][1]=s;budget.check()
   if metadata(pre)!=metadata(s) or identity(pre)!=identity(s):raise Held('source_drift')
   if not stat.S_ISREG(s.st_mode):raise Held('source_invalid')
   if not 0<=s.st_size<=65536:raise Held('source_bound')
   total+=s.st_size
   if total>131072:raise Held('source_bound')
  for fd,s,role in owned:
   budget.check();raw=fs.pread(fd,s.st_size,0)
   if type(raw) is not bytes or len(raw)!=s.st_size or fs.pread(fd,1,s.st_size)!=b'':raise Held('source_drift')
   if metadata(s)!=metadata(fs.fstat(fd)) or metadata(s)!=metadata(fs.stat(str(paths[role]),follow_symlinks=False)):raise Held('source_drift')
   budget.check()
   if role in pins and hashlib.sha256(raw).hexdigest()!=pins[role]:raise Held('source_hash')
   out[role]=raw
  for path,pre in parent_records:
   budget.check();post=fs.lstat(str(path));budget.check()
   if not stat.S_ISDIR(post.st_mode) or metadata(pre)!=metadata(post):raise Held('source_drift')
 except Exception as e:error=code(e) if isinstance(e,Held) else 'source_invalid'
 finally:
  for fd,s,role in owned:
   try:
    if s is None or identity(fs.fstat(fd))!=identity(s):unknown=True
    else:fs.close(fd)
   except Exception:unknown=True
 if unknown:raise Held('source_close_uncertain')
 if error:raise Held(error)
 budget.check();return out

def policy_module(raw):
 if type(raw) is not bytes or len(raw)>65536 or hashlib.sha256(raw).hexdigest()!=PINS['policy']:raise Held('source_hash')
 scope={'__name__':'_attested_opaque_lifecycle','__file__':str(POLICY)}
 exec(compile(raw,str(POLICY),'exec'),scope)
 return types.SimpleNamespace(**scope)

class NativeAPI:
 def __init__(self,ct,library,budget,native=False):
  self.ct=ct;self.library=library;self.calls=0;self.native=native;self.functions={};ptr=ct.POINTER(ct.c_void_p)
  specs=([ptr],[ptr],[ptr,ct.POINTER(ct.c_short)],[ptr,ct.c_short],[ptr],[ptr],[ptr,ct.c_int,ct.c_int],[ptr,ct.c_int])
  for name,args in zip(NAMES,specs):
   budget.check();fn=getattr(library,name);fn.argtypes=args;fn.restype=ct.c_int;self.functions[name]=fn;budget.check()
 def invoke(self,name,*args):
  self.calls+=1
  return self.functions[name](*args)
 def init(self,role,box):return self.invoke('posix_spawnattr_init' if role=='attr' else 'posix_spawn_file_actions_init',self.ct.byref(box))
 def destroy(self,role,box):return self.invoke('posix_spawnattr_destroy' if role=='attr' else 'posix_spawn_file_actions_destroy',self.ct.byref(box))
 def getflags(self,box,output):
  flags=self.ct.c_short()
  rc=self.invoke('posix_spawnattr_getflags',self.ct.byref(box),self.ct.byref(flags))
  output.value=flags.value
  return rc
 def setflags(self,box,flags):return self.invoke('posix_spawnattr_setflags',self.ct.byref(box),self.ct.c_short(flags))
 def adddup2(self,box,a,b):return self.invoke('posix_spawn_file_actions_adddup2',self.ct.byref(box),self.ct.c_int(a),self.ct.c_int(b))
 def addclose(self,box,a):return self.invoke('posix_spawn_file_actions_addclose',self.ct.byref(box),self.ct.c_int(a))

def retained_clock(budget):
 first=[True]
 def clock():
  if first[0]:first[0]=False;return budget.created
  return budget.now()
 return clock

def load_retained(loader,budget,handles):
 budget.check()
 try:lib=loader(LIBRARY)
 except Exception:raise Held('boundary_unavailable') from None
 handles.append(lib);budget.check();return lib

def run_lifecycle(policy,ct,library,budget,native=False,retained_apis=None):
 api=NativeAPI(ct,library,budget,native)
 if retained_apis is not None:retained_apis.append(api)
 lifecycle=policy.Lifecycle(retained_clock(budget),ct.c_void_p)
 receipt=lifecycle.run(api)
 receipt['native_calls_performed']=bool(native and api.calls)
 receipt['native_call_attempt_count']=api.calls if native else 0
 receipt['adapter_call_attempt_count']=api.calls
 return receipt

def finalize(receipt,budget,encoder=json.dumps):
 result=dict(receipt)  # Internal bounded generated DTO, not arbitrary request input.
 def mark(reason):
  result['status']='held';result['reason']=result.get('reason') or reason;result['cleanup_unknown']=True
 def fresh():
  try:
   n=budget.now()
   if n<budget.last:raise Held('clock_invalid')
   budget.last=n
   if n>=budget.deadline:raise Held('deadline_expired')
  except Exception as e:mark(code(e) if isinstance(e,Held) else 'clock_invalid')
 fresh()
 try:
  encoded=encoder(result,sort_keys=True)
  if type(encoded) is not str or len(encoded.encode('utf-8'))>4096:raise Held('boundary_unavailable')
 except Exception:mark('boundary_unavailable');encoded=json.dumps(result,sort_keys=True)
 before=result['status'];fresh()
 if result['status']!=before or result['status']=='held':encoded=json.dumps(result,sort_keys=True)
 return encoded,0 if result['status']=='abi-lifecycle-point-complete' else 1

def actual_point():
 budget=Budget(time.monotonic_ns);handles=[];apis=[];result=None;source_hash=None
 try:
  raw=snapshots(os,budget);source_hash=hashlib.sha256(raw['self']).hexdigest();budget.check();policy=policy_module(raw['policy']);budget.check()
  import ctypes
  budget.check();u=os.uname()
  if sys.platform!='darwin' or u.machine not in ('arm64','x86_64') or ctypes.sizeof(ctypes.c_void_p)!=8 or ctypes.sizeof(ctypes.c_short)!=2:raise Held('metadata_invalid')
  budget.check();lib=load_retained(ctypes.CDLL,budget,handles)
  result=run_lifecycle(policy,ctypes,lib,budget,True,apis)
  if result["status"]=="injected-lifecycle-complete":result["status"]="abi-lifecycle-point-complete"
 except Exception as e:
  reason=code(e) if isinstance(e,Held) else 'boundary_unavailable'
  result={'schema':'temperance.opaque-adapter-point.v1','status':'held','reason':reason,'cleanup_unknown':reason=='source_close_uncertain','native_calls_performed':any(a.calls for a in apis),'native_call_attempt_count':sum(a.calls for a in apis)}
 result.update({'source_sha256':source_hash,'native_readiness':False,'unknown_fd_closure_proven':False,'native_authentication':False,'execution_authorized':False,'capacity_authorization':False,'inference_authorized':False})
 encoded,exitcode=finalize(result,budget);print(encoded);return exitcode

class Void:
 def __init__(self,value=None):self.value=value
class Short:
 def __init__(self,value=0):self.value=value
class Int:
 def __init__(self,value=0):self.value=value
class CT:
 c_void_p=Void;c_short=Short;c_int=Int
 @staticmethod
 def POINTER(t):return ('pointer',t)
 @staticmethod
 def byref(value):return value
class Function:
 def __init__(self,fn):self.fn=fn
 def __call__(self,*args):return self.fn(*args)
class Library:
 def __init__(self):
  self.mask=0;self.log=[];self.first_short_type=None
  for name in NAMES:setattr(self,name,Function(lambda *args,n=name:self.call(n,*args)))
 def call(self,name,*args):
  self.log.append(name)
  if name.endswith('_init'):args[0].value=10 if 'spawnattr' in name else 20
  elif name.endswith('_destroy'):args[0].value=None
  elif name.endswith('_getflags'):
   self.first_short_type=type(args[1]);args[1].value=self.mask
  elif name.endswith('_setflags'):self.mask=args[1].value
  elif name.endswith('_adddup2'):
   if (args[1].value,args[2].value)!=(0,0):raise AssertionError('actions')
  elif name.endswith('_addclose'):
   if args[1].value!=0:raise AssertionError('actions')
  return 0

class FS:
 def __init__(self,raw):
  self.raw=raw;self.opened={};self.closed=[];self.reads=0;self.close_failure=False;self.symlink_parent=None;self.changed_parent=False
 def open(self,path,flags):
  role=next(k for k,v in PATHS.items() if str(v)==path);fd=len(self.opened)+10;self.opened[fd]=role;return fd
 def fstat(self,fd):
  role=self.opened[fd];return types.SimpleNamespace(st_dev=1,st_ino=fd,st_mode=stat.S_IFREG|0o600,st_size=len(self.raw[role]),st_mtime_ns=1,st_ctime_ns=1)
 def lstat(self,path):
  role=next((k for k,v in PATHS.items() if str(v)==path),None)
  if role is not None:
   fd=10+tuple(PATHS).index(role);return types.SimpleNamespace(st_dev=1,st_ino=fd,st_mode=stat.S_IFREG|0o600,st_size=len(self.raw[role]),st_mtime_ns=1,st_ctime_ns=1)
  mode=stat.S_IFLNK if self.symlink_parent==path else stat.S_IFDIR
  return types.SimpleNamespace(st_dev=1,st_ino=100 if self.changed_parent and self.reads else 99,st_mode=mode,st_size=0,st_mtime_ns=1,st_ctime_ns=1)
 def stat(self,path,follow_symlinks):return self.lstat(path)
 def pread(self,fd,n,offset):self.reads+=1;return self.raw[self.opened[fd]][offset:offset+n]
 def close(self,fd):
  self.closed.append(fd)
  if self.close_failure:raise OSError('private')

class Tests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  # Source verification only: bounded local published policy intake, no SDK/native point.
  fd=os.open(POLICY,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
  try:
   size=os.fstat(fd).st_size
   if size>65536:raise AssertionError('policy cap')
   cls.raw=os.pread(fd,size,0)
  finally:os.close(fd)
  cls.policy=policy_module(cls.raw)
 def test_typed_wrappers_actual_policy_mock(self):
  lib=Library();r=run_lifecycle(self.policy,CT,lib,Budget(lambda:1))
  self.assertEqual(r['status'],'injected-lifecycle-complete');self.assertEqual(r['destroy_verified_count'],2);self.assertEqual(lib.first_short_type,Short);self.assertEqual(lib.mask,0x4480);self.assertFalse(r['native_calls_performed']);self.assertEqual(r['adapter_call_attempt_count'],9)
  self.assertEqual(lib.posix_spawnattr_getflags.argtypes,[('pointer',Void),('pointer',Short)])
 def test_late_init_value_rc_retained_before_policy_check(self):
  n=[1];lib=Library();fn=lib.posix_spawnattr_init.fn
  def late(box):rc=fn(box);n[0]=1_600_000_001;return rc
  lib.posix_spawnattr_init.fn=late;r=run_lifecycle(self.policy,CT,lib,Budget(lambda:n[0]))
  self.assertEqual(r['first_candidate_retained_count'],1);self.assertEqual(r['destroy_verified_count'],1);self.assertEqual(r['reason'],'deadline_expired')
 def test_duplicate_pointer_one_destroy(self):
  lib=Library();lib.posix_spawn_file_actions_init.fn=lambda box:setattr(box,'value',10) or 0
  r=run_lifecycle(self.policy,CT,lib,Budget(lambda:1));self.assertEqual(r['destroy_attempt_count'],1);self.assertTrue(r['cleanup_unknown'])
 def test_unknown_init_not_destroyed(self):
  lib=Library();lib.posix_spawnattr_init.fn=lambda box:setattr(box,'value',10) or 12
  r=run_lifecycle(self.policy,CT,lib,Budget(lambda:1));self.assertEqual(r['first_candidate_retained_count'],1);self.assertEqual(r['destroy_attempt_count'],0)
 def test_destroy_failure_peer_still_attempted(self):
  lib=Library();lib.posix_spawnattr_destroy.fn=lambda box:22
  r=run_lifecycle(self.policy,CT,lib,Budget(lambda:1));self.assertEqual(r['destroy_attempt_count'],2);self.assertEqual(r['destroy_verified_count'],1)
 def test_original_anchor_before_setup_not_renewed(self):
  n=[1];b=Budget(lambda:n[0]);n[0]=1_600_000_001
  with self.assertRaises(Held):run_lifecycle(self.policy,CT,Library(),b)
  self.assertEqual(b.deadline,2_000_000_001)
 def test_library_late_retained(self):
  n=[1];b=Budget(lambda:n[0]);lib=object();handles=[]
  def late(path):n[0]=1_600_000_001;return lib
  with self.assertRaises(Held):load_retained(late,b,handles)
  self.assertIs(handles[0],lib)
 def test_snapshot_aggregate_before_reads(self):
  raw={n:b'x'*40000 for n in PATHS};fs=FS(raw)
  with self.assertRaises(Held):snapshots(fs,Budget(lambda:1),pins={})
  self.assertEqual(fs.reads,0);self.assertEqual(len(fs.closed),4)
 def test_snapshot_hash_and_close_uncertainty(self):
  raw={n:b'x' for n in PATHS};fs=FS(raw)
  with self.assertRaises(Held):snapshots(fs,Budget(lambda:1))
  self.assertEqual(len(fs.closed),4)
  fs=FS(raw);fs.close_failure=True
  with self.assertRaises(Held) as ctx:snapshots(fs,Budget(lambda:1),pins={})
  self.assertEqual(code(ctx.exception),'source_close_uncertain');self.assertEqual(len(fs.closed),4)
 def test_flags_nonzero_and_missing_prototype(self):
  lib=Library();lib.posix_spawnattr_getflags.fn=lambda *args:22
  r=run_lifecycle(self.policy,CT,lib,Budget(lambda:1));self.assertFalse(r['reported_mask_roundtrip']);self.assertEqual(r['destroy_verified_count'],2)
  lib=Library();del lib.posix_spawnattr_getflags
  with self.assertRaises(AttributeError):NativeAPI(CT,lib,Budget(lambda:1))
  self.assertEqual(lib.log,[])
 def test_symlinked_sdk_parent_and_root_no_reads(self):
  for path in (str(SDK.parent),'/'):
   fs=FS({n:b'x' for n in PATHS});fs.symlink_parent=path
   with self.assertRaises(Held):snapshots(fs,Budget(lambda:1),pins={})
   self.assertEqual(fs.reads,0);self.assertEqual(fs.opened,{})
 def test_parent_changed_and_preopen_identity(self):
  fs=FS({n:b'x' for n in PATHS});fs.changed_parent=True
  with self.assertRaises(Held):snapshots(fs,Budget(lambda:1),pins={})
  self.assertEqual(len(fs.closed),4)
  fs=FS({n:b'x' for n in PATHS});orig=fs.lstat
  def changed(path):
   v=orig(path)
   if path==str(HERE):v.st_ino=12345
   return v
  fs.lstat=changed
  with self.assertRaises(Held):snapshots(fs,Budget(lambda:1),pins={})
  self.assertEqual(fs.reads,0);self.assertEqual(len(fs.closed),1)
 def test_late_finalization_and_clockerror_finite(self):
  n=[1];b=Budget(lambda:n[0]);r={'status':'abi-lifecycle-point-complete','reason':None,'cleanup_unknown':False}
  def late(value,**kwargs):n[0]=2_000_000_001;return json.dumps(value,**kwargs)
  encoded,rc=finalize(r,b,late);self.assertEqual(rc,1);out=json.loads(encoded);self.assertEqual(out['reason'],'deadline_expired');self.assertTrue(out['cleanup_unknown'])
  class Trap(Exception):
   def __str__(self):raise AssertionError('str')
  def bad():raise Trap('private')
  b=Budget(lambda:1);b.clock=bad;encoded,rc=finalize(r,b);self.assertEqual(json.loads(encoded)['reason'],'clock_invalid');self.assertEqual(rc,1)
 def test_policy_attestation_no_second_read(self):
  with self.assertRaises(Held):policy_module(b'bad')
  self.assertEqual(self.policy.MASK,0x4480)
if __name__=='__main__':
 if sys.argv[1:]==['--point']:raise SystemExit(actual_point())
 unittest.main()

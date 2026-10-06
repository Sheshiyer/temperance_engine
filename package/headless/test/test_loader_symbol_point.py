"""Default pure mocks; real metadata-only loader point requires explicit --point."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import time
import unittest

SYMBOLS=('posix_spawn','posix_spawnattr_init','posix_spawnattr_destroy','posix_spawnattr_setflags','posix_spawnattr_getflags','posix_spawn_file_actions_init','posix_spawn_file_actions_destroy','posix_spawn_file_actions_adddup2','posix_spawn_file_actions_addclose')
LIBRARY='/usr/lib/libSystem.B.dylib'
SELF=Path(__file__).absolute()
MAX_I64=2**63-1
REASONS=frozenset(('source_invalid','source_bound','source_drift','source_close_uncertain','clock_invalid','deadline_expired','boundary_unavailable','metadata_invalid','symbol_unavailable'))
class Held(Exception):pass

def reason(error):
 args=BaseException.args.__get__(error)
 return args[0] if type(args) is tuple and len(args)==1 and type(args[0]) is str and len(args[0])<=64 and args[0] in REASONS else 'boundary_unavailable'
def key(s):return (s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def snapshot(fs):
 fd=None; original=None; result=None; failure=None; unknown=False
 try:
  fd=fs.open(str(SELF),os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
  original=fs.fstat(fd)
  if not stat.S_ISREG(original.st_mode):raise Held('source_invalid')
  if not 0<=original.st_size<=65536:raise Held('source_bound')
  raw=fs.pread(fd,original.st_size,0)
  if type(raw) is not bytes or len(raw)!=original.st_size or fs.pread(fd,1,original.st_size)!=b'':raise Held('source_drift')
  if key(original)!=key(fs.fstat(fd)) or key(original)!=key(fs.stat(str(SELF),follow_symlinks=False)):raise Held('source_drift')
  result=hashlib.sha256(raw).hexdigest()
 except Exception as e:failure=reason(e) if isinstance(e,Held) else 'source_invalid'
 finally:
  if fd is not None:
   try:
    if original is None or key(fs.fstat(fd))!=key(original):unknown=True
    else:fs.close(fd)
   except Exception:unknown=True
 if unknown:raise Held('source_close_uncertain')
 if failure:raise Held(failure)
 return {'sha256':result,'cleanup_unknown':False}

class Point:
 def __init__(self,clock):
  self.clock=clock;self.created=self.now();self.deadline=self.created+2_000_000_000
  if self.deadline>MAX_I64:raise Held('clock_invalid')
  self.last=self.created;self.reason=None;self.checked=0;self.available=0;self.source_hash=None;self.cleanup_unknown=False;self.labels=None;self.widths=None;self.loader_attempted=False;self.handles=[]
 def now(self):
  n=self.clock()
  if type(n) is not int or not 0<=n<=MAX_I64:raise Held('clock_invalid')
  return n
 def check(self):
  n=self.now()
  if n<self.last:raise Held('clock_invalid')
  self.last=n
  if n>=self.deadline:raise Held('deadline_expired')
 def call(self,cb,*args):
  self.check()
  try:out=cb(*args)
  except Held:raise
  except Exception:raise Held('boundary_unavailable') from None
  self.check();return out
 def run(self,attest,load,metadata,widths,lookup):
  if self.reason or self.loader_attempted:raise Held('boundary_unavailable')
  try:
   source=self.call(attest)
   if type(source) is not dict or len(source)!=2 or any(type(k) is not str or len(k)>64 for k in source) or set(source)!= {'sha256','cleanup_unknown'} or type(source['sha256']) is not str or not re.fullmatch('[0-9a-f]{64}',source['sha256']) or source['cleanup_unknown'] is not False:raise Held('source_invalid')
   self.source_hash=source['sha256']
   self.loader_attempted=True
   self.check()
   try:library=load(LIBRARY)
   except Exception:raise Held('boundary_unavailable') from None
   self.handles.append(library)  # Retain returned handle before late-return validation.
   self.check()
   meta=self.call(metadata)
   if type(meta) is not tuple or len(meta)!=3 or any(type(x) is not str or not re.fullmatch('[A-Za-z0-9._-]{1,64}',x) for x in meta):raise Held('metadata_invalid')
   self.labels=meta
   if meta[0]!='darwin' or meta[1] not in ('arm64','x86_64'):raise Held('metadata_invalid')
   sizes=self.call(widths)
   if type(sizes) is not tuple or len(sizes)!=2 or any(type(x) is not int or not 1<=x<=128 for x in sizes):raise Held('metadata_invalid')
   self.widths=sizes
   if sizes!=(64,16):raise Held('metadata_invalid')
   for name in SYMBOLS:
    self.checked+=1
    symbol=self.call(lookup,library,name)
    if not callable(symbol):raise Held('symbol_unavailable')
    self.handles.append(symbol);self.available+=1
   self.check()
  except Exception as e:
   self.reason=reason(e) if isinstance(e,Held) else 'boundary_unavailable'
   if self.reason=='source_close_uncertain':self.cleanup_unknown=True
  receipt=self.receipt()
  try:self.check()
  except Exception as e:
   self.reason=self.reason or (reason(e) if isinstance(e,Held) else 'boundary_unavailable');receipt=self.receipt()
  return receipt
 def receipt(self):
  return {'schema':'temperance.loader-symbol-point.v1','status':'held' if self.reason else 'metadata-available','reason':self.reason,'source_attested':self.source_hash is not None,'source_sha256':self.source_hash,'loader_attempted':self.loader_attempted,'symbols_checked':self.checked,'symbols_available':self.available,'pointer_bits':None if self.widths is None else self.widths[0],'short_bits':None if self.widths is None else self.widths[1],'platform':None if self.labels is None else self.labels[0],'architecture':None if self.labels is None else self.labels[1],'kernel_release_label':None if self.labels is None else self.labels[2],'cleanup_unknown':self.cleanup_unknown,'audited_target_functions_called':False,'native_readiness':False,'unknown_fd_closure_proven':False,'native_authentication':False,'execution_authorized':False,'capacity_authorization':False,'inference_authorized':False}

def actual_point():
 # Original deadline is captured before snapshot and ctypes import/load.
 p=Point(time.monotonic_ns);ct=[]
 def load(path):
  import ctypes
  ct.append(ctypes)
  return ctypes.CDLL(path)
 def metadata():
  u=os.uname()
  return (sys.platform,u.machine,u.release)
 def widths():return (ct[0].sizeof(ct[0].c_void_p)*8,ct[0].sizeof(ct[0].c_short)*8)
 result=p.run(lambda:snapshot(os),load,metadata,widths,lambda lib,name:getattr(lib,name,None))
 print(json.dumps(result,sort_keys=True));return 0 if result['status']=='metadata-available' else 1

class FakeFS:
 def __init__(self):
  from types import SimpleNamespace
  self.info=SimpleNamespace(st_dev=1,st_ino=2,st_size=3,st_mtime_ns=4,st_ctime_ns=5,st_mode=stat.S_IFREG|0o600);self.closes=0;self.fail_close=False;self.change=False;self.short=False
 def open(self,path,flags):return 10
 def fstat(self,fd):return self.info
 def pread(self,fd,n,offset):return b'' if offset else b'ab' if self.short else b'abc'
 def stat(self,path,follow_symlinks):
  if self.change:
   from types import SimpleNamespace
   return SimpleNamespace(**{**vars(self.info),'st_ino':99})
  return self.info
 def close(self,fd):
  self.closes+=1
  if self.fail_close:raise OSError('private')

class Tests(unittest.TestCase):
 def run_mock(self,**overrides):
  calls=[];p=Point(overrides.pop('clock',lambda:1))
  args=dict(attest=lambda:{'sha256':'a'*64,'cleanup_unknown':False},load=lambda path:object(),metadata=lambda:('darwin','arm64','25.1.0'),widths=lambda:(64,16),lookup=lambda lib,name:calls.append(name) or (lambda:None))
  args.update(overrides);return p,p.run(**args),calls
 def test_all_available_no_targets_called(self):
  class Target:
   def __call__(self,*args):raise AssertionError('target called')
  p,r,c=self.run_mock(lookup=lambda lib,name:Target())
  self.assertEqual(r['symbols_available'],9);self.assertEqual(r['status'],'metadata-available')
  for key in ('audited_target_functions_called','native_readiness','unknown_fd_closure_proven','native_authentication','execution_authorized','capacity_authorization','inference_authorized'):self.assertIs(r[key],False)
 def test_missing_first_last(self):
  for missing in (SYMBOLS[0],SYMBOLS[-1]):
   p,r,c=self.run_mock(lookup=lambda lib,name:None if name==missing else (lambda:None))
   self.assertEqual(r['reason'],'symbol_unavailable');self.assertLess(r['symbols_available'],9)
 def test_late_load_lookup(self):
  for late in ('load','lookup'):
   n=[1]
   def cb(*args):n[0]=2_000_000_001;return object()
   p,r,c=self.run_mock(clock=lambda:n[0],**{late:cb})
   self.assertEqual(r['reason'],'deadline_expired')
 def test_expired_before_loader(self):
  n=iter((1,2_000_000_001,2_000_000_001));calls=[]
  p,r,c=self.run_mock(clock=lambda:next(n),load=lambda path:calls.append(1))
  self.assertEqual(calls,[]);self.assertFalse(r['loader_attempted'])
 def test_exception_str_trap(self):
  class Trap(Exception):
   def __str__(self):raise AssertionError('str called')
  def fail(*args):raise Trap('private')
  p,r,c=self.run_mock(load=fail);self.assertEqual(r['reason'],'boundary_unavailable')
 def test_metadata_width_validation(self):
  for kwargs in ({'metadata':lambda:('darwin','arm64','private space')},{'metadata':lambda:('linux','arm64','25.0')},{'metadata':lambda:('darwin','mips','25.0')},{'widths':lambda:(True,16)},{'widths':lambda:(32,16)},{'widths':lambda:(64,8)}):
   p,r,c=self.run_mock(**kwargs);self.assertEqual(r['reason'],'metadata_invalid')
 def test_snapshot_continuity_short_bound_type(self):
  f=FakeFS();self.assertEqual(len(snapshot(f)['sha256']),64);self.assertEqual(f.closes,1)
  for kind in ('change','short','bound','type'):
   f=FakeFS()
   if kind=='change':f.change=True
   elif kind=='short':f.short=True
   elif kind=='bound':f.info.st_size=65537
   else:f.info.st_mode=stat.S_IFDIR
   with self.assertRaises(Held):snapshot(f)
   self.assertEqual(f.closes,1)
 def test_snapshot_close_unknown_oneattempt(self):
  f=FakeFS();f.fail_close=True
  p,r,c=self.run_mock(attest=lambda:snapshot(f))
  self.assertEqual(r['reason'],'source_close_uncertain');self.assertTrue(r['cleanup_unknown']);self.assertEqual(f.closes,1);self.assertFalse(r['loader_attempted'])
 def test_final_deadline_and_original_two_seconds(self):
  n=[1];p=Point(lambda:n[0]);calls=[0]
  original=p.check
  def check():
   calls[0]+=1
   if calls[0]==27:n[0]=2_000_000_001
   original()
  p.check=check
  r=p.run(lambda:{'sha256':'a'*64,'cleanup_unknown':False},lambda path:object(),lambda:('darwin','arm64','25.0'),lambda:(64,16),lambda l,n:(lambda:None))
  self.assertEqual(r['reason'],'deadline_expired');self.assertEqual(p.deadline,2_000_000_001)
 def test_malformed_symbol_presence(self):
  for bad in (None,False,0,'symbol'):
   p,r,c=self.run_mock(lookup=lambda lib,name:bad)
   self.assertEqual(r['reason'],'symbol_unavailable');self.assertEqual(r['symbols_available'],0)
 def test_late_library_retained_before_hold(self):
  n=[1];handle=object()
  def late(path):n[0]=2_000_000_001;return handle
  p,r,c=self.run_mock(clock=lambda:n[0],load=late)
  self.assertEqual(r['reason'],'deadline_expired');self.assertIs(p.handles[0],handle)
 def test_fixed_names_and_no_repeated_attempt(self):
  p,r,c=self.run_mock();self.assertEqual(tuple(c),SYMBOLS)
  with self.assertRaises(Held):p.run(None,None,None,None,None)
if __name__=='__main__':
 if sys.argv[1:]==['--point']:raise SystemExit(actual_point())
 unittest.main()

"""Pure injected opaque lifecycle; no native branch, ctypes, FD or spawn."""
import hashlib
import unittest

MASK=0x4480
MAX_I64=2**63-1
HEADER_HASHES={'spawn.h':'2d90f16beec60b2080553613234f004b58f384003feaa5eb809fe5e91b42b884','sys/spawn.h':'988afa3a6d7a1ce18df118d234240c02eff0715b5712784ac28b44e7f66254dc'}
REASONS=frozenset(('clock_invalid','deadline_expired','boundary_unavailable','init_failed','handle_invalid','handle_changed','operation_failed','flag_mismatch','already_attempted','source_invalid','source_bound','duplicate_handle'))
class Held(Exception):pass
class Box:
 def __init__(self):self.value=None

def finite(error):
 args=BaseException.args.__get__(error)
 return args[0] if type(args) is tuple and len(args)==1 and type(args[0]) is str and len(args[0])<=64 and args[0] in REASONS else 'boundary_unavailable'
def sources(raw):
 names=('self','spawn.h','sys/spawn.h')
 if type(raw) is not dict or len(raw)!=3 or any(type(k) is not str or len(k)>64 for k in raw) or set(raw)!=set(names):raise Held('source_invalid')
 total=0
 for n in names:
  v=raw[n]
  if type(v) is not bytes or len(v)>65536:raise Held('source_bound')
  total+=len(v)
  if total>131072:raise Held('source_bound')
 return {n:hashlib.sha256(raw[n]).hexdigest() for n in names}

class Lifecycle:
 def __init__(self,clock,box_factory=Box):
  self.clock=clock;self.created=self.now();self.last=self.created
  if self.created>MAX_I64-2_500_000_000:raise Held('clock_invalid')
  self.deadline=self.created+2_000_000_000;self.admission=self.deadline-500_000_000;self.cleanup_deadline=self.deadline+500_000_000
  self.reason=None;self.attempted=False;self.emergency_used=False;self.boxes={};self.candidates={};self.proven={};self.destroy_attempted={};self.destroy_verified={};self.cleanup_unknown=False;self.operations=0;self.mask_roundtrip=False;self.box_factory=box_factory
 def now(self):
  n=self.clock()
  if type(n) is not int or not 0<=n<=MAX_I64:raise Held('clock_invalid')
  return n
 def check(self,cleanup=False):
  n=self.now()
  if n<self.last:raise Held('clock_invalid')
  self.last=n
  if cleanup and n>=self.deadline:
   self.emergency_used=True;self.cleanup_unknown=True;self.reason=self.reason or 'deadline_expired'
  if n>=(self.cleanup_deadline if cleanup else self.admission):raise Held('deadline_expired')
 def mark(self,error):self.reason=self.reason or finite(error)
 def init(self,role,fn):
  self.check();box=self.box_factory();self.boxes[role]=box;self.proven[role]=False;rc=None;error=None
  # Box and init intent exist before callback; first output survives all errors.
  try:rc=fn(box)
  except Exception:error=Held('boundary_unavailable')
  value=box.value  # Trusted injected/native outputbox, not hostile property intake.
  if type(value) is int and 1<=value<=2**64-1:self.candidates[role]=value
  elif value is not None:error=error or Held('handle_invalid')
  if role in self.candidates and any(other!=role and candidate==self.candidates[role] for other,candidate in self.candidates.items()):
   error=error or Held('duplicate_handle')
  if type(rc) is int and rc==0 and role in self.candidates and error is None:self.proven[role]=True
  else:error=error or Held('init_failed')
  if error:
   self.cleanup_unknown=True
   raise error
  self.check()
 def op(self,role,fn,*args):
  self.check()
  current=self.boxes[role].value
  if not self.proven.get(role) or type(current) is not int or current!=self.candidates[role]:raise Held('handle_changed')
  self.operations+=1
  try:rc=fn(self.boxes[role],*args)
  except Exception:raise Held('boundary_unavailable') from None
  self.check()
  if type(rc) is not int or rc!=0:raise Held('operation_failed')
 def cleanup(self,api):
  for role in ('attr','actions'):
   if role not in self.boxes:continue
   if not self.proven[role]:
    if role in self.candidates:self.cleanup_unknown=True
    continue
   if self.destroy_attempted.get(role):continue
   try:
    self.check(cleanup=True)
    current=self.boxes[role].value
    if type(current) is not int or current!=self.candidates[role]:raise Held('handle_changed')
    self.destroy_attempted[role]=True
    rc=api.destroy(role,self.boxes[role])
    self.check(cleanup=True)
    if type(rc) is not int or rc!=0:raise Held('operation_failed')
    self.destroy_verified[role]=True
   except Exception:
    self.cleanup_unknown=True;self.reason=self.reason or 'boundary_unavailable'
 def run(self,api):
  if self.attempted or self.reason:raise Held('already_attempted')
  self.attempted=True
  try:
   self.init('attr',lambda box:api.init('attr',box))
   self.init('actions',lambda box:api.init('actions',box))
   initial=Box();self.op('attr',api.getflags,initial)
   if type(initial.value) is not int or not -32768<=initial.value<=32767:raise Held('flag_mismatch')
   self.op('attr',api.setflags,MASK)
   final=Box();self.op('attr',api.getflags,final)
   if type(final.value) is not int or final.value!=MASK:raise Held('flag_mismatch')
   self.mask_roundtrip=True
   self.op('actions',api.adddup2,0,0)
   self.op('actions',api.addclose,0)
  except Exception as e:self.mark(e if isinstance(e,Held) else Held('boundary_unavailable'))
  finally:self.cleanup(api)
  receipt=self.receipt()
  try:self.check(cleanup=True)
  except Exception:
   self.cleanup_unknown=True;self.reason=self.reason or 'deadline_expired';receipt=self.receipt()
  return self.receipt()
 def receipt(self):
  return {'schema':'temperance.opaque-spawn-lifecycle.v1','status':'held' if self.reason else 'injected-lifecycle-complete','reason':self.reason,'init_attempt_count':len(self.boxes),'first_candidate_retained_count':len(self.candidates),'initialized_reported_count':sum(self.proven.values()),'destroy_attempt_count':sum(self.destroy_attempted.values()),'destroy_verified_count':sum(self.destroy_verified.values()),'operation_attempt_count':self.operations,'reported_mask_roundtrip':self.mask_roundtrip,'cleanup_unknown':self.cleanup_unknown,'emergency_cleanup_used':self.emergency_used,'native_calls_performed':False,'native_readiness':False,'unknown_fd_closure_proven':False,'native_authentication':False,'execution_authorized':False,'capacity_authorization':False,'inference_authorized':False}

class API:
 def __init__(self):self.log=[];self.mask=0
 def init(self,role,box):self.log.append(('init',role));box.value=10 if role=='attr' else 20;return 0
 def destroy(self,role,box):self.log.append(('destroy',role));box.value=None;return 0
 def getflags(self,box,output):self.log.append(('get',));output.value=self.mask;return 0
 def setflags(self,box,mask):self.log.append(('set',mask));self.mask=mask;return 0
 def adddup2(self,box,a,b):self.log.append(('dup2',a,b));return 0
 def addclose(self,box,a):self.log.append(('close',a));return 0

class Tests(unittest.TestCase):
 def test_complete_fixedcalls_allfalse(self):
  a=API();l=Lifecycle(lambda:1);r=l.run(a)
  self.assertEqual(r['status'],'injected-lifecycle-complete');self.assertEqual(r['destroy_verified_count'],2)
  self.assertIn(('set',0x4480),a.log);self.assertIn(('dup2',0,0),a.log);self.assertIn(('close',0),a.log)
  for k in ('native_calls_performed','native_readiness','unknown_fd_closure_proven','native_authentication','execution_authorized','capacity_authorization','inference_authorized'):self.assertFalse(r[k])
 def test_late_init_handle_retained_and_destroyed(self):
  n=[1];a=API();orig=a.init
  def late(role,box):rc=orig(role,box);n[0]=1_600_000_001;return rc
  a.init=late;l=Lifecycle(lambda:n[0]);r=l.run(a)
  self.assertEqual(r['reason'],'deadline_expired');self.assertEqual(l.candidates['attr'],10);self.assertEqual(r['destroy_verified_count'],1);self.assertEqual(r['init_attempt_count'],1)
 def test_error_and_nonzero_candidate_not_destroyed(self):
  for throwing in (True,False):
   a=API()
   def fail(role,box):
    box.value=10
    if throwing:raise RuntimeError('private')
    return 12
   a.init=fail;l=Lifecycle(lambda:1);r=l.run(a)
   self.assertEqual(l.candidates['attr'],10);self.assertEqual(r['destroy_attempt_count'],0);self.assertTrue(r['cleanup_unknown'])
 def test_null_or_malformed_success(self):
  for v in (None,True,-1,2**64):
   a=API();a.init=lambda role,box:setattr(box,'value',v) or 0;r=Lifecycle(lambda:1).run(a)
   self.assertEqual(r['status'],'held');self.assertEqual(r['destroy_attempt_count'],0);self.assertTrue(r['cleanup_unknown'])
 def test_duplicate_cross_role_pointer_retained_not_destroyed_twice(self):
  a=API();a.init=lambda role,box:setattr(box,'value',10) or 0
  l=Lifecycle(lambda:1);r=l.run(a)
  self.assertEqual(r['reason'],'duplicate_handle');self.assertEqual(l.candidates,{'attr':10,'actions':10})
  self.assertEqual(r['initialized_reported_count'],1);self.assertEqual(r['destroy_attempt_count'],1);self.assertTrue(r['cleanup_unknown'])
  self.assertEqual([row for row in a.log if row[0]=='destroy'],[('destroy','attr')])
 def test_slot_changed_not_destroyed(self):
  a=API();orig=a.setflags
  def changed(box,mask):rc=orig(box,mask);box.value=999;return rc
  a.setflags=changed;r=Lifecycle(lambda:1).run(a)
  self.assertEqual(r['reason'],'handle_changed');self.assertEqual(r['destroy_attempt_count'],1);self.assertTrue(r['cleanup_unknown'])
 def test_destroy_failure_does_not_skip_peer_once(self):
  a=API();orig=a.destroy
  def fail(role,box):
   if role=='attr':a.log.append(('destroy',role));raise RuntimeError('private')
   return orig(role,box)
  a.destroy=fail;l=Lifecycle(lambda:1);r=l.run(a)
  self.assertEqual(r['destroy_attempt_count'],2);self.assertEqual(r['destroy_verified_count'],1);self.assertTrue(r['cleanup_unknown'])
  l.cleanup(a);self.assertEqual(a.log.count(('destroy','attr')),1)
 def test_fixed_emergency_anchor_not_per_handle(self):
  n=[1];a=API();orig=a.addclose
  def late(box,fd):rc=orig(box,fd);n[0]=2_100_000_001;return rc
  a.addclose=late;destroy=a.destroy
  def cleanup(role,box):rc=destroy(role,box);n[0]=2_600_000_001;return rc
  a.destroy=cleanup;l=Lifecycle(lambda:n[0]);r=l.run(a)
  self.assertEqual(l.cleanup_deadline,2_500_000_001);self.assertEqual(r['destroy_attempt_count'],1);self.assertTrue(r['cleanup_unknown']);self.assertEqual(r['reason'],'deadline_expired')
 def test_cleanup_after_original_deadline_always_held(self):
  n=[1];a=API();orig=a.destroy
  def late(role,box):rc=orig(role,box);n[0]=2_100_000_001;return rc
  a.destroy=late;r=Lifecycle(lambda:n[0]).run(a)
  self.assertEqual(r['status'],'held');self.assertTrue(r['emergency_cleanup_used']);self.assertTrue(r['cleanup_unknown'])
 def test_reserve_and_original_expiry_zero_init(self):
  n=iter((1,1_500_000_001,1_500_000_001));a=API();r=Lifecycle(lambda:next(n)).run(a)
  self.assertEqual(r['init_attempt_count'],0);self.assertEqual(a.log,[])
 def test_getflags_mismatch_and_action_error_cleanup(self):
  for which in ('get','add'):
   a=API()
   if which=='get':a.getflags=lambda box,out:setattr(out,'value',99) or 0
   else:a.adddup2=lambda *args:22
   r=Lifecycle(lambda:1).run(a);self.assertEqual(r['status'],'held');self.assertEqual(r['destroy_verified_count'],2)
 def test_source_preallocation_perfile_aggregate_and_closed(self):
  self.assertEqual(len(sources({'self':b'a','spawn.h':b'b','sys/spawn.h':b'c'})),3)
  for raw in ({'self':b'x'*65537,'spawn.h':b'','sys/spawn.h':b''},{n:b'x'*65536 for n in ('self','spawn.h','sys/spawn.h')},{'self':b'','spawn.h':b'','other':b''}):
   with self.assertRaises(Held):sources(raw)
 def test_no_retry_and_error_str_not_called(self):
  class Trap(Exception):
   def __str__(self):raise AssertionError('str')
  a=API();a.addclose=lambda *args:(_ for _ in ()).throw(Trap('private'));l=Lifecycle(lambda:1);r=l.run(a)
  self.assertEqual(r['reason'],'boundary_unavailable')
  with self.assertRaises(Held):l.run(a)
 def test_backward_clock_holds(self):
  n=iter((2,1,2));a=API();r=Lifecycle(lambda:next(n)).run(a);self.assertEqual(r['reason'],'clock_invalid')
if __name__=='__main__':unittest.main()

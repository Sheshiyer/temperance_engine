import importlib.util
from pathlib import Path
import unittest
p=Path(__file__).resolve().parents[1]/'lib/spawn-capability-audit.py'
s=importlib.util.spec_from_file_location('audit_test',p); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
def sources():
 h='typedef void *posix_spawnattr_t;\ntypedef void *posix_spawn_file_actions_t;\n'
 h+='\n'.join('int '+n+'();' for n in m.SYMBOLS if n!='posix_spawnattr_setflags')
 h+='\nint posix_spawnattr_setflags(posix_spawnattr_t *, short);'
 return {'spawn.h':h.encode(),'sys/spawn.h':('\n'.join('#define '+n+' '+hex(v) for n,v in m.FLAGS.items())).encode(),'libSystem.tbd':(', '.join('_'+n for n in m.SYMBOLS)).encode()}
def value():return dict(sources=sources(),sdk_platform='darwin',sdk_arch='arm64',sdk_version='26.0',created_ns=0,deadline_ns=2_000_000_000)
def report():return dict(platform='darwin',arch='arm64',version='26.1',pointer_bits=64,short_bits=16,symbols={n:True for n in m.SYMBOLS},python_attr_flags_exposed=False)
class Tests(unittest.TestCase):
 def test_report_only_all_false(self):
  r=m.Audit(value(),lambda:1).run(report)
  self.assertEqual(r['status'],'reported-profile');self.assertEqual(r['sdk_runtime_version_relation'],'different-label-compatibility-unknown')
  for k in ('native_readiness','unknown_fd_closure_proven','audited_target_functions_called','execution_authorized','capacity_authorization','inference_authorized'):self.assertIs(r[k],False)
 def test_source_bound_encoding_closed(self):
  for kind in ('oversize','utf8','unknown'):
   v=value()
   if kind=='oversize':v['sources']['spawn.h']=b'x'*65537
   elif kind=='utf8':v['sources']['spawn.h']=b'\xff'
   else:v['sources']['other']=b''
   with self.assertRaises(m.Held):m.Audit(v,lambda:1)
 def test_missing_and_wrong_declarations_no_callback(self):
  for name in m.SOURCES:
   v=value();v['sources'][name]=b'';calls=[];a=m.Audit(v,lambda:1)
   with self.assertRaises(m.Held):a.run(lambda:calls.append(1))
   self.assertEqual(calls,[]);self.assertEqual(a.receipt()['status'],'held')
 def test_opaque_and_flag_prototype(self):
  for old,new in ((b'void *posix_spawnattr_t',b'int posix_spawnattr_t'),(b', short)',b', int)')):
   v=value();v['sources']['spawn.h']=v['sources']['spawn.h'].replace(old,new)
   with self.assertRaises(m.Held):m.Audit(v,lambda:1).run(report)
  v=value();v['sources']['sys/spawn.h']=v['sources']['sys/spawn.h'].replace(b'0x4000',b'0x2000')
  with self.assertRaises(m.Held):m.Audit(v,lambda:1).run(report)
 def test_platform_arch_scalar(self):
  for k,v in (('platform','linux'),('arch','x86_64'),('pointer_bits',32),('short_bits',32)):
   r=report();r[k]=v;a=m.Audit(value(),lambda:1)
   with self.assertRaises(m.Held):a.run(lambda:r)
   self.assertFalse(a.receipt()['reported_symbols_available'])
 def test_symbols_exact_and_bool(self):
  for kind in ('missing','false','integer','unknown'):
   r=report()
   if kind=='missing':r['symbols'].pop(m.SYMBOLS[0])
   elif kind=='false':r['symbols'][m.SYMBOLS[0]]=False
   elif kind=='integer':r['symbols'][m.SYMBOLS[0]]=1
   else:r['symbols']['unknown']=True
   with self.assertRaises(m.Held):m.Audit(value(),lambda:1).run(lambda:r)
 def test_expiry_before_and_after(self):
  with self.assertRaises(m.Held):m.Audit(value(),lambda:2_000_000_000)
  now=[1];a=m.Audit(value(),lambda:now[0]);calls=[]
  def late():calls.append(1);now[0]=2_000_000_000;return report()
  with self.assertRaises(m.Held):a.run(late)
  with self.assertRaises(m.Held):a.run(report)
  self.assertEqual(calls,[1]);self.assertFalse(a.receipt()['reported_symbols_available'])
 def test_exception_str_never_called(self):
  class Trap(Exception):
   def __str__(self):raise AssertionError('str called')
  a=m.Audit(value(),lambda:1)
  def fail():raise Trap('private')
  with self.assertRaises(m.Held):a.run(fail)
  self.assertEqual(a.receipt()['reason'],'observation_unavailable')
 def test_original_anchor_backward_duplicate(self):
  v=value();v['deadline_ns']=2_000_000_001
  with self.assertRaises(m.Held):m.Audit(v,lambda:1)
  a=m.Audit(value(),lambda:1);a.run(report)
  with self.assertRaises(m.Held):a.run(report)
  self.assertEqual(a.receipt()['reason'],'audit_already_attempted')
  now=[2];a=m.Audit(value(),lambda:now[0]);now[0]=1
  with self.assertRaises(m.Held):a.run(report)
 def test_detached_sources_and_hostile_key(self):
  v=value();a=m.Audit(v,lambda:1);v['sources']['spawn.h']=b'';self.assertEqual(a.run(report)['status'],'reported-profile')
  class Key:
   def __hash__(self):return 1
   def __eq__(self,other):raise AssertionError('comparison')
  v=value();v.pop('sources');v[Key()]={}
  with self.assertRaises(m.Held):m.Audit(v,lambda:1)
 def test_same_version_not_abi_proof(self):
  r=report();r['version']='26.0';r['python_attr_flags_exposed']=True
  o=m.Audit(value(),lambda:1).run(lambda:r)
  self.assertEqual(o['sdk_runtime_version_relation'],'same-label-unproved');self.assertFalse(o['native_readiness'])
if __name__=='__main__':unittest.main()

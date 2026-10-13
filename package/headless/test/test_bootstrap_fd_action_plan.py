import copy
import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('fd_action_plan',Path(__file__).resolve().parents[1]/'lib/bootstrap-fd-action-plan.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def rec(fd,inode,kind,access):return {'fd':fd,'device':1,'inode':inode,'kind':kind,'access_mode':access,'status_flags':access,'descriptor_flags':1}
def context():
    c={'schema':'temperance.bootstrap-fd-metadata.v1','parent':rec(0,1,'directory',0),'null':rec(1,2,'character',2),'channels':{},'stages':{},'cloexec_default_reported':False}
    for i,(role,access) in enumerate(zip(m.ROLES,m.ACCESS)):
        child=rec(2+2*i,3+i,'fifo',access);parent=rec(3+2*i,3+i,'fifo',1-access);c['channels'][role]={'child':child,'parent':parent};c['stages'][role]={**child,'fd':20+i}
    c['stages']['null']={**c['null'],'fd':25};return c
class Test(unittest.TestCase):
    def test_exact_eight_actions_then_known_closes(self):
        result=m.plan_actions(context());a=result['actions'];self.assertEqual(a[:3],(('dup2',25,0),('dup2',25,1),('dup2',25,2)));self.assertEqual([v[2] for v in a[:8]],list(range(8)));self.assertTrue(all(v[0]=='close' and v[1]>7 for v in a[8:]));self.assertEqual(len({v[1] for v in a[8:]}),len(a[8:]));self.assertEqual(result['owned_peak'],18)
    def test_mock_table_original_target_collisions_preserve_lifted_source(self):
        c=context();p=m.plan_actions(c);table={r['fd']:m.identity(r) for r in [c['parent'],c['null'],*[v for pair in c['channels'].values() for v in pair.values()],*c['stages'].values()]}
        for action in p['actions']:
            if action[0]=='dup2':table[action[2]]=table[action[1]]
            else:del table[action[1]]
        self.assertEqual(set(table),set(range(8)));self.assertEqual(table[0],table[1]);self.assertEqual(table[1],table[2])
        for role,target in zip(m.ROLES,range(3,8)):self.assertEqual(table[target],m.identity(c['channels'][role]['child']))
    def test_stage_source_collision_and_duplicate(self):
        for fd in (3,8,20):
            c=context();c['stages']['null']['fd']=fd
            with self.assertRaises(m.Held):m.plan_actions(c)
    def test_original_fd_duplicate(self):
        c=context();c['null']['fd']=c['parent']['fd']
        with self.assertRaises(m.Held):m.plan_actions(c)
    def test_identity_mode_and_flags_mismatch(self):
        for target,key,value in [('stage','inode',999),('stage','descriptor_flags',0),('stage','status_flags',1),('child','access_mode',True),('child','device',-1)]:
            c=context();r=c['stages']['codec_read'] if target=='stage' else c['channels']['codec_read']['child'];r[key]=value
            with self.assertRaises(m.Held):m.plan_actions(c)
    def test_distinct_fifo_identity_required(self):
        c=context();c['channels']['context_read']['child']['inode']=3;c['channels']['context_read']['parent']['inode']=3
        with self.assertRaises(m.Held):m.plan_actions(c)
    def test_claimed_capability_never_grants_native(self):
        for value in (True,False):
            c=context();c['cloexec_default_reported']=value;r=m.plan_actions(c);self.assertEqual(r['reported_cloexec_default'],value);self.assertFalse(r['actual_native_readiness']);self.assertFalse(r['unknown_inherited_fd_closure_verified']);self.assertFalse(r['execution_authorized'])
    def test_hostile_keys_no_callback(self):
        calls=[]
        class Key:
            def __hash__(self):calls.append('hash');return 1
            def __eq__(self,v):calls.append('eq');return False
        c=context();c.pop('schema');c[Key()]=1;calls.clear()
        with self.assertRaises(m.Held):m.plan_actions(c)
        self.assertFalse(calls)
    def test_unknown_shape_exact_bool_integer_bounds(self):
        for change in ({'extra':1},{'cloexec_default_reported':1}):
            c=context();c.update(change)
            with self.assertRaises(m.Held):m.plan_actions(c)
        c=context();c['parent']['fd']=2**31
        with self.assertRaises(m.Held):m.plan_actions(c)
    def test_detached_actions_no_mutable_metadata_retained(self):
        c=context();r=m.plan_actions(c);before=r['actions'];c['stages']['null']['fd']=99;self.assertEqual(r['actions'],before)
        with self.assertRaises(TypeError):r['owned_peak']=0
if __name__=='__main__':unittest.main()

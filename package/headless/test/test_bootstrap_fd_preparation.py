"""Mock-only adapter plus exact published planner; no real descriptors."""
from pathlib import Path
import hashlib
import unittest

def load(name,pin=None):
    p=Path(__file__).resolve().parents[1]/'lib'/name
    if p.stat().st_size>65536:raise RuntimeError('source bound')
    with p.open('rb') as stream:b=stream.read(65537)
    if len(b)>65536:raise RuntimeError('source bound')
    if pin and hashlib.sha256(b).hexdigest()!=pin:raise RuntimeError('source drift')
    ns={'__name__':'inert_'+name.replace('-','_')};exec(compile(b,str(p),'exec'),ns);return ns
P=load('bootstrap-fd-action-plan.py','6247e67239cde45713f59bac223c0ba765804b9a7969b0a3bbbeb5b8fc700b1f')
A=load('bootstrap-fd-preparation.py')
class Tests(unittest.TestCase):
    def setup_boundary(self,diag=False):
        self.now=0;self.next=10;self.rows={};self.closed=[];self.labels=[];self.channel={};self.fail=None
        self.o=A['Preparation'](0,2_000_000_000,lambda:self.now,P['plan_actions'],diag)
        self.receipts=tuple(dict(nonce='a'*32,counter=i,launch_limit=2) for i in (1,2));return self.o
    def allocate(self,label,source):
        self.labels.append(label);fd=self.next;self.next+=1
        if source:
            r=dict(source,fd=fd,descriptor_flags=source['descriptor_flags']|1)
        else:
            access=0;kind='fifo';ino=100
            if label=='parent':kind='directory';ino=1
            elif label=='null':kind='character';access=2;ino=2
            elif label=='sentinel':ino=999
            else:
                role,side=label.rsplit('-',1);idx=P['ROLES'].index(role);access=P['ACCESS'][idx] if side=='child' else 1-P['ACCESS'][idx];ino=100+idx
            r=dict(fd=fd,device=1,inode=ino,kind=kind,access_mode=access,status_flags=access,descriptor_flags=0)
        self.rows[fd]=r;return fd
    def identity(self,fd):return dict(self.rows[fd])
    def close(self,fd):self.closed.append(fd);return True
    def run_o(self,**kw):return self.o.run(kw.get('receipts',self.receipts),kw.get('allocate',self.allocate),kw.get('identity',self.identity),kw.get('close',self.close))
    def test_actual_planner_legitimate_identity_duplicates(self):
        self.setup_boundary();r=self.run_o();self.assertEqual(r['status'],'prepared-metadata');self.assertEqual(len(self.o.plan['owned_fds']),18);self.assertEqual(self.o.plan['dup2_count'],8);self.assertFalse(r['actual_native_readiness'])
    def test_diagnostic_separate(self):
        self.setup_boundary(True);r=self.run_o();self.assertEqual(r['returned_candidate_count'],19);self.assertEqual(r['planner_owned_count'],18);self.assertEqual(r['diagnostic_extra_count'],1);self.assertNotIn('sentinel',self.o.plan)
    def test_missing_second_no_alloc(self):
        self.setup_boundary();self.assertEqual(self.run_o(receipts=self.receipts[:1])['status'],'held');self.assertEqual(self.labels,[])
    def test_late_first_candidate_retained_unknown(self):
        self.setup_boundary()
        def alloc(label,src):fd=self.allocate(label,src);self.now=1_500_000_000;return fd
        r=self.run_o(allocate=alloc);self.assertEqual(r['returned_candidate_count'],1);self.assertTrue(r['cleanup_unknown']);self.assertEqual(self.closed,[])
    def test_identity_failure_safe_peers(self):
        self.setup_boundary()
        def identity(fd):
            if fd==11:raise RuntimeError('private')
            return self.identity(fd)
        r=self.run_o(identity=identity);self.assertEqual(self.closed,[10]);self.assertTrue(r['cleanup_unknown']);self.assertEqual(r['ownership_entries_visited'],2);self.assertEqual(r['close_attempt_count'],1)
    def test_replacement_not_closed(self):
        self.setup_boundary();r=self.run_o();self.rows[10]['inode']=999;self.o.teardown(self.identity,self.close);self.assertNotIn(10,self.closed);self.assertTrue(self.o.cleanup_unknown);self.assertEqual(len(self.closed),17)
    def test_numeric_collision_once_cleanup(self):
        self.setup_boundary()
        def alloc(label,src):return 10 if label=='null' else self.allocate(label,src)
        r=self.run_o(allocate=alloc);self.assertEqual(r['reason'],'fd_collision');self.assertEqual(self.closed,[10]);self.o.teardown(self.identity,self.close);self.assertEqual(self.closed,[10])
    def test_bad_stage_existing_planner_holds(self):
        self.setup_boundary()
        def alloc(label,src):fd=self.allocate(label,src);self.rows[fd]['inode']+=1 if src else 0;return fd
        r=self.run_o(allocate=alloc);self.assertEqual(r['status'],'held');self.assertEqual(len(self.closed),18)
    def test_close_failure_independent(self):
        self.setup_boundary();self.run_o()
        def close(fd):
            self.closed.append(fd)
            if fd==10:raise RuntimeError('private')
            return True
        self.o.teardown(self.identity,close);self.assertEqual(len(self.closed),18);self.assertTrue(self.o.cleanup_unknown);self.o.teardown(self.identity,close);self.assertEqual(len(self.closed),18)
    def test_sticky_attempt(self):
        self.setup_boundary();self.run_o(receipts=());self.run_o();self.assertEqual(self.labels,[])
    def test_source_sizes_before_read(self):
        reads=[];m={k:dict(size=65537,sha256='a'*64,continuous=True) for k in ('planner','adapter')}
        with self.assertRaises(A['Held']):A['source_snapshots'](m,lambda n:reads.append(n))
        self.assertEqual(reads,[])
    def test_source_exact_hashes(self):
        with (Path(__file__).resolve().parents[1]/'lib'/'bootstrap-fd-action-plan.py').open('rb') as stream:planner=stream.read(65537)
        self.assertLessEqual(len(planner),65536)
        values=dict(planner=planner,adapter=b'b');m={k:dict(size=len(v),sha256=hashlib.sha256(v).hexdigest(),continuous=True) for k,v in values.items()};r=A['source_snapshots'](m,lambda n:values[n]);self.assertEqual(r['planner'],values['planner'])
    def test_planner_reentrant_teardown_cannot_resurrect(self):
        self.setup_boundary()
        def planner(ctx):self.o.teardown(self.identity,self.close);return P['plan_actions'](ctx)
        self.o.planner=planner;r=self.run_o()
        self.assertEqual(r['status'],'held');self.assertIsNone(self.o.plan);self.assertEqual(len(self.closed),18)
    def test_allocator_reentrant_teardown_retains_candidate_only(self):
        self.setup_boundary();queries=[]
        def alloc(label,source):self.o.teardown(self.identity,self.close);return self.allocate(label,source)
        def identity(fd):queries.append(fd);return self.identity(fd)
        r=self.run_o(allocate=alloc,identity=identity)
        self.assertEqual(r['status'],'held');self.assertEqual(r['returned_candidate_count'],1);self.assertEqual(queries,[]);self.assertTrue(r['cleanup_unknown'])
    def test_emergency_cleanup_always_held(self):
        self.setup_boundary();self.run_o();self.now=2_000_000_001
        self.o.teardown(self.identity,self.close);r=self.o.receipt()
        self.assertEqual(len(self.closed),18);self.assertEqual(r['status'],'held');self.assertTrue(r['cleanup_unknown']);self.assertTrue(r['emergency_cleanup_used'])
    def test_success_teardown_not_prepared(self):
        self.setup_boundary();self.assertEqual(self.run_o()['status'],'prepared-metadata')
        self.o.teardown(self.identity,self.close);r=self.o.receipt()
        self.assertEqual(r['status'],'settled-metadata');self.assertEqual(r['reason'],'teardown');self.assertIsNone(self.o.plan)
        self.o.teardown(self.identity,self.close);self.assertEqual(len(self.closed),18)
        self.assertEqual(self.run_o()['status'],'settled-metadata')
        with self.assertRaises(A['Held']):self.o.acquire('extra',self.allocate,self.identity)
    def test_first_identity_immutable(self):
        self.setup_boundary();self.run_o()
        with self.assertRaises(TypeError):self.o.identities[10]['inode']=999
        self.o.teardown(self.identity,self.close);self.assertEqual(len(self.closed),18)
    def test_cleanup_window_stops_new_callbacks(self):
        self.setup_boundary();self.run_o();self.now=2_499_999_999
        seen=[]
        def identity(fd):seen.append(fd);self.now=2_500_000_000;return self.identity(fd)
        self.o.teardown(identity,self.close)
        self.assertEqual(seen,[10]);self.assertEqual(self.closed,[]);self.assertTrue(self.o.cleanup_unknown)
        self.o.teardown(identity,self.close);self.assertEqual(seen,[10])
    def test_planner_hash_not_caller_selectable(self):
        values=dict(planner=b'wrong',adapter=b'b');m={k:dict(size=len(v),sha256=hashlib.sha256(v).hexdigest(),continuous=True) for k,v in values.items()};reads=[]
        with self.assertRaises(A['Held']):A['source_snapshots'](m,lambda n:reads.append(n))
        self.assertEqual(reads,[])
if __name__=='__main__':unittest.main()

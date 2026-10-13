"""Pure injected ordering fixture; no FD/process/native operations."""
import unittest

FLAGS = ('native_authentication','execution_authorized','inference_authorized','unknown_fd_closure_proven')

class Held(Exception): pass

def closed(value, keys):
    if type(value) is not dict or len(value) != len(keys): raise Held('shape')
    if any(type(k) is not str or len(k)>64 for k in value): raise Held('shape')
    if set(value) != set(keys): raise Held('shape')

def integer(value, lo, hi):
    if type(value) is not int or not lo<=value<=hi: raise Held('shape')
    return value

def token(value):
    closed(value, ('pid','uid','birth','parent'))
    integer(value['pid'],2,2**31-1);integer(value['parent'],2,2**31-1);integer(value['uid'],0,2**32-1)
    b=value['birth']
    if type(b) is not str or not 1<=len(b)<=48 or not b.isascii(): raise Held('shape')
    return dict(value)

def capsule(value):
    closed(value,('schema','sentinel_fd','sentinel_device','sentinel_inode','sentinel_kind'))
    if type(value['schema']) is not str or value['schema']!='temperance.inert-sentinel-context.v1' or type(value['sentinel_kind']) is not str or value['sentinel_kind']!='fifo':raise Held('shape')
    integer(value['sentinel_fd'],8,2**31-1)
    for k in ('sentinel_device','sentinel_inode'):integer(value[k],1,2**63-1)
    return dict(value)

class Owner:
    """Trusted callbacks/DTOs only. Reported token is never signal authority."""
    def __init__(self, creator, created, deadline, clock, diagnostic=None):
        self.creator=token(creator);self.created=integer(created,0,2**63-1);self.deadline=integer(deadline,1,2**63-1)
        if not 500_000_000<deadline-created<=2_000_000_000:raise Held('deadline')
        self.last=created;self.clock=clock;self.allocations={};self.diag=capsule(diagnostic) if diagnostic is not None else None
        self.reason=None;self.started=False;self.candidates={};self.admitted={};self.receipts=[];self.events=[];self.peak=0
    def check(self):
        now=integer(self.clock(),self.last,2**63-1);self.last=now
        if now>=self.deadline-500_000_000:raise Held('deadline')
    def observe(self, cb, expected, role="creator"):
        self.check();v=cb();self.check()
        closed(v,('token','pressure','rss','physical','descendants'))
        if token(v['token'])!=expected:raise Held('identity')
        if integer(v['pressure'],1,4)!=1:raise Held('pressure')
        for k in ('rss','physical'):
            n=integer(v[k],0,2**63-1)
            if role!='creator' and n>128*1024*1024:raise Held('resource')
        descendants=integer(v['descendants'],0,4096)
        expected_children=1 if role=='creator' and 'supervisor' in self.candidates else 0
        if role=='supervisor' and 'worker' in self.candidates:expected_children=1
        if descendants!=expected_children:raise Held('resource')
    def run(self,reserve,create,observe,handoff,sentinel,allocate):
        if self.started:return self.receipt()
        self.started=True
        try:
            for counter in (1,2):
                self.observe(lambda:observe('creator'),self.creator);self.events.append('reserve-intent')
                r=reserve(counter)
                closed(r,('nonce','counter','launch_limit'))
                if type(r['nonce']) is not str or len(r['nonce'])!=32 or any(c not in '0123456789abcdef' for c in r['nonce']):raise Held('receipt')
                if integer(r['counter'],1,2)!=counter or integer(r['launch_limit'],2,2)!=2:raise Held('receipt')
                if self.receipts and r['nonce']!=self.receipts[0]['nonce']:raise Held('receipt')
                self.receipts.append(dict(r));self.observe(lambda:observe('creator'),self.creator)
            for role,parent,base in (('supervisor',self.creator['pid'],0),('worker',None,3)):
                expected_parent=parent if parent is not None else self.candidates['supervisor']['pid']
                self.observe(lambda:observe('creator'),self.creator)
                self.events.append('allocate-'+role)
                a=allocate(role);closed(a,('count','sentinel'));integer(a['count'],18 if not self.diag else 19,18 if not self.diag else 19)
                retained={'count':a['count'],'sentinel':capsule(a['sentinel']) if self.diag else None}
                if not self.diag and a['sentinel'] is not None:raise Held('shape')
                self.allocations[role]=retained;self.check()
                self.peak=max(self.peak,base+retained['count']+8)
                self.events.append('create-intent-'+role)
                candidate=token(create(role));self.candidates[role]=candidate
                self.check();self.observe(lambda:observe('creator'),self.creator)
                if candidate['parent']!=expected_parent or candidate['uid']!=self.creator['uid'] or candidate['pid'] in (self.creator['pid'], *(v['pid'] for k,v in self.candidates.items() if k!=role)):raise Held('relation')
                self.observe(lambda:observe(role),candidate,role)
                self.admitted[role]=True
                self.events.append('handoff-'+role)
                h=handoff(role)
                closed(h,('incoming','peers','directory_fd_closed','sentinel_fd_closed','budget_preserved'))
                for group in ('incoming','peers'):
                    closed(h[group],('3','4','5','6','7'))
                    for endpoint in h[group].values():
                        closed(endpoint,('eof','closed'))
                        if endpoint['eof'] is not True or endpoint['closed'] is not True:raise Held('endpoint')
                if h['directory_fd_closed'] is not True or h['budget_preserved'] is not True or h['sentinel_fd_closed'] is not True:raise Held('endpoint')
                self.check()
                if self.diag:
                    actual=sentinel(role,self.allocations[role]['sentinel']);closed(actual,('schema','fd','verdict'));self.check()
                    if actual['schema']!='temperance.inert-sentinel-observation.v1' or type(actual['schema']) is not str or type(actual['verdict']) is not str or integer(actual['fd'],8,2**31-1)!=self.allocations[role]['sentinel']['sentinel_fd']:raise Held('sentinel_unknown')
                    if actual['verdict']=='same-identity':raise Held('sentinel_inherited')
                    if actual['verdict']!='absent':raise Held('sentinel_unknown')
            self.events.append('settled-metadata')
        except Exception as e:
            args=BaseException.args.__get__(e)
            self.reason=args[0] if type(args) is tuple and len(args)==1 and type(args[0]) is str and args[0] in ('shape','deadline','identity','pressure','resource','receipt','relation','endpoint','sentinel','sentinel_unknown','sentinel_inherited') else 'callback_unavailable'
        return self.receipt()
    def receipt(self):
        return {'status':'held' if self.reason else ('metadata-only' if 'settled-metadata' in self.events else 'pending'), 'reason':self.reason,'retained_receipt_count':len(self.receipts),'candidate_count':len(self.candidates),'admitted_count':len(self.admitted),'global_private_fd_peak':self.peak,'cleanup_verified':False, **dict.fromkeys(FLAGS,False)}

class Tests(unittest.TestCase):
    def setup_owner(self,diag=False):
        self.now=0;self.calls=[];self.o=None
        self.tokens={'creator':dict(pid=10,uid=7,birth='1:2',parent=2),'supervisor':dict(pid=11,uid=7,birth='2:3',parent=10),'worker':dict(pid=12,uid=7,birth='3:4',parent=11)}
        self.d=dict(schema='temperance.inert-sentinel-context.v1',sentinel_fd=8,sentinel_device=1,sentinel_inode=2,sentinel_kind='fifo')
        self.o=Owner(self.tokens['creator'],0,2_000_000_000,lambda:self.now,self.d if diag else None);return self.o
    def reserve(self,n):self.calls.append(('reserve',n));return dict(nonce='a'*32,counter=n,launch_limit=2)
    def create(self,r):self.calls.append(('create',r));return self.tokens[r]
    def observe(self,r):return dict(token=self.tokens[r],pressure=1,rss=1,physical=1,descendants=(1 if (r=='creator' and 'supervisor' in self.o.candidates) or (r=='supervisor' and 'worker' in self.o.candidates) else 0))
    def handoff(self,r):return dict(incoming={str(i):dict(eof=True,closed=True) for i in range(3,8)},peers={str(i):dict(eof=True,closed=True) for i in range(3,8)},directory_fd_closed=True,sentinel_fd_closed=True,budget_preserved=True)
    def run_owner(self,o,**kw):return o.run(kw.get('reserve',self.reserve),kw.get('create',self.create),kw.get('observe',self.observe),kw.get('handoff',self.handoff),kw.get('sentinel',lambda r,c:dict(schema='temperance.inert-sentinel-observation.v1',fd=c['sentinel_fd'],verdict='absent')),kw.get('allocate',lambda r:dict(count=19 if o.diag else 18,sentinel=dict(self.d,sentinel_fd=8 if r=='supervisor' else 9,sentinel_inode=2 if r=='supervisor' else 3) if o.diag else None)))
    def test_order_and_global_peaks(self):
        for diag,peak in ((False,29),(True,30)):
            o=self.setup_owner(diag);r=self.run_owner(o);self.assertEqual(r['status'],'metadata-only');self.assertEqual(r['global_private_fd_peak'],peak);self.assertEqual(self.calls[:2],[('reserve',1),('reserve',2)]);self.assertLess(o.events.index('handoff-supervisor'),o.events.index('allocate-worker'));self.assertFalse(r['execution_authorized'])
    def test_lost_second_blocks_allocations_and_retry(self):
        o=self.setup_owner()
        def reserve(n):
            if n==2:raise RuntimeError('private')
            return self.reserve(n)
        self.assertEqual(self.run_owner(o,reserve=reserve)['status'],'held');self.assertFalse(any(x.startswith('allocate') for x in o.events));before=list(self.calls);self.run_owner(o);self.assertEqual(before,self.calls)
    def test_late_candidate_retained(self):
        o=self.setup_owner()
        def create(r):v=self.create(r);self.now=1_500_000_000;return v
        r=self.run_owner(o,create=create);self.assertEqual(r['candidate_count'],1);self.assertEqual(r['admitted_count'],0);self.assertEqual(r['reason'],'deadline')
    def test_wrong_parent_candidate_retained(self):
        o=self.setup_owner();self.tokens['supervisor']['parent']=99;r=self.run_owner(o);self.assertEqual(r['candidate_count'],1);self.assertEqual(r['admitted_count'],0);self.assertEqual(r['reason'],'relation')
    def test_endpoint_failure_blocks_worker(self):
        for group in ('incoming','peers'):
            o=self.setup_owner()
            def handoff(r):h=self.handoff(r);h[group]['5']['closed']=False;return h
            self.assertEqual(self.run_owner(o,handoff=handoff)['reason'],'endpoint');self.assertNotIn('allocate-worker',o.events)
    def test_budget_preserved_required(self):
        o=self.setup_owner()
        def h(r):v=self.handoff(r);v['budget_preserved']=False;return v
        self.assertEqual(self.run_owner(o,handoff=h)['reason'],'endpoint')
    def test_pressure_and_resource_holds(self):
        for field,val in (('pressure',2),('pressure',4),('descendants',1)):
            o=self.setup_owner()
            def obs(r):v=self.observe(r);v[field]=val;return v
            self.assertEqual(self.run_owner(o,observe=obs)['status'],'held');self.assertFalse(any(c[0]=='create' for c in self.calls))
    def test_sentinel_identity_not_number_only(self):
        o=self.setup_owner(True)
        def s(r,c):return dict(schema='temperance.inert-sentinel-observation.v1',fd=c['sentinel_fd'],verdict='different-identity')
        self.assertEqual(self.run_owner(o,sentinel=s)['reason'],'sentinel_unknown');self.assertNotIn('allocate-worker',o.events)
    def test_closed_diagnostic_bounds(self):
        for key,val in (('sentinel_fd',True),('sentinel_device',0),('sentinel_inode',2**63),('sentinel_kind','pipe')):
            self.setup_owner();d=dict(self.d);d[key]=val
            with self.assertRaises(Held):capsule(d)
    def test_backwards_clock_sticky(self):
        o=self.setup_owner();self.now=100;o.check();self.now=99
        self.assertEqual(self.run_owner(o)['status'],'held');self.assertEqual(self.calls,[])
    def test_same_identity_is_leak(self):
        o=self.setup_owner(True)
        r=self.run_owner(o,sentinel=lambda role,c:dict(schema='temperance.inert-sentinel-observation.v1',fd=c['sentinel_fd'],verdict='same-identity'))
        self.assertEqual(r['reason'],'sentinel_inherited');self.assertNotIn('allocate-worker',o.events)
    def test_actor_resource_bound_creator_excluded(self):
        o=self.setup_owner()
        def obs(role):v=self.observe(role);v['rss']=200*1024*1024;return v
        r=self.run_owner(o,observe=obs);self.assertEqual(r['reason'],'resource');self.assertEqual(r['candidate_count'],1)
    def test_late_allocation_retained(self):
        o=self.setup_owner(True)
        def alloc(role):self.now=1_500_000_000;return dict(count=19,sentinel=self.d)
        self.assertEqual(self.run_owner(o,allocate=alloc)['reason'],'deadline');self.assertIn('supervisor',o.allocations);self.assertEqual(o.candidates,{})
    def test_distinct_actor_capsules(self):
        o=self.setup_owner(True);self.run_owner(o)
        self.assertNotEqual(o.allocations['supervisor']['sentinel'],o.allocations['worker']['sentinel'])
    def test_lost_create_unknown(self):
        o=self.setup_owner()
        def c(r):raise RuntimeError('private')
        r=self.run_owner(o,create=c);self.assertEqual(r['candidate_count'],0);self.assertEqual(r['reason'],'callback_unavailable');self.assertFalse(r['cleanup_verified'])

if __name__=='__main__':unittest.main()

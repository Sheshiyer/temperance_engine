import copy
import importlib.util
from pathlib import Path
import sys
import unittest

spec=importlib.util.spec_from_file_location('worker_observation',Path(__file__).resolve().parents[1]/'lib/model-worker-observation.py')
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)


def policy():
    return {'schema':'temperance.model-worker-policy.v1','kind':'metadata-calibration',
        'wall_ns':10_000_000_000,'rss_bytes':128*m.MIB,'physical_bytes':128*m.MIB,
        'active_descendants':0,'lifetime_identities':256,'snapshot_ids':4096}


def owner():
    return {'schema':'temperance.retained-worker-owner.v1','nonce':'a'*32,'counter':1,
        'launch_limit':4,'creator_pid':101,'uid':501,'creator_birth':'darwin:100:1',
        'created_ns':1_000_000_000,'invocation_deadline_ns':121_000_000_000}


def process():
    return {'pid':102,'uid':501,'birth':'darwin:100:2','kernel_start':None}


class ObservationTests(unittest.TestCase):
    def new(self, pol=None, own=None, proc=None):
        self.now=[2_000_000_000]
        return m.Observer(policy() if pol is None else pol,owner() if own is None else own,
            process() if proc is None else proc,clock=lambda:self.now[0])

    def identity(self,pid):
        return {'pid':pid,'uid':501,'birth':'darwin:100:1' if pid==101 else 'darwin:100:2','state':'live'}

    def usage(self,pid):
        return {'backend':'darwin-proc-pid-rusage-v0','native_result':0,'rss_bytes':1*m.MIB,
            'physical_bytes':2*m.MIB,'kernel_start':777,'kernel_exit':0}

    def test_observed_metadata_no_authority(self):
        state=self.new();receipt=state.sample(self.identity,self.usage)
        self.assertEqual(state.process.kernel_start,777)
        self.assertEqual(receipt['status'],'metadata-observed')
        self.assertTrue(all(v is False for k,v in receipt.items() if k.endswith(('authorized','authorization','verified','contained','proven'))))
        self.assertNotIn('darwin:100',str(receipt));self.assertNotIn('a'*32,str(receipt))
        state.sample(self.identity,self.usage);self.assertEqual(state.samples,2)

    def test_closed_downward_policy_build_missing(self):
        with self.assertRaises(m.Held):m.Policy.parse(None)
        for key,value in [('kind','build'),('wall_ns',10_000_000_001),('rss_bytes',128*m.MIB+1),('physical_bytes',128*m.MIB+1),('active_descendants',1),('snapshot_ids',4097),('lifetime_identities',257),('rss_bytes',True)]:
            changed=policy();changed[key]=value
            with self.assertRaises(m.Held):m.Policy.parse(changed)
        changed=policy();changed['rss_bytes']=1
        self.assertEqual(m.Policy.parse(changed).rss_bytes,1)
        changed=policy();changed['extra']=1
        with self.assertRaises(m.Held):m.Policy.parse(changed)

    def test_owner_counter_and_deadline_closed(self):
        for key,value in [('counter',0),('counter',5),('counter',True),('nonce','bad'),('invocation_deadline_ns',122_000_000_000),('creator_birth','darwin:100:1000000')]:
            changed=owner();changed[key]=value
            with self.assertRaises(m.Held):m.Owner.parse(changed)
        changed=owner();changed['execution_authorized']=True
        with self.assertRaises(m.Held):m.Owner.parse(changed)
        state=self.new();self.assertEqual(state.deadline,11_000_000_000)
        changed=owner();changed['invocation_deadline_ns']=5_000_000_000
        self.assertEqual(self.new(own=changed).deadline,5_000_000_000)

    def test_detached_immutable_owner_process_policy(self):
        pol=policy();own=owner();proc=process();state=self.new(pol,own,proc)
        own['counter']=4;pol['rss_bytes']=999;proc['birth']='darwin:999:3'
        self.assertEqual(state.owner.counter,1);self.assertEqual(state.process.birth,'darwin:100:2')
        self.assertEqual(state.policy.rss_bytes,128*m.MIB)

    def test_creator_disappeared_or_wrong_child_birth(self):
        for changed_pid in (101,102):
            state=self.new();calls=[]
            def missing(pid):
                calls.append(pid)
                return None if pid==changed_pid else self.identity(pid)
            with self.assertRaises(m.Held):state.sample(missing,self.usage)
            self.assertEqual(state.status,'held');self.assertEqual(state.samples,0)
        state=self.new()
        def mismatch(pid):
            value=self.identity(pid)
            if pid==102:value['birth']='darwin:101:2'
            return value
        with self.assertRaises(m.Held):state.sample(mismatch,self.usage)

    def test_birth_sandwich_and_kernel_start_no_overwrite(self):
        state=self.new();counts=[0]
        def changing(pid):
            value=self.identity(pid)
            if pid==102:
                counts[0]+=1
                if counts[0]==2:value['birth']='darwin:101:2'
            return value
        with self.assertRaises(m.Held):state.sample(changing,self.usage)
        self.assertIsNone(state.process.kernel_start)
        state=self.new();state.sample(self.identity,self.usage)
        def start_changed(pid):
            value=self.usage(pid);value['kernel_start']=778;return value
        with self.assertRaises(m.Held):state.sample(self.identity,start_changed)
        self.assertEqual(state.process.kernel_start,777)

    def test_independent_memory_limits_and_bad_native_return(self):
        for key,value in [('rss_bytes',128*m.MIB+1),('physical_bytes',128*m.MIB+1),('native_result',True),('kernel_exit',1),('kernel_start',0),('backend','linux-unsupported')]:
            state=self.new()
            def invalid(pid):
                result=self.usage(pid);result[key]=value;return result
            with self.assertRaises(m.Held):state.sample(self.identity,invalid)
            self.assertEqual(state.samples,0)

    def test_late_callback_deadline_never_renews(self):
        state=self.new();deadline=state.deadline
        def late(pid):
            self.now[0]=deadline;return self.usage(pid)
        with self.assertRaises(m.Held):state.sample(self.identity,late)
        self.assertEqual(state.reason,'deadline');self.assertEqual(state.deadline,deadline)
        self.assertFalse(state.receipt()['cleanup_verified'])
        with self.assertRaises(m.Held):state.sample(self.identity,self.usage)

    def test_cancel_clock_failure_and_backwards_hold(self):
        state=self.new();state.cancelled=lambda:True
        with self.assertRaises(m.Held):state.sample(self.identity,self.usage)
        self.assertEqual(state.reason,'cancelled')
        state=self.new();state.clock=lambda:float('nan')
        with self.assertRaises(m.Held):state.sample(self.identity,self.usage)
        self.assertEqual(state.status,'held')
        state=self.new();self.now[0]=1_999_999_999
        with self.assertRaises(m.Held):state.sample(self.identity,self.usage)
        self.assertEqual(state.reason,'clock_unavailable')

    def test_raw_callback_exception_is_redacted(self):
        state=self.new()
        def failing(pid):raise OSError('synthetic private raw detail')
        with self.assertRaises(m.Held):state.sample(self.identity,failing)
        self.assertEqual(state.reason,'observation_unavailable')
        self.assertNotIn('synthetic',str(state.receipt()))

    def test_fixed_sample_processing_bound(self):
        state=self.new()
        for _ in range(256):state.sample(self.identity,self.usage)
        with self.assertRaises(m.Held):state.sample(self.identity,self.usage)
        self.assertEqual(state.reason,'sample_bound');self.assertEqual(state.samples,256)

if __name__=='__main__':unittest.main()

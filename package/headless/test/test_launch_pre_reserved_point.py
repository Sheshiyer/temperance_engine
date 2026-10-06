"""Default mocks only. --point is a separately authorized private metadata point."""
import errno
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import threading
import time
from types import ModuleType,SimpleNamespace
import unittest
LIB=Path(__file__).resolve().parents[1]/'lib'
PINS={'launch-budget.py':'297157ebdcb6c5103d8762810900d01953abb46227eecbdd712c53072fed6c56','launch-handle-codec.py':'5a93e979702e6b95670de55f223a9dd11cbbe2bc3429fe90e0fa98ee09e771c8','launch-pre-reserved-profile.py':'70fd7f58a110237a87a3f9038325609365e69121183dba342dc7fc63a7979f6b'}
class Held(Exception):pass
def key(s):return s.st_dev,s.st_ino,stat.S_IFMT(s.st_mode)
def buffer_size(data):
    if type(data) is bytes:return len(data)
    if type(data) is memoryview and data.readonly and data.c_contiguous and data.ndim==1 and data.itemsize==1 and data.format=='B':return data.nbytes
    raise Held('metadata_bound')
class OwnedIntake:
    def __init__(self,owned,*,fstat=os.fstat):self.owned=owned;self.fstat=fstat;self.opened=set();self.unknown=False
    def own(self,fd):
        if fd in self.opened:self.unknown=True;raise Held('ownership_held')
        self.opened.add(fd) # opening intent retained even if first identity query fails
        try:
            if len(self.opened)>5:raise Held('ownership_held')
            self.owned[fd]=key(self.fstat(fd));return fd
        except Exception:self.unknown=True;raise Held('ownership_unknown') from None
class CloseOwner:
    def __init__(self,owned,*,fstat=os.fstat,close=os.close):self.owned=owned;self.fstat=fstat;self.close_op=close;self.attempted=set();self.verified=set();self.failed=False
    def close(self,fd):
        if fd in self.attempted:raise Held('close_already_attempted')
        self.attempted.add(fd)
        try:
            if fd not in self.owned or key(self.fstat(fd))!=self.owned[fd]:raise Held('cleanup_identity_unknown')
            self.close_op(fd)
            try:self.fstat(fd)
            except OSError as error:
                if error.errno==errno.EBADF:self.verified.add(fd);return
            raise Held('cleanup_unknown')
        except Exception:self.failed=True;raise Held('cleanup_unknown') from None
    def remaining(self,thread_alive):
        if thread_alive:return None
        return [fd for fd in self.owned if fd not in self.attempted]
def snapshot_close(fd,uncertainty,close=os.close):
    try:close(fd)
    except Exception:
        uncertainty['close_unknown']=True
        raise Held('snapshot_close_unknown') from None
def snapshot(name,check,uncertainty):
    check();fd=os.open(LIB/name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC)
    try:
        before=os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or not 0<=before.st_size<=65536:raise Held('source_held')
        raw=os.pread(fd,before.st_size,0);growth=os.pread(fd,1,before.st_size);after=os.fstat(fd);path=os.stat(LIB/name,follow_symlinks=False)
        fields=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
        if len(raw)!=before.st_size or growth or fields(before)!=fields(after) or fields(before)!=fields(path) or hashlib.sha256(raw).hexdigest()!=PINS[name]:raise Held('source_held')
        check();return raw
    finally:snapshot_close(fd,uncertainty)
def modules(raw):
    result={};sentinel=object();restore={}
    try:
        for index,(name,data) in enumerate(raw.items()):
            module_name='pre_reserved_point_'+str(index);restore[module_name]=sys.modules.get(module_name,sentinel);module=ModuleType(module_name);module.__file__=str(LIB/name);sys.modules[module_name]=module
            exec(compile(data,module.__file__,'exec'),module.__dict__);result[name]=module
        return result
    finally:
        for name,prior in restore.items():
            if prior is sentinel:sys.modules.pop(name,None)
            else:sys.modules[name]=prior
class MockTests(unittest.TestCase):
    def test_once_close_before_error_no_retry(self):
        calls=[];info=SimpleNamespace(st_dev=1,st_ino=2,st_mode=stat.S_IFIFO)
        def fail(fd):calls.append(fd);raise OSError('private')
        owner=CloseOwner({10:key(info)},fstat=lambda _:info,close=fail)
        for _ in range(2):
            with self.assertRaises(Held):owner.close(10)
        self.assertEqual(calls,[10]);self.assertTrue(owner.failed)
    def test_replacement_not_closed(self):
        info=SimpleNamespace(st_dev=1,st_ino=3,st_mode=stat.S_IFIFO);calls=[];owner=CloseOwner({10:(1,2,stat.S_IFIFO)},fstat=lambda _:info,close=calls.append)
        with self.assertRaises(Held):owner.close(10)
        self.assertFalse(calls)
    def test_failed_first_identity_open_intent_unknown(self):
        def fail(fd):raise OSError('private')
        owned={};intake=OwnedIntake(owned,fstat=fail)
        with self.assertRaises(Held):intake.own(10)
        self.assertEqual(intake.opened,{10});self.assertTrue(intake.unknown);self.assertFalse(owned)
    def test_snapshot_close_error_retains_uncertainty_no_retry(self):
        calls=[];marker={'close_unknown':False}
        def fail(fd):calls.append(fd);raise OSError('private')
        with self.assertRaises(Held) as error:snapshot_close(10,marker,fail)
        self.assertEqual(error.exception.args,('snapshot_close_unknown',));self.assertTrue(marker['close_unknown']);self.assertEqual(calls,[10])
    def test_actual_codec_write_frame_readonly_view_contract(self):
        raw=(LIB/'launch-handle-codec.py').read_bytes();module=modules({'launch-handle-codec.py':raw})['launch-handle-codec.py'];seen=[]
        channel=object.__new__(module._Channel);channel.wait=lambda *args:None;channel.check=lambda:None
        def write(fd,data):seen.append((type(data),buffer_size(data)));return data.nbytes
        channel.deps=SimpleNamespace(write=write);channel.write_frame(10,{'fixture':True});self.assertEqual(seen[0][0],memoryview);self.assertGreater(seen[0][1],4)
        for value in (memoryview(bytearray(b'x')),memoryview(b'xxxx')[::2],memoryview(b'ab').cast('H')):
            with self.assertRaises(Held):buffer_size(value)
    def test_live_thread_no_fallback(self):
        owner=CloseOwner({10:(1,2,stat.S_IFIFO),11:(1,3,stat.S_IFIFO)});owner.attempted.add(10)
        self.assertIsNone(owner.remaining(True));self.assertEqual(owner.remaining(False),[11])
class Point(unittest.TestCase):
    def run_point(self):
        start=time.monotonic_ns();deadline=start+1_500_000_000;owned={};intake=OwnedIntake(owned);paths={};directory=None;parent=None;parent_key=None;record_name=None;record_key=None;thread=None;closer=CloseOwner(owned);unknown=False;held=None;metrics={};modules_restored=False;wire={'attempted_bytes':0,'written_bytes':0,'read_bytes':0,'write_calls':0};wire_lock=threading.Lock();source_uncertainty={'close_unknown':False};stages={'budget_create_attempt_count':0,'budget_create_response_retained_count':0,'reserve_call_count':0,'injected_create_count':0};profile=None
        def check():
            if time.monotonic_ns()>=deadline:raise Held('environment_deadline')
        own=intake.own
        try:
            raw={n:snapshot(n,check,source_uncertainty) for n in PINS};prior={n:sys.modules.get(n) for n in ('pre_reserved_point_0','pre_reserved_point_1','pre_reserved_point_2')};loaded=modules(raw);modules_restored=all(sys.modules.get(n) is v for n,v in prior.items());check()
            budget=loaded['launch-budget.py'];codec=loaded['launch-handle-codec.py'];profile_module=loaded['launch-pre-reserved-profile.py']
            directory=os.path.realpath(tempfile.mkdtemp(prefix='te-budget-point-')); os.chmod(directory,0o700);parent=own(os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC));parent_key=owned[parent]
            pid=os.getpid();uid=os.getuid();first=budget.native_birth(pid,uid);check()
            native=lambda:{'pid':pid,'uid':uid,'birth':budget.native_birth(pid,uid)}
            b=budget.LaunchBudget();stages['budget_create_attempt_count']=1;created=b.create(directory,limit=1,ttl_ms=1500,owner_pid=pid);stages['budget_create_response_retained_count']=1;check();record_name=created['nonce']+'.json';record_key=key(os.stat(record_name,dir_fd=parent,follow_symlinks=False))
            if native()!={'pid':pid,'uid':uid,'birth':first}:raise Held('creator_changed')
            context={'directory':directory,'create_receipt':created,'creator':{'pid':pid,'uid':uid,'birth':first},'created_ns':start,'invocation_deadline_ns':deadline,'exchange_deadline_ns':deadline}
            profile=profile_module.PreReservedProfile(context);calls=[]
            def reserve(handle):stages['reserve_call_count']+=1;calls.append('reserve');return b.reserve(directory,handle['nonce'],0)
            def create_marker(handle,reservation):stages['injected_create_count']+=1;calls.append('injected-create');return True
            profile.reserve_and_create(reserve,create_marker,native);check() # all native queries before codec thread
            bridge=profile_module.TrustedCodecBridge(profile)
            flags=os.O_NONBLOCK|os.O_NOFOLLOW|os.O_CLOEXEC;pairs={}
            for name in ('owner-to-child.fifo','child-to-owner.fifo'):
                os.mkfifo(name,0o600,dir_fd=parent);paths[name]=key(os.stat(name,dir_fd=parent,follow_symlinks=False));r=own(os.open(name,os.O_RDONLY|flags,dir_fd=parent));w=own(os.open(name,os.O_WRONLY|flags,dir_fd=parent))
                if owned[r]!=paths[name] or owned[w]!=paths[name]:raise Held('path_held')
                pairs[name]=r,w
            child_r,owner_w=pairs['owner-to-child.fifo'];owner_r,child_w=pairs['child-to-owner.fifo'];results={}
            def bounded_write(fd,data):
                size=buffer_size(data)
                if fd not in (owner_w,child_w) or not 1<=size<=16384 or size>os.fpathconf(fd,'PC_PIPE_BUF'):raise Held('metadata_bound')
                with wire_lock:
                    if wire['attempted_bytes']+size>16384:raise Held('metadata_bound')
                    wire['attempted_bytes']+=size;wire['write_calls']+=1
                result=os.write(fd,data)
                with wire_lock:wire['written_bytes']+=result
                return result
            def bounded_read(fd,n):
                if fd not in (child_r,owner_r) or type(n) is not int or not 1<=n<=16384:raise Held('metadata_bound')
                with wire_lock:
                    remaining=16384-wire['read_bytes']
                    maximum=min(n,remaining+1)
                data=os.read(fd,maximum)
                with wire_lock:
                    if wire['read_bytes']+len(data)>16384:raise Held('metadata_bound')
                    wire['read_bytes']+=len(data)
                return data
            deps=codec._Dependencies(cancelled=lambda:time.monotonic_ns()>=deadline,close=closer.close,write=bounded_write,read=bounded_read)
            def child():
                try:results['child']=dict(codec._child_exchange(bridge.reserve,_fds=(child_r,child_w),_dependencies=deps))
                except Exception:results['child']={'status':'held'}
            thread=threading.Thread(target=child,daemon=True);thread.start()
            try:results['owner']=dict(codec._owner_exchange(dict(profile.handle),bridge.retain_ack,_fds=(owner_w,owner_r),_dependencies=deps))
            except Exception:results['owner']={'status':'held'}
            thread.join(max(0,(deadline-time.monotonic_ns())/1_000_000_000)) # once only, no new grace
            if thread.is_alive():raise Held('thread_cleanup_unknown')
            check()
            if any(results.get(role,{}).get('status')!='metadata-ready' for role in ('owner','child')) or calls!=['reserve','injected-create'] or profile.ack is None:raise Held('metadata_held')
            if any(results[role][f] is not False for role in results for f in codec.FLAGS):raise Held('authority_held')
            metrics={'reserve_call_count':calls.count('reserve'),'injected_create_count':calls.count('injected-create'),'codec_roles_ready':2,'scoped_modules_restored':modules_restored,'owned_peak':5}
        except Held as error:
            args=BaseException.args.__get__(error)
            held='snapshot_close_unknown' if type(args) is tuple and len(args)==1 and type(args[0]) is str and args[0]=='snapshot_close_unknown' else 'point_or_environment_held'
        except Exception:held='point_or_environment_held'
        finally:
            unknown=unknown or intake.unknown or source_uncertainty['close_unknown']
            alive=thread is not None and thread.is_alive()
            if alive:unknown=True # never concurrent close/unlink with live codec owner
            else:
                for fd in tuple(owned):
                    if fd==parent or fd in closer.attempted:continue
                    try:closer.close(fd)
                    except Exception:unknown=True
                matches=False
                if parent is not None:
                    try:matches=key(os.fstat(parent))==parent_key and key(os.stat(directory,follow_symlinks=False))==parent_key
                    except Exception:pass
                    if matches:
                        for name,original in [*paths.items(),*(([(record_name,record_key)] if record_name and record_key else []))]:
                            try:
                                if key(os.stat(name,dir_fd=parent,follow_symlinks=False))!=original:raise Held('path_unknown')
                                os.unlink(name,dir_fd=parent)
                            except Exception:unknown=True
                    else:unknown=True
                    try:closer.close(parent)
                    except Exception:unknown=True
                    if matches:
                        try:
                            if key(os.stat(directory,follow_symlinks=False))!=parent_key:raise Held('path_unknown')
                            os.rmdir(directory)
                        except Exception:unknown=True
                elif directory:unknown=True
        self.point={**metrics,**wire,**stages,'reservation_response_retained_count':int(profile is not None and profile.reservation is not None),'codec_ack_retained_count':int(profile is not None and profile.ack is not None),'unidentified_open_intent_count':len(intake.opened-set(owned)),'execution_authorized':False,'capacity_authorization':False,'inference_authorized':False,'native_authentication':False,'held_reason':held,'cleanup_unknown':unknown or closer.failed,'owned_close_attempt_count':len(closer.attempted),'verified_EBADF_count':len(closer.verified),'thread_alive':thread.is_alive() if thread else False}
        self.assertIsNone(held);self.assertFalse(unknown or closer.failed);self.assertTrue(modules_restored);self.assertEqual(len(closer.attempted),5);self.assertEqual(len(closer.verified),5);self.assertLess(time.monotonic_ns()-start,1_500_000_000)
if __name__=='__main__':
    is_point=sys.argv[1:]==['--point'];case=Point('run_point') if is_point else None
    suite=unittest.TestSuite([case]) if is_point else unittest.defaultTestLoader.loadTestsFromTestCase(MockTests)
    result=unittest.TextTestRunner().run(suite)
    if is_point:print(json.dumps({'test_count':result.testsRun,'failure_count':len(result.failures),'error_count':len(result.errors),'point':getattr(case,'point',{'held_reason':'point_unavailable'})},sort_keys=True))
    if not result.wasSuccessful():raise SystemExit(1)

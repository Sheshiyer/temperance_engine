"""Disposable current-process FIFO point; execution requires separate authorization."""
import builtins
import errno
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import time
from types import ModuleType,SimpleNamespace
import unittest

LIB=Path(__file__).resolve().parents[1]/'lib'
PINS={'model-worker-status-fd.py':'5ffb972ca2032d59a3b2ab51146d6c39e1a8fb806b9e56832d4120be6946e067','model-worker-stopped-protocol.py':'a22a3869e6de25f62bcfc413cc941f17e2052895284fb637b831feb4bd87da67','model-worker-observation.py':'d8558c16cbf326f76e1f0398f6807a1d57444858f39b3fb44d7455549b9327dc'}
class Held(Exception):pass
def key(s):return s.st_dev,s.st_ino,stat.S_IFMT(s.st_mode)
def snapshot(name,check):
    check();fd=os.open(LIB/name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC)
    try:
        before=os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or not 0<=before.st_size<=65536:raise Held('source_held')
        raw=os.pread(fd,before.st_size,0);growth=os.pread(fd,1,before.st_size);after=os.fstat(fd);path=os.stat(LIB/name,follow_symlinks=False)
        fields=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
        if len(raw)!=before.st_size or growth or fields(before)!=fields(after) or fields(before)!=fields(path) or hashlib.sha256(raw).hexdigest()!=PINS[name]:raise Held('source_held')
        check();return raw
    finally:os.close(fd)
def modules(raw):
    unique='status_point_observation_basis';sentinel=object();prior=sys.modules.get(unique,sentinel)
    basis=ModuleType(unique);basis.__file__=str(LIB/'model-worker-observation.py')
    class Loader:
        def exec_module(self,module):
            if module is not basis:raise Held('closure_held')
            exec(compile(raw['model-worker-observation.py'],basis.__file__,'exec'),module.__dict__)
    spec=SimpleNamespace(name=unique,loader=Loader())
    def exact_spec(name,path):
        if name!='stopped_protocol_basis' or Path(path)!=LIB/'model-worker-observation.py':raise Held('closure_held')
        return spec
    shim=SimpleNamespace(util=SimpleNamespace(spec_from_file_location=exact_spec,module_from_spec=lambda s:basis if s is spec else (_ for _ in ()).throw(Held('closure_held'))))
    def local_import(name,*args,**kwargs):return shim if name=='importlib.util' else builtins.__import__(name,*args,**kwargs)
    try:
        protocol=ModuleType('status_point_protocol');protocol.__file__=str(LIB/'model-worker-stopped-protocol.py');protocol.__dict__['__builtins__']={**vars(builtins),'__import__':local_import}
        exec(compile(raw['model-worker-stopped-protocol.py'],protocol.__file__,'exec'),protocol.__dict__)
        adapter=ModuleType('status_point_adapter');exec(compile(raw['model-worker-status-fd.py'],str(LIB/'model-worker-status-fd.py'),'exec'),adapter.__dict__)
        return adapter,protocol
    finally:
        if prior is sentinel:sys.modules.pop(unique,None)
        else:sys.modules[unique]=prior
class Test(unittest.TestCase):
    def test_status_release_point(self):
        start=time.monotonic_ns();deadline=start+1_500_000_000;owned={};attempted=set();verified=set();paths={};parent=None;directory=None;parent_key=None;adapter=None;held=None;unknown=False;metrics={}
        def check():
            if time.monotonic_ns()>=deadline:raise Held('environment_deadline')
        def own(fd):
            if len(owned)>=5 or fd in owned:raise Held('ownership_held')
            owned[fd]=key(os.fstat(fd));return fd
        def verify(fd):
            try:os.fstat(fd)
            except OSError as e:
                if e.errno==errno.EBADF:verified.add(fd);return
            raise Held('closure_unknown')
        def close(fd):
            if fd in attempted:return
            attempted.add(fd)
            if key(os.fstat(fd))!=owned[fd]:raise Held('cleanup_identity_unknown')
            os.close(fd);verify(fd)
        try:
            raw={name:snapshot(name,check) for name in PINS};boundary,protocol=modules(raw);check()
            directory=tempfile.mkdtemp(prefix='te-status-point-');os.chmod(directory,0o700);parent=own(os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC));parent_key=owned[parent]
            pairs={};flags=os.O_NONBLOCK|os.O_NOFOLLOW|os.O_CLOEXEC
            for name in ('status.fifo','release.fifo'):
                os.mkfifo(name,0o600,dir_fd=parent);info=os.stat(name,dir_fd=parent,follow_symlinks=False);paths[name]=key(info)
                if info.st_mode&0o777!=0o600:raise Held('path_held')
                r=own(os.open(name,os.O_RDONLY|flags,dir_fd=parent));w=own(os.open(name,os.O_WRONLY|flags,dir_fd=parent))
                if owned[r]!=paths[name] or owned[w]!=paths[name]:raise Held('path_held')
                pairs[name]=r,w
            sr,sw=pairs['status.fifo'];rr,rw=pairs['release.fifo']
            owner={'schema':'temperance.retained-worker-owner.v1','nonce':'a'*32,'counter':1,'launch_limit':4,'creator_pid':101,'uid':501,'creator_birth':'darwin:100:1','created_ns':start,'invocation_deadline_ns':deadline}
            policy={'schema':'temperance.model-worker-policy.v1','kind':'metadata-calibration','wall_ns':10_000_000_000,'rss_bytes':128*1024**2,'physical_bytes':128*1024**2,'active_descendants':0,'lifetime_identities':256,'snapshot_ids':4096}
            context={'nonce':'a'*32,'counter':1,'deadline_ns':deadline,'creator_pid':101,'uid':501,'creator_birth':'darwin:100:1','child_pid':102,'child_birth':'darwin:100:2'}
            calls=[]
            class Callbacks:
                def retained_owner_ack(self):return {'schema':'temperance.trusted-worker-owner-ack.v1',**{k:v for k,v in context.items() if k not in ('child_pid','child_birth')},'ack_eof_retained':True}
                def close_parent_copies(self):return True
                def observe_stopped(self):
                    if sr not in adapter.attempted or not adapter.closed.get(sr):raise Held('status_close_unknown')
                    calls.append('observe');return {'creator_pid':101,'creator_uid':501,'creator_birth':'darwin:100:1','pid':102,'uid':501,'birth':'darwin:100:2','parent_pid':101,'state':'stopped','pressure':'normal','rss_bytes':1,'physical_bytes':1,'descendants':0,'lifetime_count':1}
                def continue_child(self):calls.append('continue');return True
            encode=lambda c:protocol.control(protocol.basis.Owner.parse(owner),c['child_pid'],c['uid'],c['child_birth'])
            adapter=boundary.StatusFDAdapter({'status_reader':sr,'release_writer':rw},context,deadline,Callbacks(),encode)
            if adapter.reason:raise Held('adapter_held')
            data=json.dumps({'schema':'temperance.worker-stopped-status.v1','nonce':'a'*32,'counter':1,'pid':102,'stage':'before-payload-exec'},separators=(',',':')).encode();frame=len(data).to_bytes(4,'big')+data
            if len(frame)>484 or len(frame)+69>=1024 or os.fpathconf(sw,'PC_PIPE_BUF')<len(frame):raise Held('frame_bound')
            check()
            if os.write(sw,frame)!=len(frame):raise Held('status_write_unknown')
            close(sw);state=protocol.StoppedProtocol(policy,owner,102)
            for steps in range(16):
                check();result=state.step(adapter)
                if result['status'] in ('held','injected-continuation-observed'):break
            if result['status']!='injected-continuation-observed' or calls.count('continue')!=1:raise Held('protocol_held')
            for fd in adapter.attempted:attempted.add(fd);verify(fd)
            received=bytearray();eof=False
            for _ in range(4):
                check();part=os.read(rr,70-len(received))
                if not part:eof=True;break
                received.extend(part)
            if bytes(received)!=encode(context) or not eof:raise Held('release_held')
            metrics={'fixture_bytes':len(frame)+69,'protocol_steps':steps+1,'continuation_callback_count':calls.count('continue'),'scope':'current-process named-FIFO only'}
        except Exception:held='point_or_environment_held'
        finally:
            if adapter:
                adapter.teardown()
                for fd in adapter.attempted:
                    attempted.add(fd)
                    try:verify(fd)
                    except Exception:unknown=True
            for fd in owned:
                if fd==parent or fd in attempted:continue
                try:close(fd)
                except Exception:unknown=True
            matches=False
            if parent is not None:
                try:matches=key(os.fstat(parent))==parent_key and key(os.stat(directory,follow_symlinks=False))==parent_key
                except Exception:pass
                if matches:
                    for name,k in paths.items():
                        try:
                            if key(os.stat(name,dir_fd=parent,follow_symlinks=False))!=k:raise Held('path_unknown')
                            os.unlink(name,dir_fd=parent)
                        except Exception:unknown=True
                else:unknown=True
                try:close(parent)
                except Exception:unknown=True
                if matches:
                    try:
                        if key(os.stat(directory,follow_symlinks=False))!=parent_key:raise Held('path_unknown')
                        os.rmdir(directory)
                    except Exception:unknown=True
            elif directory:unknown=True
        self.point={**metrics,'held_reason':held,'cleanup_unknown':unknown,'owned_close_attempt_count':len(attempted),'verified_EBADF_count':len(verified),'adapter_attempt_count':len(adapter.attempted) if adapter else 0}
        self.assertIsNone(held);self.assertFalse(unknown);self.assertEqual(len(attempted),5);self.assertEqual(len(verified),5);self.assertEqual(self.point['adapter_attempt_count'],2);self.assertLess(time.monotonic_ns()-start,1_500_000_000)
if __name__=='__main__':unittest.main()

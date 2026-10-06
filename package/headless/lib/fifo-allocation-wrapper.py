"""Fixed reader-first allocation callbacks. OS primitives are injected only."""
from types import MappingProxyType
ROLES=('codec_read','codec_write','status_write','release_read','context_read')
ACCESS=(0,1,1,0,0)
RECORD={'fd','device','inode','kind','access_mode','status_flags','descriptor_flags'}
REASONS={'metadata_invalid','deadline','clock_regressed','allocation_invalid','identity_changed','cleanup_unverified','capability_unavailable','receipt_invalid'}
class Held(Exception):pass

def closed(v,keys):
    if type(v) is not dict or len(v)!=len(keys) or any(type(k) is not str or len(k)>64 for k in v) or set(v)!=keys:raise Held('metadata_invalid')
def integer(v,lo,hi):
    if type(v) is not int or not lo<=v<=hi:raise Held('metadata_invalid')
    return v

def path_token(v,kind):
    closed(v,{'device','inode','kind','mode'})
    integer(v['device'],0,2**63-1);integer(v['inode'],1,2**63-1)
    if type(v['kind']) is not str or v['kind']!=kind or type(v['mode']) is not int or v['mode']!=(0o40700 if kind=='directory' else 0o10600):raise Held('metadata_invalid')
    return MappingProxyType(dict(v))
def fd_record(v,fd):
    closed(v,RECORD)
    if integer(v['fd'],0,2**31-1)!=fd:raise Held('identity_changed')
    integer(v['device'],0,2**63-1);integer(v['inode'],1,2**63-1)
    if type(v['kind']) is not str or v['kind'] not in ('directory','character','fifo'):raise Held('metadata_invalid')
    integer(v['access_mode'],0,2);integer(v['status_flags'],0,2**31-1);integer(v['descriptor_flags'],0,2**31-1)
    if v['status_flags']&3!=v['access_mode']:raise Held('metadata_invalid')
    return MappingProxyType(dict(v))
def finite(error):
    args=BaseException.args.__get__(error)
    return args[0] if type(args) is tuple and len(args)==1 and type(args[0]) is str and len(args[0])<=64 and args[0] in REASONS else 'boundary_unavailable'

class Wrapper:
    def __init__(self,ops,created,deadline,clock,receipts,diagnostic=False):
        self.created=integer(created,0,2**63-1);self.deadline=integer(deadline,1,2**63-1-500_000_000)
        if not 500_000_000<deadline-created<=2_000_000_000 or type(diagnostic) is not bool:raise Held('deadline')
        if type(receipts) is not tuple or len(receipts)!=2:raise Held('receipt_invalid')
        nonce=None
        for n,r in enumerate(receipts,1):
            closed(r,{'nonce','counter','launch_limit'})
            if type(r['nonce']) is not str or len(r['nonce'])!=32 or any(c not in '0123456789abcdef' for c in r['nonce']) or integer(r['counter'],1,2)!=n or integer(r['launch_limit'],2,2)!=2 or nonce is not None and nonce!=r['nonce']:raise Held('receipt_invalid')
            nonce=r['nonce']
        self.ops=ops;self.clock=clock;self.last=created;self.diagnostic=diagnostic;self.limit=19 if diagnostic else 18
        self.cleanup_started=False;self.cleanup_running=False;self.reason=None;self.teardown=False;self.unknown=False;self.emergency=False
        self.fds={};self.pending={};self.labels=set();self.path_intents=set();self.paths={};self.dir_intent=False;self.directory=None
        self.close_visits=set();self.close_attempts=set();self.closed=set();self.unlink_attempts=set();self.rmdir_attempted=False;self.pending_effect=False
    def check(self,cleanup=False):
        now=integer(self.clock(),0,2**63-1)
        if now<self.last:raise Held('clock_regressed')
        self.last=now
        if cleanup:
            if now>=self.deadline:self.emergency=True;self.unknown=True
            if now>=self.deadline+500_000_000:raise Held('deadline')
        elif self.teardown or self.reason or now>=self.deadline-500_000_000:raise Held('deadline')
    def call(self,fn,*args):self.check();v=fn(*args);self.check();return v
    def open_fd(self,fn,*args):
        self.check()
        if len(self.fds)>=self.limit:raise Held('allocation_invalid')
        self.pending_effect=True;fd=fn(*args);integer(fd,0,2**31-1)
        if fd in self.fds:raise Held('allocation_invalid')
        self.fds[fd]=None;self.pending_effect=False;self.check()
        identity=fd_record(self.call(self.ops.identity,fd),fd);self.fds[fd]=identity
        return fd
    def make_path(self,role):
        if role in self.path_intents or len(self.path_intents)>= (6 if self.diagnostic else 5):raise Held('allocation_invalid')
        self.check();self.path_intents.add(role);self.pending_effect=True
        result=self.ops.mkfifo(role,0o600);token=path_token(result,'fifo');self.paths[role]=token;self.pending_effect=False;self.check()
    def verify_fifo(self,fd,role,access):
        r=self.fds[fd];p=self.paths[role]
        if r['kind']!='fifo' or r['access_mode']!=access or (r['device'],r['inode'])!=(p['device'],p['inode']):raise Held('identity_changed')
    def allocate(self,label,source):
        try:
            self.check()
            allowed={'parent','null',*(r+'-'+s for r in ROLES for s in ('child','parent','stage')),'null-stage'}
            if self.diagnostic:allowed.add('sentinel')
            if type(label) is not str or len(label)>64 or label not in allowed or label in self.labels:raise Held('allocation_invalid')
            self.labels.add(label)
            if label=='parent':
                self.dir_intent=True;self.pending_effect=True
                result=self.ops.mkdir(0o700);self.directory=path_token(result,'directory');self.pending_effect=False;self.check()
                fd=self.open_fd(self.ops.open_directory)
                r=self.fds[fd]
                if r['kind']!='directory' or (r['device'],r['inode'])!=(self.directory['device'],self.directory['inode']):raise Held('identity_changed')
                return fd
            if self.directory is None:raise Held('allocation_invalid')
            if label=='null':return self.open_fd(self.ops.open_null)
            if label.endswith('-stage'):
                if type(source) is not MappingProxyType:raise Held('metadata_invalid')
                src=fd_record(dict(source),source['fd']);fd0=src['fd']
                if fd0 not in self.fds or self.fds[fd0]!=src:raise Held('identity_changed')
                if self.call(self.ops.dup_command_available) is not True:raise Held('capability_unavailable')
                fd=self.open_fd(self.ops.duplicate,fd0,67,8);r=self.fds[fd]
                if fd<8 or any(r[k]!=src[k] for k in ('device','inode','kind','access_mode','status_flags')) or r['descriptor_flags']!=src['descriptor_flags']|1:raise Held('identity_changed')
                return fd
            if label=='sentinel':
                self.make_path('sentinel');fd=self.open_fd(self.ops.open_reader,'sentinel');self.verify_fifo(fd,'sentinel',0);return fd
            role,side=label.rsplit('-',1);access=ACCESS[ROLES.index(role)]
            if side=='parent':
                if role in self.pending:return self.pending.pop(role)
                if access!=0 or role not in self.paths:raise Held('allocation_invalid')
                fd=self.open_fd(self.ops.open_writer,role);self.verify_fifo(fd,role,1);return fd
            self.make_path(role)
            if access==1:
                parent=self.open_fd(self.ops.open_reader,role);self.verify_fifo(parent,role,0);self.pending[role]=parent
                child=self.open_fd(self.ops.open_writer,role);self.verify_fifo(child,role,1);return child
            child=self.open_fd(self.ops.open_reader,role);self.verify_fifo(child,role,0);return child
        except Exception as error:
            self.reason=self.reason or finite(error);self.unknown=self.unknown or self.pending_effect
            raise Held(self.reason) from None
    def identity(self,fd):
        self.check();current=fd_record(self.call(self.ops.identity,fd),fd)
        if self.fds.get(fd)!=current:raise Held('identity_changed')
        return dict(current)
    def close(self,fd):
        if fd in self.close_visits:return fd in self.closed
        self.close_visits.add(fd)
        try:self.check(True)
        except Exception:self.unknown=True;return False
        expected=self.fds.get(fd)
        if expected is None:self.unknown=True;return False
        try:
            current=fd_record(self.ops.identity(fd),fd);self.check(True)
            if current!=expected:self.unknown=True;return False
            self.close_attempts.add(fd);result=self.ops.close(fd);self.check(True)
            if result is True:self.closed.add(fd);return True
        except Exception:self.unknown=True
        self.unknown=True;return False
    def cleanup(self):
        if self.cleanup_running:self.unknown=True;return self.receipt()
        if self.cleanup_started:return self.receipt()
        self.cleanup_started=True;self.cleanup_running=True
        try:return self._cleanup()
        finally:self.cleanup_running=False
    def _cleanup(self):
        self.teardown=True
        for fd in self.fds:
            try:self.check(True)
            except Exception:self.unknown=True;break
            try:self.close(fd)
            except Exception:self.unknown=True
        if set(self.fds)!=self.closed or self.pending_effect or len(self.paths)!=len(self.path_intents):self.unknown=True;return self.receipt()
        for role,p in self.paths.items():
            if role in self.unlink_attempts:continue
            try:
                self.check(True);current=path_token(self.ops.path_identity(role),'fifo');self.check(True)
                if current!=p:self.unknown=True;continue
                self.unlink_attempts.add(role);r=self.ops.unlink(role);self.check(True)
                if r is not True:self.unknown=True
            except Exception:self.unknown=True
        if not self.unknown and self.directory is not None and not self.rmdir_attempted:
            try:
                self.check(True);current=path_token(self.ops.directory_identity(),'directory');self.check(True)
                if current!=self.directory:self.unknown=True
                elif not self.unknown:
                    self.rmdir_attempted=True;r=self.ops.rmdir();self.check(True)
                    if r is not True:self.unknown=True
            except Exception:self.unknown=True
        return self.receipt()
    def receipt(self):return MappingProxyType(dict(schema='temperance.fifo-allocation-wrapper.v1',status='held' if self.reason or self.unknown else ('settled-metadata' if self.teardown else 'injected-metadata'),reason=self.reason,pending_original_count=len(self.pending),owned_fd_candidates=len(self.fds),fifo_path_intents=len(self.path_intents),close_intent_count=len(self.close_attempts),injected_closed_count=len(self.closed),unlink_intent_count=len(self.unlink_attempts),rmdir_attempted=self.rmdir_attempted,cleanup_unknown=self.unknown,emergency_cleanup_used=self.emergency,actual_native_readiness=False,native_authentication=False,execution_authorized=False,capacity_authorization=False,inference_authorized=False))

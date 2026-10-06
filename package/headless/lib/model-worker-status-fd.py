"""Owner status/read release/write endpoint boundary; child role numbers are not remapped."""
import errno
import fcntl
import os
import re
import stat
import time
from types import MappingProxyType


class Held(Exception):pass


class System:
    fstat=staticmethod(os.fstat);read=staticmethod(os.read);write=staticmethod(os.write);close=staticmethod(os.close)
    @staticmethod
    def getfl(fd):return fcntl.fcntl(fd,fcntl.F_GETFL)
    @staticmethod
    def getfd(fd):return fcntl.fcntl(fd,fcntl.F_GETFD)
    @staticmethod
    def setfl(fd,value):return fcntl.fcntl(fd,fcntl.F_SETFL,value)
    @staticmethod
    def setfd(fd,value):return fcntl.fcntl(fd,fcntl.F_SETFD,value)
    @staticmethod
    def pipe_bound(fd):return os.fpathconf(fd,'PC_PIPE_BUF')


def key(info):
    result=(info.st_dev,info.st_ino,stat.S_IFMT(info.st_mode))
    if any(type(v) is not int or not 0<=v<=2**63-1 for v in result) or result[1]==0:raise Held('identity_invalid')
    return result


def birth(value):
    if type(value) is not str or len(value)>48:raise Held('context_invalid')
    match=re.fullmatch(r'darwin:([0-9]{1,20}):([0-9]{1,20})',value)
    if match is None or int(match[1])<=0 or int(match[2])>=1_000_000:raise Held('context_invalid')


class StatusFDAdapter:
    def __init__(self,endpoints,context,deadline_ns,callbacks,control_encoder,*,syscalls=None,clock=time.monotonic_ns):
        self.ops=System() if syscalls is None else syscalls;self.clock=clock;self.deadline=deadline_ns;self.last=None;self.reason=None
        self.fd={};self.keys={};self.fl={};self.df={};self.initial_fl={};self.initial_df={};self.attempted=set();self.closed={}
        self.callbacks=callbacks;self.encoder=control_encoder;self.context=None;self.status_eof=False;self.write_attempted=False;self.write_count_verified=False;self.observe_count=0;self.close_observe=None;self.continue_attempted=False
        invalid=type(endpoints) is not dict or set(endpoints)!= {'status_reader','release_writer'}
        if type(endpoints) is dict:
            for name in ('status_reader','release_writer'):
                fd=endpoints.get(name)
                if type(fd) is int and 0<=fd<=2**31-1:self.fd[name]=fd
                else:invalid=True
        for fd in set(self.fd.values()):
            try:self.keys[fd]=key(self.ops.fstat(fd))
            except Exception:invalid=True
        try:
            if invalid or len(set(self.fd.values()))!=2:self.fail('endpoint_invalid')
            if type(context) is not dict or set(context)!= {'nonce','counter','deadline_ns','creator_pid','uid','creator_birth','child_pid','child_birth'}:self.fail('context_invalid')
            if type(context['nonce']) is not str or re.fullmatch(r'[0-9a-f]{32}',context['nonce']) is None:self.fail('context_invalid')
            for name,low,high in (('counter',1,4),('deadline_ns',1,2**63-1),('creator_pid',2,2**31-1),('uid',0,2**32-1),('child_pid',2,2**31-1)):
                if type(context[name]) is not int or not low<=context[name]<=high:self.fail('context_invalid')
            birth(context['creator_birth']);birth(context['child_birth'])
            if context['child_pid']==context['creator_pid']:self.fail('context_invalid')
            self.context=MappingProxyType(dict(context))
            if type(deadline_ns) is not int or not 1<=deadline_ns<=context['deadline_ns']:self.fail('deadline_invalid')
            now=self.check()
            if deadline_ns-now>120_000_000_000 or not callable(control_encoder):self.fail('context_invalid')
            if self.keys[self.fd['status_reader']]==self.keys[self.fd['release_writer']]:self.fail('endpoint_invalid')
            for name,fd in self.fd.items():
                fl=self.call(self.ops.getfl,fd);df=self.call(self.ops.getfd,fd)
                if type(fl) is not int or not 0<=fl<=2**31-1 or type(df) is not int or not 0<=df<=2**31-1:self.fail('flags_invalid')
                self.fl[fd]=self.initial_fl[fd]=fl;self.df[fd]=self.initial_df[fd]=df
                if self.keys[fd][2]!=stat.S_IFIFO or fl&os.O_ACCMODE!=(os.O_RDONLY if name=='status_reader' else os.O_WRONLY):self.fail('endpoint_invalid')
            for fd in self.fd.values():
                self.validate(fd);self.call(self.ops.setfl,fd,self.fl[fd]|os.O_NONBLOCK);self.fl[fd]|=os.O_NONBLOCK
                self.validate(fd);self.call(self.ops.setfd,fd,self.df[fd]|fcntl.FD_CLOEXEC);self.df[fd]|=fcntl.FD_CLOEXEC;self.validate(fd)
        except Exception:
            self.reason=self.reason or 'context_unavailable';self.teardown()

    def fail(self,reason):self.reason=self.reason or reason;self.teardown();raise Held(self.reason)
    def check(self):
        if self.reason is not None:self.teardown();raise Held(self.reason)
        try:now=self.clock()
        except Exception:self.fail('clock_unavailable')
        if type(now) is not int or not 0<=now<=2**63-1 or self.last is not None and now<self.last:self.fail('clock_unavailable')
        self.last=now
        if now>=self.deadline:self.fail('deadline')
        return now
    def call(self,fn,*args):
        self.check()
        try:result=fn(*args)
        except Exception:self.fail('boundary_unavailable')
        self.check();return result
    def validate(self,fd):
        try:current=key(self.call(self.ops.fstat,fd))
        except Held:self.fail('identity_changed')
        if current!=self.keys[fd]:self.fail('identity_changed')
        fl=self.call(self.ops.getfl,fd);df=self.call(self.ops.getfd,fd)
        if type(fl) is not int or type(df) is not int or fl!=self.fl[fd] or df!=self.df[fd]:self.fail('flags_changed')
    def retained_owner_ack(self):return self.call(self.callbacks.retained_owner_ack)
    def close_parent_copies(self):return self.call(self.callbacks.close_parent_copies)
    def read_status(self,maximum):
        if type(maximum) is not int or not 1<=maximum<=64:self.fail('read_bound')
        if self.status_eof:self.fail('status_closed')
        fd=self.fd['status_reader'];self.validate(fd);self.check()
        try:data=self.ops.read(fd,maximum)
        except BlockingIOError as error:
            if error.errno not in (errno.EAGAIN,errno.EWOULDBLOCK):self.fail('read_unavailable')
            data=None
        except Exception:self.fail('read_unavailable')
        self.check();self.validate(fd)
        if data is not None and (type(data) is not bytes or len(data)>maximum):self.fail('read_invalid')
        if data==b'':
            self.status_eof=True
            if not self.close_fd(fd):self.fail('status_close_unverified')
        return data
    def observe_stopped(self):
        if not self.status_eof:self.fail('status_not_closed')
        value=self.call(self.callbacks.observe_stopped)
        if value is None:return None
        if type(value) is not dict:self.fail('identity_unavailable')
        expected=(self.context['creator_pid'],self.context['uid'],self.context['creator_birth'],self.context['child_pid'],self.context['uid'],self.context['child_birth'],self.context['creator_pid'])
        names=('creator_pid','creator_uid','creator_birth','pid','uid','birth','parent_pid')
        if any(type(value.get(n)) is not int for n in ('creator_pid','creator_uid','pid','uid','parent_pid')) or tuple(value.get(n) for n in names)!=expected or value.get('state')!='stopped':self.fail('identity_unavailable')
        self.observe_count+=1;return value
    def atomic_pipe_bound(self):
        fd=self.fd['release_writer'];self.validate(fd);result=self.call(self.ops.pipe_bound,fd)
        if type(result) is not int or result<69:self.fail('atomic_bound_unavailable')
        return result
    def write_control(self,packet):
        if self.write_attempted:self.fail('write_already_attempted')
        self.write_attempted=True
        if not self.status_eof or self.observe_count<1 or type(packet) is not bytes or len(packet)!=69:self.fail('control_invalid')
        expected=self.call(self.encoder,self.context)
        if type(expected) is not bytes or len(expected)!=69 or packet!=expected:self.fail('control_invalid')
        self.atomic_pipe_bound();fd=self.fd['release_writer'];self.validate(fd)
        result=self.call(self.ops.write,fd,packet)
        if type(result) is not int or result!=69:self.fail('control_write_uncertain')
        self.write_count_verified=True;return result
    def close_control_writer(self):
        self.check()
        if not self.write_count_verified:self.fail('control_not_written')
        if not self.close_fd(self.fd['release_writer']):self.fail('control_close_unverified')
        self.close_observe=self.observe_count;return True
    def continue_child(self):
        if self.continue_attempted:self.fail('continuation_already_attempted')
        if self.close_observe is None or self.observe_count<=self.close_observe:self.fail('postwrite_observation_missing')
        self.continue_attempted=True
        self.check()
        try:result=self.callbacks.continue_child()
        except Exception:self.fail('continuation_unverified')
        self.check()
        if result is not True:self.fail('continuation_unverified')
        return True
    def close_fd(self,fd):
        if fd in self.attempted:return self.closed.get(fd,False)
        self.attempted.add(fd)
        if fd not in self.keys:self.reason=self.reason or 'cleanup_identity_unknown';return False
        try:
            if key(self.ops.fstat(fd))!=self.keys[fd]:self.reason=self.reason or 'cleanup_identity_changed';return False
            self.ops.close(fd);self.closed[fd]=True;return True
        except Exception:self.reason=self.reason or 'cleanup_unavailable';return False
    def teardown(self):
        for fd in set(self.fd.values()):self.close_fd(fd)

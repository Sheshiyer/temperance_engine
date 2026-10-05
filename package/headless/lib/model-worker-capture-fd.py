"""Nonblocking capture FD boundary. Verification uses injected syscalls, no launch API."""
import errno
import fcntl
import os
import stat
import time

ROLES=('stdout','stderr','final','keeper')


class Held(Exception):pass


class System:
    fstat=staticmethod(os.fstat)
    read=staticmethod(os.read)
    close=staticmethod(os.close)
    @staticmethod
    def getfl(fd):return fcntl.fcntl(fd,fcntl.F_GETFL)
    @staticmethod
    def getfd(fd):return fcntl.fcntl(fd,fcntl.F_GETFD)
    @staticmethod
    def setfl(fd,value):return fcntl.fcntl(fd,fcntl.F_SETFL,value)
    @staticmethod
    def setfd(fd,value):return fcntl.fcntl(fd,fcntl.F_SETFD,value)


def identity(info):
    values=(info.st_dev,info.st_ino,stat.S_IFMT(info.st_mode))
    if any(type(v) is not int or not 0<=v<=2**63-1 for v in values):raise Held('identity_unavailable')
    return values


class FDAdapter:
    def __init__(self,descriptors,original_deadline_ns,terminal,*,syscalls=None,clock=time.monotonic_ns):
        self.ops=System() if syscalls is None else syscalls;self.clock=clock;self.deadline=original_deadline_ns;self.last=None
        self.fd={};self.keys={};self.initial_fl={};self.initial_fd={};self.current_fl={};self.current_fd={};self.attempted=set();self.close_results={};self.reason=None;self.terminal_callback=terminal
        invalid=type(descriptors) is not dict or set(descriptors)!=set(ROLES)
        if type(descriptors) is dict:
            for name in ROLES:
                value=descriptors.get(name)
                if type(value) is int and 0<=value<=2**31-1:self.fd[name]=value
                else:invalid=True
        # Discover every valid peer independently; first identity never overwritten.
        for fd in set(self.fd.values()):
            try:self.keys[fd]=identity(self.ops.fstat(fd))
            except Exception:invalid=True
        try:
            if invalid or len(set(self.fd.values()))!=4:self.fail('descriptor_invalid')
            if type(self.deadline) is not int or not 1<=self.deadline<=2**63-1:self.fail('deadline_invalid')
            now=self.check()
            if self.deadline-now>120_000_000_000:self.fail('deadline_invalid')
            for fd in self.fd.values():
                fl=self.call(self.ops.getfl,fd);df=self.call(self.ops.getfd,fd)
                if type(fl) is not int or not 0<=fl<=2**31-1 or type(df) is not int or not 0<=df<=2**31-1:self.fail('flags_unavailable')
                self.initial_fl[fd]=fl;self.initial_fd[fd]=df;self.current_fl[fd]=fl;self.current_fd[fd]=df
            for name,fd in self.fd.items():
                if self.keys[fd][2]!=stat.S_IFIFO:self.fail('descriptor_type')
                expected=os.O_WRONLY if name=='keeper' else os.O_RDONLY
                if self.initial_fl[fd]&os.O_ACCMODE!=expected:self.fail('descriptor_mode')
            if len({self.keys[self.fd[n]] for n in ROLES[:3]})!=3 or self.keys[self.fd['keeper']]!=self.keys[self.fd['final']]:self.fail('descriptor_identity')
            for fd in self.fd.values():
                self.validate(fd)
                self.call(self.ops.setfl,fd,self.initial_fl[fd]|os.O_NONBLOCK);self.current_fl[fd]=self.initial_fl[fd]|os.O_NONBLOCK
                self.validate(fd)
                self.call(self.ops.setfd,fd,self.initial_fd[fd]|fcntl.FD_CLOEXEC);self.current_fd[fd]=self.initial_fd[fd]|fcntl.FD_CLOEXEC
                self.validate(fd)
        except Exception:
            if self.reason is None:self.reason='native_unavailable'
            self.teardown()

    def fail(self,reason):
        self.reason=self.reason or reason;self.teardown();raise Held(self.reason)
    def check(self):
        if self.reason is not None:
            self.teardown();raise Held(self.reason)
        try:now=self.clock()
        except Exception:self.fail('clock_unavailable')
        if type(now) is not int or not 0<=now<=2**63-1 or self.last is not None and now<self.last:self.fail('clock_unavailable')
        self.last=now
        if now>=self.deadline:self.fail('deadline')
        return now
    def call(self,fn,*args):
        self.check()
        try:r=fn(*args)
        except Exception:self.fail('native_unavailable')
        self.check();return r
    def validate(self,fd):
        key=identity(self.call(self.ops.fstat,fd))
        if key!=self.keys[fd]:self.fail('identity_changed')
        fl=self.call(self.ops.getfl,fd);df=self.call(self.ops.getfd,fd)
        if type(fl) is not int or type(df) is not int or fl!=self.current_fl[fd] or df!=self.current_fd[fd]:self.fail('flags_changed')
    def identity(self,name):
        if name not in ROLES[:3]:self.fail('role_invalid')
        fd=self.fd[name];self.validate(fd);return self.keys[fd]
    def read(self,name,maximum):
        if type(maximum) is not int or not 1<=maximum<=16384:self.fail('read_bound')
        if name not in ROLES[:3]:self.fail('role_invalid')
        fd=self.fd[name];self.validate(fd);self.check()
        try:data=self.ops.read(fd,maximum)
        except BlockingIOError as error:
            if error.errno not in (errno.EAGAIN,errno.EWOULDBLOCK):self.fail('native_unavailable')
            data=None
        except Exception:self.fail('native_unavailable')
        self.check();self.validate(fd)
        if data is not None and (type(data) is not bytes or len(data)>maximum):self.fail('read_invalid')
        return data
    def terminal(self):return self.call(self.terminal_callback)
    def close_keeper(self):self.check();return self.close_fd(self.fd['keeper'])
    def abort_keeper(self):return self.close_fd(self.fd['keeper'])
    def close(self,name):
        if name not in ROLES[:3]:self.fail('role_invalid')
        result=self.close_fd(self.fd[name])
        if not result:raise Held(self.reason or 'cleanup_unavailable')
        return True
    def close_fd(self,fd):
        if fd in self.attempted:return self.close_results.get(fd,False)
        self.attempted.add(fd) # never retry, including close exceptions/reused descriptor
        if fd not in self.keys:self.reason=self.reason or 'cleanup_identity_unavailable';return False
        try:
            if identity(self.ops.fstat(fd))!=self.keys[fd]:self.reason=self.reason or 'cleanup_identity_changed';return False
            self.ops.close(fd);self.close_results[fd]=True;return True
        except Exception:self.reason=self.reason or 'cleanup_unavailable';return False
    def teardown(self):
        for fd in set(self.fd.values()):self.close_fd(fd)

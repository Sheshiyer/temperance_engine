"""Current-process-only disposable FD point. No child/model/native CLI."""
import errno
import fcntl
import hashlib
import importlib.util
import os
from pathlib import Path
import stat
import tempfile
import time
import unittest

LIB=Path(__file__).resolve().parents[1]/'lib'
EXPECTED={'model-worker-capture-fd.py':'7d1c682d9e8d3cac52ecd20bdaff43270aaf7fc684b7a8765700028ed83b6b1b',
          'model-worker-capture-step.py':'35e9fd428368e2fbad179d88c1417b9e2f68a65b070579d987b582d0ad547878'}


class PointHeld(Exception):pass


def key(info):return (info.st_dev,info.st_ino,stat.S_IFMT(info.st_mode))


def bounded_source(name):
    fd=os.open(LIB/name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC)
    try:
        before=os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size>65536:raise PointHeld('source_held')
        raw=os.pread(fd,before.st_size+1,0);after=os.fstat(fd)
        if len(raw)!=before.st_size or (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns) or hashlib.sha256(raw).hexdigest()!=EXPECTED[name]:raise PointHeld('source_held')
        module=type(os)(name);module.__file__=str(LIB/name);exec(compile(raw,str(LIB/name),'exec'),module.__dict__);return module
    finally:os.close(fd)


class Test(unittest.TestCase):
    def test_current_process_descriptor_point(self):
        start=time.monotonic_ns();deadline=start+1_500_000_000
        owned={};closed=set();verified=set();adapter=None;directory=None;parent=None;fifo_keys={};parent_key=None;metrics={};held=None;cleanup_unknown=False
        def check():
            if time.monotonic_ns()>=deadline:raise PointHeld('environment_deadline')
        def own(fd):
            if fd in owned or len(owned)-len(closed)>=8:raise PointHeld('ownership_held')
            owned[fd]=key(os.fstat(fd));return fd
        def ebadf(fd):
            try:os.fstat(fd)
            except OSError as error:
                if error.errno==errno.EBADF:verified.add(fd);return
            raise PointHeld('closure_unknown')
        def close_owned(fd):
            if fd in closed:return
            closed.add(fd)
            if key(os.fstat(fd))!=owned[fd]:raise PointHeld('cleanup_identity_unknown')
            os.close(fd);ebadf(fd) # immediate, no intervening FD allocation
        try:
            boundary=bounded_source('model-worker-capture-fd.py');step=bounded_source('model-worker-capture-step.py');check()
            directory=tempfile.mkdtemp(prefix='te-fd-point-');os.chmod(directory,0o700)
            parent=own(os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC));parent_key=owned[parent]
            for name in ('stdout.fifo','stderr.fifo','final.fifo'):
                os.mkfifo(name,0o600,dir_fd=parent)
                fifo=os.stat(name,dir_fd=parent,follow_symlinks=False);fifo_keys[name]=key(fifo)
                if fifo.st_mode&0o777!=0o600:raise PointHeld('path_held')
            if os.fstat(parent).st_mode&0o777!=0o700:raise PointHeld('path_held')
            flags=os.O_NONBLOCK|os.O_NOFOLLOW|os.O_CLOEXEC
            pairs={}
            for name in ('stdout.fifo','stderr.fifo','final.fifo'):
                reader=own(os.open(name,os.O_RDONLY|flags,dir_fd=parent))
                writer=own(os.open(name,os.O_WRONLY|flags,dir_fd=parent))
                if owned[reader]!=fifo_keys[name] or owned[writer]!=fifo_keys[name]:raise PointHeld('path_identity_held')
                pairs[name]=(reader,writer)
            stdout_r,stdout_w=pairs['stdout.fifo'];stderr_r,stderr_w=pairs['stderr.fifo'];final_r,final_w=pairs['final.fifo']
            keeper=own(os.open('final.fifo',os.O_WRONLY|flags,dir_fd=parent))
            if owned[keeper]!=fifo_keys['final.fifo']:raise PointHeld('path_identity_held')
            metrics.update(reader_unique_identity_count=len({owned[fd] for fd in (stdout_r,stderr_r,final_r)}),
                           invalid_identity_component_count=sum(type(v) is not int or not 0<=v<=2**63-1 for fd in (stdout_r,stderr_r,final_r) for v in owned[fd]))
            fdmap={'stdout':stdout_r,'stderr':stderr_r,'final':final_r,'keeper':keeper}
            terminal={'exited':False,'exit_code':None,'final_write_completed':False}
            adapter=boundary.FDAdapter(fdmap,deadline,lambda:dict(terminal))
            if adapter.reason is not None:raise PointHeld('adapter_'+adapter.reason)
            for fd in fdmap.values():
                if not fcntl.fcntl(fd,fcntl.F_GETFL)&os.O_NONBLOCK or not fcntl.fcntl(fd,fcntl.F_GETFD)&fcntl.FD_CLOEXEC:raise PointHeld('flags_held')
            capture=step.CaptureStep(adapter,{n:owned[fdmap[n]] for n in ('stdout','stderr','final')},deadline)
            if capture.step()['status']!='pending' or capture.keeper_closed:raise PointHeld('prewriter_held')
            payloads={stdout_w:b'{"fixture":true}\n',stderr_w:b'fixture-diagnostic',final_w:b'fixture-final'}
            if sum(map(len,payloads.values()))>=1024:raise PointHeld('fixture_bound')
            for fd,data in payloads.items():
                check();fl=fcntl.fcntl(fd,fcntl.F_GETFL);fcntl.fcntl(fd,fcntl.F_SETFL,fl|os.O_NONBLOCK)
                if len(data)>256 or os.fpathconf(fd,'PC_PIPE_BUF')<len(data):raise PointHeld('atomic_bound_held')
                if key(os.fstat(fd))!=owned[fd] or os.write(fd,data)!=len(data):raise PointHeld('fixture_write_held')
                close_owned(fd)
            terminal.update(exited=True,exit_code=0,final_write_completed=True) # fixture writes+closes, never CLI exit inference
            result=None
            for count in range(16):
                check();result=capture.step()
                if result['status']!='pending':break
            if result is None or result['status']!='completed':raise PointHeld('capture_held')
            private=capture.payload()
            if private['final']!=payloads[final_w] or private['stdout']!=payloads[stdout_w] or private['stderr']!=payloads[stderr_w]:raise PointHeld('payload_held')
            for fd in adapter.attempted:
                closed.add(fd);ebadf(fd) # before any FD allocation; adapter owns these closures
            if len(adapter.attempted)!=4 or not all(adapter.close_results.get(fd) is True for fd in adapter.attempted):raise PointHeld('adapter_cleanup_unknown')
            metrics.update(fixture_bytes=sum(map(len,payloads.values())),owned_peak=8,capture_steps=count+1,scope='current-process named-FIFO FD only')
        except PointHeld as error:
            held=error.args[0]
        except Exception:
            held='environment_or_ownership_held'
        finally:
            if adapter is not None:
                adapter.teardown()
                for fd in adapter.attempted:
                    closed.add(fd)
                    try:ebadf(fd)
                    except Exception:cleanup_unknown=True;held=held or 'adapter_cleanup_unknown'
            for fd in tuple(owned):
                if fd==parent or fd in closed:continue
                try:close_owned(fd)
                except Exception:cleanup_unknown=True;held=held or 'cleanup_unknown'
            if parent is not None and parent not in closed:
                parent_matches=False
                try:parent_matches=key(os.fstat(parent))==parent_key and key(os.stat(directory,follow_symlinks=False))==parent_key
                except Exception:pass
                if parent_matches:
                    for name,original in fifo_keys.items():
                        try:
                            if key(os.stat(name,dir_fd=parent,follow_symlinks=False))!=original:raise PointHeld('path_cleanup_unknown')
                            os.unlink(name,dir_fd=parent)
                        except Exception:cleanup_unknown=True;held=held or 'path_cleanup_unknown'
                else:cleanup_unknown=True;held=held or 'path_cleanup_unknown'
                try:close_owned(parent)
                except Exception:cleanup_unknown=True;held=held or 'cleanup_unknown'
                if parent_matches:
                    try:
                        if key(os.stat(directory,follow_symlinks=False))!=parent_key:raise PointHeld('path_cleanup_unknown')
                        os.rmdir(directory)
                    except Exception:cleanup_unknown=True;held=held or 'path_cleanup_unknown'
            elif directory is not None:cleanup_unknown=True;held=held or 'path_cleanup_unknown'
        self.point={**metrics,'held_reason':held,'owned_close_attempt_count':len(closed),'verified_EBADF_count':len(verified),'adapter_teardown_attempt_count':len(adapter.attempted) if adapter else 0,'cleanup_unknown':cleanup_unknown}
        if held is not None:print('FD_POINT_HELD',self.point)
        self.assertIsNone(held,'current-process fixture held or cleanup unknown')
        self.assertEqual(len(closed),8);self.assertEqual(len(verified),8);self.assertEqual(self.point['adapter_teardown_attempt_count'],4)
        self.assertEqual(metrics['reader_unique_identity_count'],3);self.assertEqual(metrics['invalid_identity_component_count'],0)
        self.assertLess(time.monotonic_ns()-start,1_500_000_000)

if __name__=='__main__':unittest.main()

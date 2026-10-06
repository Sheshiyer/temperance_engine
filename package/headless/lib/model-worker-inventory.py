"""Bounded Darwin UID metadata capture and immutable lifetime inventory; no signals."""
from collections import deque
import ctypes
import errno
import importlib.util
from pathlib import Path
import sys
import time

_spec=importlib.util.spec_from_file_location('worker_native_inventory_basis',Path(__file__).with_name('model-worker-native-observation.py'))
native=importlib.util.module_from_spec(_spec);_spec.loader.exec_module(native)
Held=native.Held
MAX_ROWS=4096


class TaskAllInfo(ctypes.Structure):
    _fields_=[('bsd',native.BsdInfo),('task',native.TaskInfo)]


class Clock:
    def __init__(self,deadline,clock):
        self.deadline=deadline;self.clock=clock;self.last=None
        if type(deadline) is not int or not 1<=deadline<=2**63-1:raise Held('deadline_invalid')
        self.check()
        if deadline-self.last>120_000_000_000:raise Held('deadline_invalid')
    def check(self):
        try:now=self.clock()
        except Exception:raise Held('clock_unavailable') from None
        if type(now) is not int or not 0<=now<=2**63-1 or self.last is not None and now<self.last:raise Held('clock_unavailable')
        self.last=now
        if now>=self.deadline:raise Held('deadline')
    def call(self,fn,*args):
        self.check()
        try:r=fn(*args)
        except Exception:raise Held('native_unavailable') from None
        self.check();return r


class Capture:
    def __init__(self,uid,deadline,*,clock=time.monotonic_ns,listpids=None,pidinfo=None,platform=sys.platform):
        if type(uid) is not int or not 0<=uid<=2**32-1:raise Held('uid_invalid')
        self.uid=uid;self.timer=Clock(deadline,clock)
        if platform!='darwin':raise Held('platform_unsupported')
        if native.layout()!=(136,120,128,96,8,96,72,80,88) or ctypes.sizeof(TaskAllInfo)!=232:raise Held('abi_unavailable')
        if (listpids is None)!=(pidinfo is None):raise Held('native_adapter_incomplete')
        if listpids is None:
            try:
                self.timer.check();lib=ctypes.CDLL('/usr/lib/libproc.dylib',use_errno=True);self.timer.check()
                lib.proc_listpids.argtypes=[ctypes.c_uint32,ctypes.c_uint32,ctypes.c_void_p,ctypes.c_int];lib.proc_listpids.restype=ctypes.c_int;self.timer.check()
                lib.proc_pidinfo.argtypes=[ctypes.c_int,ctypes.c_int,ctypes.c_uint64,ctypes.c_void_p,ctypes.c_int];lib.proc_pidinfo.restype=ctypes.c_int;self.timer.check()
                listpids,pidinfo=lib.proc_listpids,lib.proc_pidinfo
            except Held:raise
            except Exception:raise Held('native_unavailable') from None
        self.listpids,self.pidinfo=listpids,pidinfo

    def read(self):
        buffer=(ctypes.c_int*(MAX_ROWS+1))()
        count=self.timer.call(self.listpids,4,self.uid,buffer,ctypes.sizeof(buffer))
        if type(count) is not int or count<=0 or count%4 or count>MAX_ROWS*4:raise Held('snapshot_bound')
        pids=list(buffer[:count//4])
        if any(pid<=1 for pid in pids) or len(set(pids))!=len(pids):raise Held('snapshot_invalid')
        rows={}
        for pid in pids:
            self.timer.check();info=TaskAllInfo();ctypes.set_errno(0)
            count=self.timer.call(self.pidinfo,pid,2,0,ctypes.byref(info),232);error=ctypes.get_errno()
            if type(count) is not int:raise Held('metadata_unavailable')
            if count==0 and error==errno.ESRCH:continue
            if count==136:
                zombie=native.BsdInfo();ctypes.set_errno(0)
                result=self.timer.call(self.pidinfo,pid,3,0,ctypes.byref(zombie),136);error=ctypes.get_errno()
                if type(result) is int and result==0 and error==errno.ESRCH:continue
                if type(result) is not int or result!=136 or zombie.status!=5 or (zombie.start_sec,zombie.start_usec)!=(info.bsd.start_sec,info.bsd.start_usec):raise Held('zombie_unavailable')
                info.bsd=zombie;info.task.resident_size=0
            elif count!=232:raise Held('metadata_unavailable')
            b=info.bsd
            if b.pid!=pid or b.uid!=self.uid or b.status not in (2,3,4,5) or b.start_sec==0 or b.start_usec>=1_000_000:raise Held('identity_unavailable')
            rows[pid]={'pid':pid,'uid':self.uid,'parent_pid':int(b.ppid),'birth':f'darwin:{b.start_sec}:{b.start_usec}',
                       'state':'zombie' if b.status==5 else 'stopped' if b.status==4 else 'live','rss_bytes':int(info.task.resident_size)}
        self.timer.check();return rows


def row(value):
    if type(value) is not dict or set(value)!= {'pid','uid','parent_pid','birth','state','rss_bytes'}:raise Held('row_invalid')
    for key,low,high in (('pid',2,2**31-1),('uid',0,2**32-1),('parent_pid',0,2**31-1),('rss_bytes',0,2**64-1)):
        if type(value[key]) is not int or not low<=value[key]<=high:raise Held('row_invalid')
    if type(value['birth']) is not str or len(value['birth'])>128 or value['state'] not in ('live','stopped','zombie'):raise Held('row_invalid')
    return (value['uid'],value['birth'])


class Lifetime:
    def __init__(self,root,deadline,*,limit=256,clock=time.monotonic_ns):
        token=row(root)
        if type(limit) is not int or not 1<=limit<=256 or root['state']=='zombie':raise Held('policy_invalid')
        self.root=root['pid'];self.uid=root['uid'];self.tracked={self.root:token};self.limit=limit
        self.timer=Clock(deadline,clock);self.frozen=False;self.cleanup_frame=False;self.reason=None

    def collect(self,rows,identity,*,cleanup=False):
        try:
            return self._collect(rows,identity,cleanup=cleanup)
        except Held as error:
            self.frozen=True
            args=BaseException.args.__get__(error)
            allowed=('frame_invalid','row_invalid','clock_unavailable','deadline',
                     'identity_uncertain','lifetime_bound','descendant_limit','native_unavailable')
            reason=args[0] if type(args) is tuple and len(args)==1 and type(args[0]) is str and len(args[0])<=64 and args[0] in allowed else 'identity_uncertain'
            self.reason=self.reason or reason
            raise Held(self.reason) from None
        except Exception:
            self.frozen=True;self.reason=self.reason or 'identity_uncertain'
            raise Held(self.reason) from None

    def _collect(self,rows,identity,*,cleanup=False):
        if self.reason is not None and not cleanup:raise Held(self.reason)
        self.timer.check()
        if type(cleanup) is not bool or type(rows) is not dict or len(rows)>MAX_ROWS:raise Held('frame_invalid')
        children={};tokens={}
        for pid,value in rows.items():
            self.timer.check();token=row(value)
            if type(pid) is not int or pid!=value['pid'] or value['uid']!=self.uid:raise Held('row_invalid')
            tokens[pid]=token;children.setdefault(value['parent_pid'],[]).append(pid)
        live=set();uncertain=False
        for pid,token in self.tracked.items():
            self.timer.check()
            if pid not in rows:uncertain=True;continue
            try:current=self.timer.call(identity,pid)
            except Held:uncertain=True;continue
            if current!=token or tokens[pid]!=token:uncertain=True;continue
            live.add(pid)
        queue=deque(live);visited=set();overflow=False
        allow_cleanup=cleanup and not self.cleanup_frame
        # Freeze after one cleanup frame; ordinary post-overflow collection cannot add identities.
        try:
            while queue:
                self.timer.check();pid=queue.popleft()
                if pid in visited:continue
                visited.add(pid)
                if pid not in live:
                    token=tokens[pid]
                    try:current=self.timer.call(identity,pid)
                    except Held:uncertain=True;continue
                    if current!=token or pid in self.tracked and self.tracked[pid]!=token:uncertain=True;continue
                    if pid not in self.tracked:
                        if self.frozen and not allow_cleanup:uncertain=True;continue
                        if len(self.tracked)>=self.limit:
                            overflow=True
                            if not allow_cleanup or len(self.tracked)>=self.limit+MAX_ROWS:continue
                        self.tracked[pid]=token
                    live.add(pid)
                queue.extend(children.get(pid,()))
        finally:
            if cleanup:self.cleanup_frame=True
            if cleanup or overflow or uncertain:self.frozen=True
        if uncertain:self.reason=self.reason or 'identity_uncertain';raise Held(self.reason)
        if overflow:self.reason=self.reason or 'lifetime_bound';raise Held(self.reason)
        if self.reason is not None:raise Held(self.reason)
        active={pid for pid in live if rows[pid]['state']!='zombie'}
        if active-{self.root}:self.frozen=True;self.reason=self.reason or 'descendant_limit';raise Held(self.reason)
        self.timer.check()
        return {'schema':'temperance.worker-inventory.v1','tracked_count':len(self.tracked),'live_count':len(active),
                'execution_authorized':False,'capacity_authorization':False,'resource_contained':False,
                'cleanup_verified':False,'actual_phase_role_verified':False,'pre_effect_proven':False,'replay_authorized':False}

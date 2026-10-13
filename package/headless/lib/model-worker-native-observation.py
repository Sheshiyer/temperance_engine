"""Darwin direct-process metadata only; no launch, inventory, signal or admission."""
import ctypes
import os
import sys
import time


class Held(Exception):
    pass


class BsdInfo(ctypes.Structure):
    _fields_ = [(n, ctypes.c_uint32) for n in ('flags','status','xstatus','pid','ppid','uid','gid','ruid','rgid','svuid','svgid','reserved')]
    _fields_ += [('comm',ctypes.c_char*16),('name',ctypes.c_char*32)]
    _fields_ += [(n,ctypes.c_uint32) for n in ('nfiles','pgid','pjobc','tdev','tpgid')]
    _fields_ += [('nice',ctypes.c_int32),('start_sec',ctypes.c_uint64),('start_usec',ctypes.c_uint64)]


class TaskInfo(ctypes.Structure):
    _fields_ = [(n,ctypes.c_uint64) for n in ('virtual_size','resident_size','total_user','total_system','threads_user','threads_system')]
    _fields_ += [(n,ctypes.c_int32) for n in ('policy','faults','pageins','cow_faults','messages_sent','messages_received','syscalls_mach','syscalls_unix','csw','threadnum','numrunning','priority')]


class RusageInfoV0(ctypes.Structure):
    _fields_ = [('uuid',ctypes.c_uint8*16)]
    _fields_ += [(n,ctypes.c_uint64) for n in ('user_time','system_time','pkg_idle_wkups','interrupt_wkups','pageins','wired_size','resident_size','physical','start','exit')]


def layout():
    return (ctypes.sizeof(BsdInfo),BsdInfo.start_sec.offset,BsdInfo.start_usec.offset,
            ctypes.sizeof(TaskInfo),TaskInfo.resident_size.offset,
            ctypes.sizeof(RusageInfoV0),RusageInfoV0.physical.offset,RusageInfoV0.start.offset,RusageInfoV0.exit.offset)


class Backend:
    def __init__(self, deadline_ns, *, clock=time.monotonic_ns, pidinfo=None, rusage=None, sysctl=None, platform=sys.platform):
        if type(deadline_ns) is not int or not 1<=deadline_ns<=2**63-1:
            raise Held('deadline_invalid')
        if platform != 'darwin':raise Held('platform_unsupported')
        if layout() != (136,120,128,96,8,96,72,80,88):raise Held('abi_unavailable')
        self.deadline=deadline_ns;self.clock=clock;self.last=None;self.starts={}
        self.check()
        if self.deadline-self.last>120_000_000_000:raise Held('deadline_invalid')
        missing=(pidinfo is None,rusage is None,sysctl is None)
        if any(missing) and not all(missing):raise Held('native_adapter_incomplete')
        if all(missing):
            try:
                self.check()
                proc=ctypes.CDLL('/usr/lib/libproc.dylib',use_errno=True)
                self.check()
                system=ctypes.CDLL('/usr/lib/libSystem.B.dylib',use_errno=True)
                self.check()
                proc.proc_pidinfo.argtypes=[ctypes.c_int,ctypes.c_int,ctypes.c_uint64,ctypes.c_void_p,ctypes.c_int]
                proc.proc_pidinfo.restype=ctypes.c_int
                self.check()
                proc.proc_pid_rusage.argtypes=[ctypes.c_int,ctypes.c_int,ctypes.c_void_p]
                proc.proc_pid_rusage.restype=ctypes.c_int
                self.check()
                system.sysctlbyname.argtypes=[ctypes.c_char_p,ctypes.c_void_p,ctypes.POINTER(ctypes.c_size_t),ctypes.c_void_p,ctypes.c_size_t]
                system.sysctlbyname.restype=ctypes.c_int
                self.check()
                pidinfo=proc.proc_pidinfo;rusage=proc.proc_pid_rusage;sysctl=system.sysctlbyname
                self.check()
            except Held:
                raise
            except Exception:
                raise Held('native_unavailable') from None
        self.pidinfo,self.rusage,self.sysctl=pidinfo,rusage,sysctl
        self.check()

    def check(self):
        try:now=self.clock()
        except Exception:raise Held('clock_unavailable') from None
        if type(now) is not int or not 0<=now<=2**63-1 or self.last is not None and now < self.last:raise Held('clock_unavailable')
        self.last=now
        if now>=self.deadline:raise Held('deadline')

    def call(self, fn, *args):
        self.check()
        try:value=fn(*args)
        except Exception:raise Held('native_unavailable') from None
        self.check()
        return value

    def identity(self, pid, uid):
        if type(pid) is not int or not 2<=pid<=2**31-1 or type(uid) is not int or not 0<=uid<=2**32-1:raise Held('identity_invalid')
        info=BsdInfo();result=self.call(self.pidinfo,pid,3,0,ctypes.byref(info),ctypes.sizeof(info))
        if type(result) is not int or result!=136 or info.pid!=pid or info.uid!=uid or info.start_sec==0 or info.start_usec>=1_000_000 or info.status not in (2,3,4):raise Held('identity_unavailable')
        return {'pid':pid,'uid':uid,'birth':f'darwin:{info.start_sec}:{info.start_usec}','parent_pid':int(info.ppid),'state':'stopped' if info.status==4 else 'live'}

    def sample(self, expected):
        if type(expected) is not dict or set(expected)!= {'pid','uid','birth','parent_pid','state'}:raise Held('identity_invalid')
        # Trusted retained scalar DTO, compare all fields without updating expected.
        expected=dict(expected)
        for retained in self.starts:
            if retained[0]==expected['pid'] and retained!=(expected['pid'],expected['uid'],expected['birth']):raise Held('birth_changed')
        before=self.identity(expected['pid'],expected['uid'])
        if before!=expected:raise Held('birth_changed')
        task=TaskInfo();result=self.call(self.pidinfo,expected['pid'],4,0,ctypes.byref(task),ctypes.sizeof(task))
        if type(result) is not int or result!=96:raise Held('usage_unavailable')
        info=RusageInfoV0();result=self.call(self.rusage,expected['pid'],0,ctypes.byref(info))
        if type(result) is not int or result!=0 or info.start==0 or info.exit!=0:raise Held('usage_unavailable')
        after=self.identity(expected['pid'],expected['uid'])
        if after!=expected:raise Held('birth_changed')
        key=(expected['pid'],expected['uid'],expected['birth'])
        if key in self.starts and self.starts[key]!=info.start:raise Held('birth_changed')
        if key not in self.starts and len(self.starts)>=2:raise Held('target_bound')
        self.starts[key]=int(info.start)
        return {'backend':'darwin-proc-pid-rusage-v0','native_result':0,'rss_bytes':int(task.resident_size),'physical_bytes':int(info.physical),'kernel_start':int(info.start),'kernel_exit':0}

    def pressure(self):
        level=ctypes.c_int();size=ctypes.c_size_t(ctypes.sizeof(level))
        result=self.call(self.sysctl,b'kern.memorystatus_vm_pressure_level',ctypes.byref(level),ctypes.byref(size),None,0)
        if type(result) is not int or result!=0 or size.value!=ctypes.sizeof(level):return 'host_pressure_unavailable'
        return 'normal' if level.value==1 else 'host_pressure_elevated' if level.value in (2,4) else 'host_pressure_unavailable'


def metadata_receipt(status):
    if status not in ('normal','host_pressure_elevated','host_pressure_unavailable'):status='host_pressure_unavailable'
    return {'schema':'temperance.worker-native-metadata.v1','host_pressure':status,
            'scope':'direct process metadata only','execution_authorized':False,'capacity_authorization':False,
            'resource_contained':False,'cleanup_verified':False,'actual_phase_role_verified':False,
            'inference_verified':False,'pre_effect_proven':False,'replay_authorized':False}

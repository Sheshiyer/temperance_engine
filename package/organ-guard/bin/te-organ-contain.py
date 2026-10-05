#!/usr/bin/env python3
"""Bound fixed trusted organ scripts without logging argv or environments.

This monitors observed ancestry, including changes of process group. It is not
hostile-code isolation: double forks that reparent between samples can escape
on Darwin, where NOTE_TRACK is unsupported. Callers must not admit arbitrary
LLM tools or scripts that deliberately daemonize using this observer.
"""
import argparse
import ctypes
from collections import deque
import datetime
import errno
import hashlib
import json
import os
import signal
import stat
import subprocess
import sys
import time
from pathlib import Path

LIMIT_WALL = 120.0
LIMIT_RSS = 163840
LIMIT_CHILDREN = 24
ORGAN_IDS = {"auspex", "circulator", "nutrix", "praeceptor", "self-heal", "vestibule", "adytum"}
INTERVAL = 0.05
GRACE = 0.25
# 2026-09-30: 0.2s was too tight on a loaded host (load avg 20 on 10 cores, ~1,100 processes):
# completed organs were marked monitor_failed/snapshot_timeout ~25% of runs. Default 1.0s,
# bounded [0.2, 2.0] via TE_ORGAN_SNAPSHOT_TIMEOUT; a timeout still fails closed.
# Wall/RSS/descendant limits are unchanged.
def _snapshot_timeout():
    try:
        return min(2.0, max(0.2, float(os.environ.get("TE_ORGAN_SNAPSHOT_TIMEOUT", "1.0"))))
    except ValueError:
        return 1.0


SNAPSHOT_TIMEOUT = _snapshot_timeout()


# 2026-10-02 (261002-p0l): scheduled runs failed at failure_operation=bootstrap_admission
# after ~610ms: the fixed 0.5s window for the fresh interpreter to SIGSTOP itself before
# exec expired under launchd load; libproc snapshots had already succeeded. An unmonitored
# fallback would exec an unregistered root and defeat stop-before-exec birth admission, so
# the window is widened (default 2.0s, bounded [0.5, 5.0] via TE_ORGAN_BOOTSTRAP_SECONDS,
# never past the wall deadline). Expiry still fails closed, now with a finite code.
def _bootstrap_timeout():
    try:
        return min(5.0, max(0.5, float(os.environ.get("TE_ORGAN_BOOTSTRAP_SECONDS", "2.0"))))
    except ValueError:
        return 2.0


BOOTSTRAP_TIMEOUT = _bootstrap_timeout()


class BootstrapTimeout(RuntimeError):
    pass
MAX_SNAPSHOT_PIDS = 4096
MAX_LIFETIME_IDENTITIES = 4096


class CollectorError(RuntimeError):
    pass


def collector_deadline(deadline):
    if deadline is not None and time.monotonic() >= deadline:
        raise CollectorError("collector_deadline")


class LifetimeCollector:
    """Trusted metadata only; no pruning or replacement of signal identities.

    Lifetime admission is 4096 including root. One overflow/first-cleanup frame
    may retain at most 4096 additional proven births (combined at most 8192),
    then admission stays frozen. Footprint history only uses admitted births.
    Linux snapshot capture allocation remains outside this received-frame bound.
    """
    def __init__(self, root_pid, birth):
        self.root_pid = root_pid
        self.tracked = {root_pid: birth}
        self.admitted = 1
        self.frozen = False

    def collect(self, rows, deadline, cleanup=False):
        collector_deadline(deadline)
        if not isinstance(rows, dict) or len(rows) > MAX_SNAPSHOT_PIDS:
            raise CollectorError("collector_frame_limit")
        live = set()
        seed_uncertain = False
        for pid, born in self.tracked.items():
            collector_deadline(deadline)
            if pid in rows:
                current = identity(pid)
                collector_deadline(deadline)
                if current == born and rows[pid].get("birth", born) == born:
                    live.add(pid)
                elif current is None and not rows[pid]["zombie"] and rows[pid].get("birth", born) == born:
                    seed_uncertain = True
            collector_deadline(deadline)
        children = {}
        group = []
        for pid, row in rows.items():
            collector_deadline(deadline)
            if pid <= 1 or pid == os.getpid():
                continue
            children.setdefault(row["ppid"], []).append(pid)
            if row["pgid"] == self.root_pid:
                group.append(pid)
        queue = deque(live)
        if live:
            queue.extend(group)
        visited = set()
        overflow = False
        uncertain = seed_uncertain
        try:
            while queue:
                collector_deadline(deadline)
                pid = queue.popleft()
                if pid in visited:
                    continue
                visited.add(pid)
                if pid not in live:
                    row = rows[pid]
                    born = identity(pid)
                    collector_deadline(deadline)
                    if born is None or row.get("birth", born) != born:
                        uncertain = True
                        continue
                    if pid in self.tracked and self.tracked[pid] != born:
                        uncertain = True  # Never overwrite a prior signal token.
                        continue
                    if pid not in self.tracked:
                        if self.frozen:
                            uncertain = True
                            continue
                        if not cleanup:
                            if self.admitted >= MAX_LIFETIME_IDENTITIES:
                                overflow = True
                            else:
                                self.admitted += 1
                        self.tracked[pid] = born
                    live.add(pid)
                queue.extend(children.get(pid, ()))
        finally:
            if overflow or uncertain or cleanup:
                self.frozen = True
        if overflow:
            raise CollectorError("collector_lifetime_limit")
        if uncertain:
            raise CollectorError("collector_identity_uncertain")
        collector_deadline(deadline)
        live = {pid for pid in live if not rows[pid]["zombie"]}
        rss = 0
        for pid in live:
            collector_deadline(deadline)
            rss += rows[pid]["rss"]
        return live, rss, len(live - {self.root_pid})


class BsdInfo(ctypes.Structure):
    _fields_ = [(n, ctypes.c_uint32) for n in (
        "flags", "status", "xstatus", "pid", "ppid", "uid", "gid",
        "ruid", "rgid", "svuid", "svgid", "reserved")]
    _fields_ += [("comm", ctypes.c_char * 16), ("name", ctypes.c_char * 32)]
    _fields_ += [(n, ctypes.c_uint32) for n in (
        "nfiles", "pgid", "pjobc", "tdev", "tpgid", "nice")]
    _fields_ += [("start_sec", ctypes.c_uint64), ("start_usec", ctypes.c_uint64)]


class TaskInfo(ctypes.Structure):
    _fields_ = [(name, ctypes.c_uint64) for name in (
        "virtual_size", "resident_size", "total_user", "total_system", "threads_user", "threads_system")]
    _fields_ += [(name, ctypes.c_int32) for name in (
        "policy", "faults", "pageins", "cow_faults", "messages_sent", "messages_received",
        "syscalls_mach", "syscalls_unix", "csw", "threadnum", "numrunning", "priority")]


class RusageInfoV0(ctypes.Structure):
    # Fixed Darwin SDK RUSAGE_INFO_V0; avoid the larger changing current flavor.
    _fields_ = [("ri_uuid", ctypes.c_uint8 * 16)]
    _fields_ += [(name, ctypes.c_uint64) for name in (
        "ri_user_time", "ri_system_time", "ri_pkg_idle_wkups", "ri_interrupt_wkups",
        "ri_pageins", "ri_wired_size", "ri_resident_size", "ri_phys_footprint",
        "ri_proc_start_abstime", "ri_proc_exit_abstime")]


class PhysicalFootprintError(RuntimeError):
    def __init__(self, code):
        allowed = ("physical_footprint_unavailable", "physical_footprint_birth_changed", "physical_footprint_timeout")
        self.code = code if type(code) is str and code in allowed else "physical_footprint_unavailable"
        super().__init__(self.code)  # Finite code only; no native payload or PID.


class TaskAllInfo(ctypes.Structure):
    _fields_ = [("bsd", BsdInfo), ("task", TaskInfo)]


LIBPROC = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True) if sys.platform == "darwin" else None
if LIBPROC:
    LIBPROC.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
    LIBPROC.proc_pidinfo.restype = ctypes.c_int
    LIBPROC.proc_listpids.argtypes = [ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_int]
    LIBPROC.proc_listpids.restype = ctypes.c_int
    # SDK rusage_info_t* is the address of the raw structure storage, not an
    # allocated pointer-to-pointer. Unlike pidinfo, success returns 0, not bytes.
    LIBPROC.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
    LIBPROC.proc_pid_rusage.restype = ctypes.c_int

# Aggregate host admission complements the sealed per-tree caps. Linux's 10%
# available threshold is a conservative source policy, not a validated canary.
LIBSYSTEM = ctypes.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True) if sys.platform == "darwin" else None
if LIBSYSTEM:
    LIBSYSTEM.sysctlbyname.argtypes = [ctypes.c_char_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_size_t), ctypes.c_void_p, ctypes.c_size_t]
    LIBSYSTEM.sysctlbyname.restype = ctypes.c_int


def host_pressure():
    """Finite metadata only; missing/unknown observers never admit a child."""
    try:
        if sys.platform == "darwin" and LIBSYSTEM is not None:
            started = time.monotonic()
            level = ctypes.c_int32()
            size = ctypes.c_size_t(ctypes.sizeof(level))
            result = LIBSYSTEM.sysctlbyname(b"kern.memorystatus_vm_pressure_level", ctypes.byref(level), ctypes.byref(size), None, 0)
            if time.monotonic() - started >= SNAPSHOT_TIMEOUT or result != 0 or size.value != ctypes.sizeof(level):
                return "host_pressure_unavailable"
            if level.value == 1:
                return "normal"
            return "host_pressure_elevated" if level.value in (2, 4) else "host_pressure_unavailable"
        if sys.platform == "linux":
            with open("/proc/meminfo", "rb") as source:
                raw = source.read(16385)
            if len(raw) > 16384:
                return "host_pressure_unavailable"
            values = {}
            for line in raw.decode("ascii").splitlines():
                fields = line.split()
                if fields and fields[0] in ("MemTotal:", "MemAvailable:"):
                    if fields[0] in values or len(fields) != 3 or fields[2] != "kB" or not fields[1].isdigit():
                        return "host_pressure_unavailable"
                    values[fields[0]] = int(fields[1])
            total, available = values.get("MemTotal:", 0), values.get("MemAvailable:", -1)
            if total <= 0 or not 0 <= available <= total:
                return "host_pressure_unavailable"
            return "normal" if available * 10 >= total else "host_pressure_elevated"
    except (OSError, ValueError, UnicodeError):
        pass
    return "host_pressure_unavailable"


def pressure_status(observer):
    # This callback is a trusted in-process test seam, never packet/argv/env data.
    try:
        result = observer()
        if type(result) is str and result in ("normal", "host_pressure_elevated", "host_pressure_unavailable"):
            return result
    except Exception:
        pass
    return "host_pressure_unavailable"


def identity(pid):
    """Do not let a stale tracked PID authorize signaling a reused process."""
    try:
        if LIBPROC:
            info = BsdInfo()
            size = LIBPROC.proc_pidinfo(pid, 3, 0, ctypes.byref(info), ctypes.sizeof(info))
            if size != ctypes.sizeof(info) or info.pid != pid or info.uid != os.getuid():
                return None
            return (info.start_sec, info.start_usec)
        if sys.platform == "linux":
            stat = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
            if Path(f"/proc/{pid}").stat().st_uid != os.getuid():
                return None
            return (int(stat[19]),)
    except (FileNotFoundError, ProcessLookupError, PermissionError):
        return None
    raise RuntimeError("process birth identity unavailable")


def darwin_tree_footprint(live, tracked, deadline, starts):
    """Eligible tree only, at most 25 native queries. Never used by cleanup.

    BSD identity sandwiches each syscall. Kernel absolute start time is an
    additional correlation value, never compared to BSD wall-clock seconds.
    Missing/disappeared/reused identities and all native errors hold.
    """
    def check_deadline():
        if time.monotonic() >= deadline:
            raise PhysicalFootprintError("physical_footprint_timeout")

    if sys.platform != "darwin" or LIBPROC is None or (
        ctypes.sizeof(RusageInfoV0), RusageInfoV0.ri_phys_footprint.offset,
        RusageInfoV0.ri_proc_start_abstime.offset, RusageInfoV0.ri_proc_exit_abstime.offset
    ) != (96, 72, 80, 88):
        raise PhysicalFootprintError("physical_footprint_unavailable")
    if len(live) > LIMIT_CHILDREN + 1 or any(type(pid) is not int or pid <= 1 or pid == os.getpid() or pid not in tracked for pid in live):
        raise PhysicalFootprintError("physical_footprint_unavailable")
    total = 0
    for pid in sorted(live):
        try:
            check_deadline()
            before = identity(pid)
            check_deadline()
            if before is None or before != tracked[pid]:
                raise PhysicalFootprintError("physical_footprint_birth_changed")
            info = RusageInfoV0()
            ctypes.set_errno(0)
            check_deadline()
            result = LIBPROC.proc_pid_rusage(pid, 0, ctypes.byref(info))
            check_deadline()
            if type(result) is not int or result != 0 or info.ri_proc_start_abstime == 0 or info.ri_proc_exit_abstime != 0:
                raise PhysicalFootprintError("physical_footprint_unavailable")
            after = identity(pid)
            check_deadline()
            if after != before:
                raise PhysicalFootprintError("physical_footprint_birth_changed")
            observed_start = (before, int(info.ri_proc_start_abstime))
            if pid in starts and starts[pid] != observed_start:
                raise PhysicalFootprintError("physical_footprint_birth_changed")
            starts[pid] = observed_start
            total += (int(info.ri_phys_footprint) + 1023) // 1024
        except PhysicalFootprintError:
            raise
        except (OSError, ValueError, RuntimeError, AttributeError, ctypes.ArgumentError):
            raise PhysicalFootprintError("physical_footprint_unavailable") from None
    return total


def signal_tracked(pids, tracked, sig, root_pid, deadline=None):
    """Revalidate each birth immediately before signaling, with the root last."""
    for pid in sorted(pids, key=lambda p: p == root_pid):
        collector_deadline(deadline)
        born = tracked.get(pid)
        if born is not None and pid > 1 and pid != os.getpid():
            try:
                current = identity(pid)
                collector_deadline(deadline)
                if current != born:
                    continue
            except CollectorError:
                raise
            except (OSError, ValueError, RuntimeError):
                # Unknown identity never authorizes a signal. A failed query
                # must not stop cleanup of the other independently proven PIDs.
                continue
            try:
                os.kill(pid, sig)
            except OSError:
                # Vanished/denied signals leave cleanup unverified; later
                # observations, not a successful syscall assumption, prove it.
                pass
            collector_deadline(deadline)


def darwin_snapshot(deadline=None):
    """UID-scoped metadata only; no argv/environment or sampling subprocess.

    Darwin SDK: PROC_UID_ONLY=4, PROC_PIDTASKALLINFO=2, SZOMB=5.
    Native calls are synchronous; the unchanged deadline is checked around each
    call. This is observed-lineage monitoring, not hard kernel isolation.
    """
    if LIBPROC is None or (ctypes.sizeof(BsdInfo), ctypes.sizeof(TaskInfo), ctypes.sizeof(TaskAllInfo)) != (136, 96, 232):
        raise RuntimeError("native snapshot ABI unavailable")
    deadline = min(time.monotonic() + SNAPSHOT_TIMEOUT, deadline) if deadline is not None else time.monotonic() + SNAPSHOT_TIMEOUT

    def check_deadline():
        if time.monotonic() >= deadline:
            raise subprocess.TimeoutExpired("native-metadata-snapshot", SNAPSHOT_TIMEOUT)

    uid = os.getuid()
    pids = (ctypes.c_int * (MAX_SNAPSHOT_PIDS + 1))()
    check_deadline()
    ctypes.set_errno(0)
    count_bytes = LIBPROC.proc_listpids(4, uid, pids, ctypes.sizeof(pids))
    check_deadline()
    if count_bytes <= 0 or count_bytes % ctypes.sizeof(ctypes.c_int) or count_bytes > MAX_SNAPSHOT_PIDS * ctypes.sizeof(ctypes.c_int):
        raise RuntimeError("native snapshot enumeration incomplete")
    selected = list(pids[:count_bytes // ctypes.sizeof(ctypes.c_int)])
    if any(pid <= 0 for pid in selected) or len(set(selected)) != len(selected):
        raise RuntimeError("native snapshot enumeration malformed")
    rows = {}
    for pid in selected:
        check_deadline()
        info = TaskAllInfo()
        ctypes.set_errno(0)
        size = LIBPROC.proc_pidinfo(pid, 2, 0, ctypes.byref(info), ctypes.sizeof(info))
        error = ctypes.get_errno()
        check_deadline()
        if size == 0 and error == errno.ESRCH:
            continue  # The exact enumerated process disappeared. Nothing else is skipped.
        if size == ctypes.sizeof(BsdInfo):
            # Some Darwin zombie exits expose only BSD metadata. Admit only an
            # independently reread same-birth zombie, never a short live record.
            zombie = BsdInfo()
            ctypes.set_errno(0)
            verified = LIBPROC.proc_pidinfo(pid, 3, 0, ctypes.byref(zombie), ctypes.sizeof(zombie))
            error = ctypes.get_errno()
            check_deadline()
            if verified == 0 and error == errno.ESRCH:
                continue
            if verified != ctypes.sizeof(zombie) or zombie.status != 5 or (zombie.start_sec, zombie.start_usec) != (info.bsd.start_sec, info.bsd.start_usec):
                raise RuntimeError("native snapshot zombie unverified")
            info.bsd = zombie
            info.task.resident_size = 0
        elif size != ctypes.sizeof(info):
            raise RuntimeError("native snapshot metadata incomplete")
        bsd = info.bsd
        if bsd.pid != pid or bsd.uid != uid or bsd.status not in (1, 2, 3, 4, 5) or bsd.start_sec == 0 or bsd.start_usec >= 1_000_000:
            raise RuntimeError("native snapshot metadata mismatch")
        rows[pid] = {"ppid": bsd.ppid, "pgid": bsd.pgid,
                     "rss": (info.task.resident_size + 1023) // 1024,
                     "zombie": bsd.status == 5,
                     "birth": (bsd.start_sec, bsd.start_usec)}
    check_deadline()
    if os.getpid() not in rows or rows[os.getpid()]["zombie"]:
        raise RuntimeError("native snapshot monitor missing")
    return rows


def snapshot(deadline=None):
    collector_deadline(deadline)
    if sys.platform == "darwin":
        return darwin_snapshot(deadline)
    # Metadata only. Never inspect process argv, environments, prompts or tokens.
    result = subprocess.run(["/bin/ps", "-axo", "pid=,ppid=,pgid=,rss=,stat="],
                            capture_output=True, text=True, timeout=min(SNAPSHOT_TIMEOUT, max(0.001, deadline - time.monotonic())) if deadline is not None else SNAPSHOT_TIMEOUT, check=True)
    collector_deadline(deadline)
    rows = {}
    for line in result.stdout.splitlines():
        collector_deadline(deadline)
        fields = line.split()
        if len(fields) == 5:
            pid, ppid, pgid, rss = map(int, fields[:4])
            rows[pid] = {"ppid": ppid, "pgid": pgid, "rss": rss, "zombie": fields[4].startswith("Z")}
    collector_deadline(deadline)
    return rows


def append(path, value):
    # Correlation only: these fields grant no admission or acceptance authority.
    delivery = os.environ.get("TE_ORGAN_DELIVERY_ID", "")
    event_ref = os.environ.get("TE_ORGAN_SOURCE_EVENT_REF", "")
    if len(delivery) == 32 and all(char in "0123456789abcdef" for char in delivery):
        value["delivery_id"] = delivery
    if event_ref.startswith("sha256:") and len(event_ref) == 71 and all(char in "0123456789abcdef" for char in event_ref[7:]):
        value["source_event_ref"] = event_ref
    value["ts"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    data = (json.dumps(value, separators=(",", ":")) + "\n").encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        if os.write(fd, data) != len(data):
            raise OSError("short receipt write")
    finally:
        os.close(fd)


def bounded_setting(name, default, maximum, minimum, integer=False):
    value = float(os.environ.get(name, default))
    if not minimum <= value <= maximum or (integer and value != int(value)):
        raise ValueError(f"invalid {name}; cannot exceed production ceiling")
    return int(value) if integer else value


MAX_DESCRIPTOR_BYTES = 16 * 1024


def descriptor_bytes(path):
    """Fixed-owner read boundary; syscall time/ancestor authentication unproved."""
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= MAX_DESCRIPTOR_BYTES:
            raise ValueError("descriptor_bounds")
        raw = bytearray()
        while len(raw) < before.st_size:
            chunk = os.pread(fd, min(4096, before.st_size - len(raw)), len(raw))
            if not chunk:
                raise ValueError("descriptor_short_read")
            raw.extend(chunk)
        if os.pread(fd, 1, before.st_size):
            raise ValueError("descriptor_growth")
        after, current = os.fstat(fd), os.lstat(path)
        fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns", "st_mode")
        if not stat.S_ISREG(current.st_mode) or any(
            getattr(before, key) != getattr(after, key) or getattr(before, key) != getattr(current, key)
            for key in fields
        ):
            raise ValueError("descriptor_drift")
        return bytes(raw)
    finally:
        os.close(fd)  # A failed close invalidates the read, including a return.


def descriptor_pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError("descriptor_duplicate_key")
        result[key] = value
    return result


def organ_process_allowance(organ):
    # The sealed descriptor owns the differentiated shell-process allowance.
    # Missing/drifted policy cannot fall back to a broader generic budget.
    path = Path(__file__).resolve().parent.parent / "router/module-descriptors/organs.json"
    raw = descriptor_bytes(path)
    descriptor = json.loads(raw.decode("utf-8", "strict"), object_pairs_hook=descriptor_pairs)
    if (not isinstance(descriptor, dict) or descriptor.get("schema") != "temperance.module-descriptor.v1" or
            descriptor.get("id") != "organ.runtime"):
        raise ValueError("invalid organ descriptor identity")
    resource = descriptor.get("resource", {})
    if not isinstance(resource, dict):
        raise ValueError("invalid organ resource budget")
    policy = resource.get("organ_process_allowance", {})
    if not isinstance(policy, dict):
        raise ValueError("invalid organ process allowance")
    budgets = policy.get("per_organ_max_child_processes", {})
    if (policy.get("schema") != "temperance.organ-process-allowance.v1" or
            not isinstance(budgets, dict) or set(budgets) != ORGAN_IDS or organ not in budgets or
            any(type(value) is not int or not 1 <= value <= LIMIT_CHILDREN for value in budgets.values()) or
            resource.get("max_child_processes") != max(budgets.values()) or
            resource.get("max_tree_rss_mb") != LIMIT_RSS // 1024 or
            resource.get("max_wall_ms") != LIMIT_WALL * 1000):
        raise ValueError("invalid organ process allowance")
    return budgets[organ], {
        "schema": policy["schema"], "descriptor_sha256": hashlib.sha256(raw).hexdigest(),
        "default_descendants": budgets[organ], "module_max_descendants": resource["max_child_processes"],
        "basis": policy.get("basis", "trusted deterministic shell pipelines only"),
    }


def monitor_failure_code(operation, error):
    """Finite diagnostic codes; never serialize exception messages or payloads."""
    if isinstance(error, CollectorError):
        return error.args[0] if error.args and error.args[0] in ("collector_deadline", "collector_frame_limit", "collector_lifetime_limit", "collector_identity_uncertain") else "collector_failed"
    if operation == "physical_footprint":
        return error.code if isinstance(error, PhysicalFootprintError) else "physical_footprint_unavailable"
    if operation == "snapshot":
        return "snapshot_timeout" if isinstance(error, subprocess.TimeoutExpired) else "snapshot_failed"
    if operation in ("self_identity", "root_identity", "process_identity"):
        return "identity_unavailable"
    if operation == "bootstrap_admission" and isinstance(error, BootstrapTimeout):
        return "bootstrap_timeout"
    return "monitor_operation_failed"


def monitor(args, *, pressure_observer=None):
    pressure_observer = host_pressure if pressure_observer is None else pressure_observer
    base = {"schema": "organ.process.v1", "run_id": args.run_id, "organ": args.organ,
            "invocation_mode": args.invocation_mode, "dry_run": args.invocation_mode == "dry-run",
            "snapshot_backend": "darwin-libproc" if sys.platform == "darwin" else "ps",
            "containment": "observed-lineage", "limitation": "unobserved reparenting between samples is not isolated",
            "semantic_acceptance": False, "provider_authorization": "not_evaluated",
            "rss_scope": "owning process and observed descendants; monitor excluded",
            "monitored": False}
    started = time.monotonic()
    child = None
    tracked = {}
    cleanup_deadline = None
    reason = "completed"
    code = 0
    peak_rss = peak_children = 0
    footprint_starts = {}
    base["physical_footprint"] = {
        "schema": "temperance.organ-physical-footprint.v1",
        "status": "not-observed" if sys.platform == "darwin" else "unsupported",
        "backend": "darwin-proc-pid-rusage-v0" if sys.platform == "darwin" else "unsupported-platform",
        "cap_kib": None, "peak_kib": None, "sampled_processes": None,
        "scope": "owning process and birth-validated live descendants; monitor excluded"}

    cleanup_complete = False
    interrupted = []
    rows = {}
    # Fixed control-flow labels describe the failing call, not elapsed-time
    # guesses. Freeze them before emergency cleanup can change the operation.
    stage, operation = "configuration", "process_allowance"
    try:
        default_children, allowance = organ_process_allowance(args.organ)
        base["process_allowance"] = allowance
        operation = "limits"
        wall = bounded_setting("TE_ORGAN_WALL_SECONDS", args.wall, min(args.wall, LIMIT_WALL), 0.8)
        rss_limit = bounded_setting("TE_ORGAN_RSS_KIB", LIMIT_RSS, LIMIT_RSS, 1, True)
        child_limit = bounded_setting("TE_ORGAN_MAX_DESCENDANTS", default_children, default_children, 0, True)
        base["limits"] = {"wall_seconds": wall, "rss_kib": rss_limit, "descendants": child_limit}
        # No new environment/CLI bypass or raised ceiling. The downward RSS
        # setting also constrains the independent physical-footprint ceiling.
        if sys.platform == "darwin":
            base["physical_footprint"]["cap_kib"] = min(rss_limit, LIMIT_RSS)
        deadline = started + wall
        stage, operation = "startup", "self_identity"
        collector_deadline(deadline - 2 * GRACE)
        if sys.platform not in ("darwin", "linux") or identity(os.getpid()) is None:
            raise RuntimeError("process identity backend unavailable")
        operation = "snapshot"
        snapshot(min(time.monotonic() + SNAPSHOT_TIMEOUT, deadline - 2 * GRACE))  # Admission shares remaining wall.
        operation = "signal_handlers"
        # Catchable cancellation must reach lineage cleanup, including QUIT.
        # SIGKILL/host death cannot be handled by this userspace observer.
        for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP, signal.SIGQUIT):
            signal.signal(sig, lambda signum, _frame: interrupted.append(signum))
        # Register birth identity while the new session is stopped before exec.
        operation = "host_pressure"
        pressure = pressure_status(pressure_observer)
        base["host_pressure"] = {"schema": "temperance.host-pressure.v1", "status": pressure,
                                 "basis": "darwin normal level 1; linux MemAvailable >= 10% MemTotal"}
        if pressure != "normal":
            reason = pressure
            raise RuntimeError("host admission held")
        operation = "child_spawn"
        collector_deadline(deadline - 2 * GRACE)
        child = subprocess.Popen([sys.executable, __file__, "_child", *args.command], start_new_session=True)
        operation = "root_identity"
        birth = identity(child.pid)
        if birth is None:
            raise RuntimeError("root identity unavailable")
        collector = LifetimeCollector(child.pid, birth)
        tracked = collector.tracked
        bootstrap_deadline = min(time.monotonic() + BOOTSTRAP_TIMEOUT, deadline - 2 * GRACE)
        base["bootstrap_seconds"] = BOOTSTRAP_TIMEOUT
        while True:
            operation = "bootstrap_wait"
            observed, stopped = os.waitpid(child.pid, os.WUNTRACED | os.WNOHANG)
            if observed:
                operation = "bootstrap_stop"
                if not os.WIFSTOPPED(stopped):
                    raise RuntimeError("bootstrap did not stop before exec")
                break
            operation = "bootstrap_admission"
            if interrupted or time.monotonic() >= bootstrap_deadline:
                raise BootstrapTimeout("bootstrap admission deadline")
            operation = "wait"
            time.sleep(0.01)
        root_group = child.pid
        operation = "host_pressure"
        pressure = pressure_status(pressure_observer)
        base["host_pressure"]["status"] = pressure
        if pressure != "normal":
            reason = pressure
            raise RuntimeError("host admission held")
        operation = "child_resume"
        os.kill(child.pid, signal.SIGCONT)
        # Only an admitted, birth-registered root under observation is monitored.
        base["monitored"] = True

        def observe():
            nonlocal rows, peak_rss, peak_children, operation
            observation_deadline = cleanup_deadline if cleanup_deadline is not None else deadline - 2 * GRACE
            frame_deadline = min(time.monotonic() + SNAPSHOT_TIMEOUT, observation_deadline)
            operation = "snapshot"
            rows = snapshot(frame_deadline)
            operation = "process_identity"
            live, rss, descendants = collector.collect(rows, frame_deadline, cleanup=cleanup_deadline is not None)
            operation = "tree_accounting"
            peak_rss = max(peak_rss, rss)
            peak_children = max(peak_children, descendants)
            return live, rss, descendants

        def signal_known(pids, sig):
            nonlocal operation
            operation = "birth_validated_signal"
            signal_tracked(pids, tracked, sig, child.pid, cleanup_deadline)

        stage = "monitor"
        while True:
            observation_started = time.monotonic()
            live, rss, descendants = observe()
            operation = "host_pressure"
            pressure = pressure_status(pressure_observer)
            base["host_pressure"]["status"] = pressure
            operation = "monitor_checks"
            now = time.monotonic()
            if pressure != "normal":
                reason, code = pressure, 125
            elif interrupted:
                reason, code = "interrupted", 128 + interrupted[0]
            elif rss > rss_limit:
                reason, code = "rss_limit", 125
            elif descendants > child_limit:
                reason, code = "descendant_limit", 125
            elif any(rows[pid]["pgid"] != root_group for pid in live):
                reason, code = "detached_descendant", 125
            elif now >= deadline - 2 * GRACE:
                reason, code = "wall_limit", 124
            elif child.poll() is not None:
                code = child.returncode if child.returncode >= 0 else 128 - child.returncode
                reason = "completed" if code == 0 else "owning_script_failed"
                if live:
                    reason, code = "orphaned_descendants", 125
                else:
                    cleanup_complete = True
                    break
            else:
                # Only an eligible tree reaches this extra metadata boundary.
                # Cleanup reuses observe(), which never requires footprint.
                if sys.platform == "darwin":
                    operation = "physical_footprint"
                    footprint = darwin_tree_footprint(live, tracked,
                        min(observation_started + SNAPSHOT_TIMEOUT, deadline - 2 * GRACE), footprint_starts)
                    accounting = base["physical_footprint"]
                    accounting.update(status="observed", sampled_processes=len(live),
                        peak_kib=max(accounting["peak_kib"] or 0, footprint))
                    if footprint > accounting["cap_kib"]:
                        reason, code = "physical_footprint_limit", 125
                    else:
                        operation = "wait"
                        time.sleep(INTERVAL)
                        continue
                else:
                    operation = "wait"
                    time.sleep(INTERVAL)
                    continue

            # TERM/KILL have independent deadlines. Never wait unboundedly for
            # a TERM-ignoring root. Freeze first to curb teardown forks.
            stage = "cleanup"
            cleanup_deadline = min(time.monotonic() + 2 * GRACE, deadline)
            signal_known(live, signal.SIGSTOP)
            live, _, _ = observe()
            signal_known(live, signal.SIGTERM)
            signal_known(live, signal.SIGCONT)
            kill_at = min(time.monotonic() + GRACE, deadline - GRACE)
            finish_at = min(kill_at + GRACE, deadline)
            while time.monotonic() < finish_at:
                live, _, _ = observe()
                if not live:
                    cleanup_complete = True
                    break
                if time.monotonic() >= kill_at:
                    signal_known(live, signal.SIGKILL)
                operation = "wait"
                time.sleep(0.02)
            live, _, _ = observe()
            signal_known(live, signal.SIGKILL)
            cleanup_complete = not live
            try:
                operation = "child_wait"
                child.wait(timeout=0.1)
            except subprocess.TimeoutExpired:
                cleanup_complete = False
            if not cleanup_complete:
                live, _, _ = observe()
                cleanup_complete = not live
            break
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as exc:
        base.update(failure_stage=stage, failure_operation=operation,
                    failure_code=reason if operation == "host_pressure" and reason in ("host_pressure_elevated", "host_pressure_unavailable") else monitor_failure_code(operation, exc),
                    prior_reason=reason, error_type=type(exc).__name__,
                    monitored=False, monitored_reason=f"{stage}:{operation}")
        if isinstance(exc, OSError) and exc.errno:
            base["failure_errno"] = errno.errorcode.get(exc.errno, "unknown")
        if isinstance(exc, PhysicalFootprintError):
            base["physical_footprint"]["status"] = "unavailable"
            reason, code = exc.code, 125
        else:
            reason, code = (reason if operation == "host_pressure" else "monitor_failed"), 125
        # Failed observation cannot grant admission. Signal only proven births.
        # A fresh finite emergency reserve is created once, never per PID/frame.
        emergency_deadline = cleanup_deadline if cleanup_deadline is not None else time.monotonic() + 2 * GRACE
        try:
            signal_tracked(tracked, tracked, signal.SIGKILL, child.pid if child else None, emergency_deadline)
        except CollectorError:
            pass
        if child is not None:
            # Popen still owns its unreaped direct child if birth registration
            # failed; Popen.kill checks that it has not already been reaped.
            try:
                child.kill()
            except OSError:
                pass  # Exact direct-child fallback failure remains unverified.
            try:
                child.wait(timeout=0.2)
            except (OSError, subprocess.TimeoutExpired):
                pass
        cleanup_complete = child is None and not tracked
        # A direct-child wait cannot establish the state of all descendants
        # after observation failed. Preserve the existing conservative boolean.
        base["cleanup_outcome"] = "not_required" if cleanup_complete else "attempted_unverified"
    base.update(status="completed" if code == 0 else "failed", exit_code=code, reason=reason,
                peak_rss_kib=peak_rss, peak_descendants=peak_children,
                elapsed_ms=round((time.monotonic() - started) * 1000), cleanup_complete=cleanup_complete)
    append(args.receipt, base)
    return code


def main():
    if sys.argv[1:2] == ["_child"]:
        # Lets fixed launchers keep helpers inside the observed group instead
        # of starting sessions this monitor must reject. Grants no authority.
        os.environ["TE_ORGAN_CONTAINED_PGID"] = str(os.getpgrp())
        os.kill(os.getpid(), signal.SIGSTOP)
        os.execvp(sys.argv[2], sys.argv[2:])
    if sys.argv[1:2] == ["receipt"]:
        _, _, path, run_id, organ, source, phase, tier, code, delta, note = sys.argv
        append(path, {"schema": "organ.run.v1", "run_id": run_id, "organ": organ,
                      "source": source, "phase": phase, "tier": tier, "exit_code": int(code),
                      "side_effect_delta": int(delta), "note": note})
        return 0
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["run"])
    parser.add_argument("--receipt", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--organ", required=True)
    parser.add_argument("--wall", required=True, type=float)
    parser.add_argument("--invocation-mode", choices=("run", "dry-run"), default="run")
    argv = sys.argv[1:]
    boundary = argv.index("--") if "--" in argv else len(argv)
    args = parser.parse_args(argv[:boundary])
    args.command = argv[boundary + 1:]
    if not args.command:
        parser.error("command required")
    return monitor(args)


if __name__ == "__main__":
    sys.exit(main())

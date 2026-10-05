#!/usr/bin/env python3
"""Metadata-only irreversible launch counter, not inference/capacity authority.

CLI create parent is the owner; nested same-UID callers verify that original
live creator, not their own parent. This does not authenticate callers or prove
ancestry. One retained owner must serialize and acknowledge counters; adapters
are not wired here. Adapters must retain ONE nonce for their invocation and
must not create another after lost acknowledgment. A reservation is never refunded.
Same-UID cooperative processes are trusted not to forge/rewrite records; this is
not a hostile same-UID sandbox or kernel CAS. Nonblocking flock bounds lock waiting,
not synchronous filesystem/native syscalls. No environment-configured trust seams.
"""
import argparse
import ctypes
import fcntl
import json
import os
import re
import secrets
import stat
import sys
import time
from dataclasses import dataclass

MAX_BYTES = 4096
MAX_TTL_NS = 120_000_000_000
SCHEMA = "temperance.cli-launch-budget.v1"
NONCE = re.compile(r"^[0-9a-f]{32}$")
KEYS = {"schema", "nonce", "uid", "owner_pid", "owner_birth", "created_ns", "expires_ns", "limit", "counter", "device", "inode"}

class Held(Exception):
    def __init__(self, reason):
        self.reason = reason

class BsdInfo(ctypes.Structure):
    # Fixed Apple XNU proc_bsdinfo ABI: 136 bytes, flavor3.
    # https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/proc_info.h
    _fields_ = [(name, ctypes.c_uint32) for name in (
        "flags", "status", "xstatus", "pid", "ppid", "uid", "gid", "ruid", "rgid", "svuid", "svgid", "reserved")]
    _fields_ += [("comm", ctypes.c_char * 16), ("name", ctypes.c_char * 32)]
    _fields_ += [(name, ctypes.c_uint32) for name in ("nfiles", "pgid", "jobc", "tdev", "tpgid")]
    _fields_ += [("nice", ctypes.c_int32), ("start_sec", ctypes.c_uint64), ("start_usec", ctypes.c_uint64)]

def bounded_proc(path, ceiling):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        value = os.read(fd, ceiling + 1)
        if len(value) > ceiling:
            raise Held("owner_unavailable")
        return value
    finally:
        os.close(fd)

def native_birth(pid, uid):
    if type(pid) is not int or pid <= 1:
        raise Held("owner_unavailable")
    try:
        if sys.platform == "darwin":
            if ctypes.sizeof(BsdInfo) != 136:
                raise Held("owner_unavailable")
            lib = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
            fn = lib.proc_pidinfo
            fn.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
            fn.restype = ctypes.c_int
            info = BsdInfo()
            if fn(pid, 3, 0, ctypes.byref(info), 136) != 136:
                raise Held("owner_unavailable")
            if info.pid != pid or info.uid != uid or info.ruid != uid or info.status in (0, 5) or not info.start_sec or info.start_usec >= 1_000_000:
                raise Held("owner_unavailable")
            return f"darwin:{info.start_sec}:{info.start_usec}"
        if sys.platform.startswith("linux"):
            raw = bounded_proc(f"/proc/{pid}/stat", 4096)
            status = bounded_proc(f"/proc/{pid}/status", 8192)
            again = bounded_proc(f"/proc/{pid}/stat", 4096)
            def start(value):
                prefix, sep, tail = value.rpartition(b") ")
                fields = tail.split()
                if not sep or prefix.split(b" ", 1)[0] != str(pid).encode() or len(fields) < 20 or fields[0] == b"Z":
                    raise Held("owner_unavailable")
                return int(fields[19])
            a = start(raw)
            uid_line = [line for line in status.splitlines() if line.startswith(b"Uid:")]
            if len(uid_line) != 1 or [int(v) for v in uid_line[0].split()[1:]] != [uid] * 4 or a <= 0 or start(again) != a:
                raise Held("owner_unavailable")
            boot = bounded_proc("/proc/sys/kernel/random/boot_id", 64).strip().decode("ascii")
            if not re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", boot):
                raise Held("owner_unavailable")
            return f"linux:{boot}:{a}"
    except Held:
        raise
    except Exception:
        raise Held("owner_unavailable") from None
    raise Held("owner_unavailable")

@dataclass(frozen=True)
class Dependencies:
    # Trusted in-process constructor seam only. Never parsed from wire or env.
    clock: object = time.monotonic_ns
    birth: object = native_birth
    fsync: object = os.fsync
    write: object = os.write

def integer(value, low, high):
    return type(value) is int and low <= value <= high

def directory(path):
    if type(path) is not str or not path.startswith("/") or "\x00" in path or len(path) > 4096:
        raise Held("unsafe_path")
    parts = path.split("/")[1:]
    if any(p in ("", ".", "..") for p in parts):
        raise Held("unsafe_path")
    try:
        fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    except Exception:
        raise Held("unsafe_path") from None
    try:
        for part in parts:
            nxt = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
            old = fd
            fd = nxt
            os.close(old)
            s = os.fstat(fd)
            if s.st_mode & 0o022 and not (s.st_mode & stat.S_ISVTX and s.st_uid in (0, os.getuid())):
                raise Held("unsafe_path")
        s = os.fstat(fd)
        if s.st_uid != os.getuid() or stat.S_IMODE(s.st_mode) != 0o700:
            raise Held("unsafe_path")
        return fd, (s.st_dev, s.st_ino)
    except Held:
        os.close(fd)
        raise
    except Exception:
        os.close(fd)
        raise Held("unsafe_path") from None

def check_directory(path, identity):
    fd, actual = directory(path)
    os.close(fd)
    if actual != identity:
        raise Held("replaced")

def close_pair(fd, dfd):
    # Attempt both closes even if the first fails; never claim clean delivery.
    failed = False
    for handle in (fd, dfd):
        if handle is not None:
            try:
                os.close(handle)
            except Exception:
                failed = True
    if failed:
        raise Held("cleanup_uncertain")

def file_stat(fd):
    s = os.fstat(fd)
    if not stat.S_ISREG(s.st_mode) or s.st_uid != os.getuid() or stat.S_IMODE(s.st_mode) != 0o600 or s.st_nlink != 1 or s.st_size > MAX_BYTES:
        raise Held("unsafe_record")
    return s

def check_file(fd, dfd, name, identity):
    a = file_stat(fd)
    b = os.stat(name, dir_fd=dfd, follow_symlinks=False)
    if not stat.S_ISREG(b.st_mode) or (a.st_dev, a.st_ino) != identity or (b.st_dev, b.st_ino) != identity or b.st_nlink != 1:
        raise Held("replaced")

def pairs(items):
    out = {}
    for key, value in items:
        if key in out:
            raise Held("malformed")
        out[key] = value
    return out

def decode(raw):
    try:
        record = json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(Held("malformed")))
        if type(record) is not dict or set(record) != KEYS or record["schema"] != SCHEMA or type(record["nonce"]) is not str or not NONCE.fullmatch(record["nonce"]):
            raise Held("malformed")
        for key in ("uid", "owner_pid", "created_ns", "expires_ns", "device", "inode"):
            if not integer(record[key], 0, 2**63 - 1):
                raise Held("malformed")
        if record["owner_pid"] <= 1 or not integer(record["limit"], 1, 4) or not integer(record["counter"], 0, record["limit"]):
            raise Held("malformed")
        if not 0 < record["expires_ns"] - record["created_ns"] <= MAX_TTL_NS:
            raise Held("malformed")
        if type(record["owner_birth"]) is not str or not re.fullmatch(r"(?:darwin:[0-9]{1,20}:[0-9]{1,6}|linux:[0-9a-f-]{36}:[0-9]{1,20})", record["owner_birth"]):
            raise Held("malformed")
        return record
    except Held:
        raise
    except Exception:
        raise Held("malformed") from None

def receipt(operation, nonce, counter, limit):
    return {"schema": SCHEMA, "operation": operation, "status": "created" if operation == "create" else "reserved", "nonce": nonce, "counter": counter, "launch_limit": limit,
            "execution_authorized": False, "capacity_authorization": False, "inference_authorized": False}

class LaunchBudget:
    def __init__(self, dependencies=None):
        self.deps = dependencies or Dependencies()
    def now(self):
        n = self.deps.clock()
        if not integer(n, 0, 2**63 - 1):
            raise Held("clock_unavailable")
        return n
    def fresh(self, record, owner):
        n = self.now()
        if n < record["created_ns"] or n >= record["expires_ns"]:
            raise Held("expired")
        if record["uid"] != os.getuid() or record["owner_pid"] != owner or self.deps.birth(owner, os.getuid()) != record["owner_birth"]:
            raise Held("stale_owner")
        # Synchronous observer may consume the entire remaining budget.
        n = self.now()
        if n < record["created_ns"] or n >= record["expires_ns"]:
            raise Held("expired")
    def persist(self, fd, record):
        raw = json.dumps(record, sort_keys=True, separators=(",", ":")).encode("ascii")
        if len(raw) > MAX_BYTES:
            raise Held("malformed")
        # Persist invalidation first: a short/failed write cannot leave the old
        # valid counter available for a later reservation. Never repair it.
        os.ftruncate(fd, 0)
        self.deps.fsync(fd)
        os.lseek(fd, 0, os.SEEK_SET)
        # Any short/torn write holds. It is never restored/refunded.
        if self.deps.write(fd, raw) != len(raw):
            raise Held("uncertain_commit")
        os.ftruncate(fd, len(raw))
        self.deps.fsync(fd)
        os.lseek(fd, 0, os.SEEK_SET)
        if os.read(fd, MAX_BYTES + 1) != raw:
            raise Held("uncertain_commit")
    def create(self, path, limit=4, ttl_ms=120_000, *, owner_pid=None):
        # owner_pid is trusted library caller context; CLI always derives parent.
        if not integer(limit, 1, 4) or not integer(ttl_ms, 1, 120_000):
            raise Held("invalid_policy")
        owner = os.getppid() if owner_pid is None else owner_pid
        birth = self.deps.birth(owner, os.getuid())
        dfd, did = directory(path)
        fd = None
        try:
            nonce = secrets.token_hex(16)
            name = nonce + ".json"
            fd = os.open(name, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, 0o600, dir_fd=dfd)
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            s = file_stat(fd)
            now = self.now()
            record = dict(schema=SCHEMA, nonce=nonce, uid=os.getuid(), owner_pid=owner, owner_birth=birth, created_ns=now, expires_ns=now + ttl_ms * 1_000_000, limit=limit, counter=0, device=s.st_dev, inode=s.st_ino)
            decode(json.dumps(record))
            self.fresh(record, owner)
            check_directory(path, did)
            check_file(fd, dfd, name, (s.st_dev, s.st_ino))
            self.persist(fd, record)
            self.deps.fsync(dfd)
            self.fresh(record, owner)
            check_directory(path, did)
            check_file(fd, dfd, name, (s.st_dev, s.st_ino))
            return receipt("create", nonce, 0, limit)
        except Held:
            raise
        except Exception:
            raise Held("uncertain_commit") from None
        finally:
            close_pair(fd, dfd)
    def reserve(self, path, nonce, expected_counter):
        if type(nonce) is not str or not NONCE.fullmatch(nonce):
            raise Held("invalid_nonce")
        if not integer(expected_counter, 0, 4):
            raise Held("invalid_counter")
        dfd, did = directory(path)
        fd = None
        try:
            name = nonce + ".json"
            fd = os.open(name, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=dfd)
            file_stat(fd)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise Held("locked") from None
            s = file_stat(fd)
            os.lseek(fd, 0, os.SEEK_SET)
            raw = os.read(fd, MAX_BYTES + 1)
            if len(raw) > MAX_BYTES:
                raise Held("malformed")
            record = decode(raw)
            owner = record["owner_pid"]
            identity = (record["device"], record["inode"])
            if record["nonce"] != nonce:
                raise Held("replaced")
            check_file(fd, dfd, name, identity)
            self.fresh(record, owner)
            if record["counter"] != expected_counter:
                raise Held("uncertain_ack")
            if record["counter"] >= record["limit"]:
                raise Held("exhausted")
            check_directory(path, did)
            record["counter"] += 1
            self.persist(fd, record)
            self.fresh(record, owner)
            check_directory(path, did)
            check_file(fd, dfd, name, identity)
            return receipt("reserve", nonce, record["counter"], record["limit"])
        except Held:
            raise
        except Exception:
            raise Held("uncertain_commit") from None
        finally:
            close_pair(fd, dfd)

class FixedParser(argparse.ArgumentParser):
    def error(self, message):
        raise Held("invalid_arguments")

def main(argv=None):
    parser = FixedParser(add_help=False, allow_abbrev=False)
    parser.add_argument("operation", choices=("create", "reserve"))
    parser.add_argument("--directory", required=True)
    parser.add_argument("--nonce")
    parser.add_argument("--expected-counter", type=int)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--ttl-ms", type=int)
    try:
        wire = sys.argv[1:] if argv is None else argv
        if type(wire) not in (list, tuple) or not 1 <= len(wire) <= 11 or any(type(v) is not str for v in wire) or sum(len(v) for v in wire) > 4096 or sum(len(v.encode("utf8")) for v in wire) > 4096:
            raise Held("invalid_arguments")
        flags = wire[1::2]
        if len(wire) % 2 != 1 or len(flags) != len(set(flags)) or any(v not in ("--directory", "--nonce", "--limit", "--ttl-ms", "--expected-counter") for v in flags):
            raise Held("invalid_arguments")
        args = parser.parse_args(wire)
        if args.operation == "create":
            if args.nonce is not None or args.expected_counter is not None:
                raise Held("invalid_arguments")
            result = LaunchBudget().create(args.directory, args.limit if args.limit is not None else 4, args.ttl_ms if args.ttl_ms is not None else 120_000)
        else:
            if args.nonce is None or args.expected_counter is None or args.limit is not None or args.ttl_ms is not None:
                raise Held("invalid_arguments")
            result = LaunchBudget().reserve(args.directory, args.nonce, args.expected_counter)
        print(json.dumps(result, separators=(",", ":")), flush=True)
        return 0
    except Held as held:
        reason = held.reason
    except Exception:
        reason = "unavailable"
    print(json.dumps({"schema": SCHEMA, "status": "held", "reason": reason, "execution_authorized": False, "capacity_authorization": False, "inference_authorized": False}), file=sys.stderr, flush=True)
    return 2

if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Fixed pipe-role metadata handshake; no launch or execution authority.

FD3 is owner->child (handle, confirmation); FD4 child->owner (one ACK+EOF).
Reserve/retain callbacks are trusted synchronous owner code: checked around but
not preemptible. Original same-host monotonic deadline never gains a new TTL.
Pre-confirmation uncertainty prevents readiness. After confirmation transmission,
owner uncertainty cannot prove the child did not become ready. Never recover a
counter from disk or recreate a handle after uncertainty. Same-UID cooperation,
not authenticated ancestry. Production APIs have no FD/env/config override.
"""
import fcntl
import json
import os
import re
import select
import stat
import struct
import time
from dataclasses import dataclass
from types import MappingProxyType

MAX_FRAME = 16 * 1024
MAX_EXCHANGE_NS = 2_000_000_000
MAX_INVOCATION_NS = 120_000_000_000
HANDLE = "temperance.cli-launch-handle.v1"
ACK = "temperance.cli-launch-ack.v1"
CONFIRM = "temperance.cli-launch-confirm.v1"
FLAGS = ("execution_authorized", "capacity_authorization", "inference_authorized")
COMMON = {"schema", "nonce", "expected_counter", "launch_limit", "invocation_deadline_ns", "exchange_deadline_ns", *FLAGS}
HANDLE_KEYS = COMMON | {"directory"}
ACK_KEYS = COMMON | {"counter"}
RESERVE_KEYS = {"schema", "operation", "status", "nonce", "counter", "launch_limit", *FLAGS}

class CodecHeld(Exception):
    def __init__(self, reason):
        self.reason = reason

@dataclass(frozen=True)
class _Dependencies:
    # Private trusted in-process fixture seams, never wire/environment-selected.
    clock: object = time.monotonic_ns
    cancelled: object = lambda: False
    read: object = os.read
    write: object = os.write
    close: object = os.close
    wait: object = select.select

def _integer(value, low, high):
    return type(value) is int and low <= value <= high

def _closed(value, keys, reason):
    if type(value) is not dict or len(value) != len(keys):
        raise CodecHeld(reason)
    if any(type(key) is not str for key in value) or set(value) != keys:
        raise CodecHeld(reason)
    return dict(value)  # Exact bounded fields; scalar validation follows.

def _pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise CodecHeld("malformed_frame")
        result[key] = value
    return result

def _handle(value):
    h = _closed(value, HANDLE_KEYS, "invalid_handle")
    if type(h["schema"]) is not str or h["schema"] != HANDLE or any(h[key] is not False for key in FLAGS):
        raise CodecHeld("invalid_handle")
    if type(h["nonce"]) is not str or not re.fullmatch(r"[0-9a-f]{32}", h["nonce"]):
        raise CodecHeld("invalid_handle")
    path = h["directory"]
    if type(path) is not str or not 1 <= len(path) <= 4096 or not path.startswith("/") or "\x00" in path or any(p in ("", ".", "..") for p in path.split("/")[1:]) :
        raise CodecHeld("invalid_handle")
    try:
        if len(path.encode("utf8")) > 4096:
            raise CodecHeld("invalid_handle")
    except UnicodeError:
        raise CodecHeld("invalid_handle")
    if not _integer(h["launch_limit"], 1, 4) or not _integer(h["expected_counter"], 0, h["launch_limit"] - 1):
        raise CodecHeld("invalid_handle")
    if any(not _integer(h[key], 1, 2**63 - 1) for key in ("invocation_deadline_ns", "exchange_deadline_ns")):
        raise CodecHeld("invalid_handle")
    if h["exchange_deadline_ns"] > h["invocation_deadline_ns"]:
        raise CodecHeld("invalid_handle")
    return h

def _correlated(value, handle, schema):
    result = _closed(value, ACK_KEYS, "invalid_ack" if schema == ACK else "invalid_confirmation")
    if type(result["schema"]) is not str or result["schema"] != schema or not _integer(result["counter"], 1, 4) or result["counter"] != handle["expected_counter"] + 1:
        raise CodecHeld("invalid_ack" if schema == ACK else "invalid_confirmation")
    for key in COMMON - {"schema"}:
        # Type equality prevents True/1 equivalence in protocol metadata.
        if type(result[key]) is not type(handle[key]) or result[key] != handle[key]:
            raise CodecHeld("invalid_ack" if schema == ACK else "invalid_confirmation")
    return result

def _ack(handle, reservation):
    r = _closed(reservation, RESERVE_KEYS, "invalid_reservation")
    if any(type(r[key]) is not str for key in ("schema", "operation", "status", "nonce")) or r["schema"] != "temperance.cli-launch-budget.v1" or r["operation"] != "reserve" or r["status"] != "reserved" or r["nonce"] != handle["nonce"] or not _integer(r["counter"], 1, 4) or r["counter"] != handle["expected_counter"] + 1 or type(r["launch_limit"]) is not int or r["launch_limit"] != handle["launch_limit"] or any(r[key] is not False for key in FLAGS):
        raise CodecHeld("invalid_reservation")
    result = {key: handle[key] for key in COMMON}
    result.update(schema=ACK, counter=r["counter"])
    return result

def _ready():
    return MappingProxyType({"schema": "temperance.cli-launch-codec-receipt.v1", "status": "metadata-ready", **{key: False for key in FLAGS}})

class _Channel:
    def __init__(self, role, fds, dependencies):
        self.deps = dependencies
        self.fds = fds
        self.closed = set()
        self.identities = {}
        self.last = None
        try:
            self.start = self.now()
            self.deadline = self.start + MAX_EXCHANGE_NS
            # Test-only arbitrary descriptors never enter production wrappers.
            if len(fds) != 2 or fds[0] == fds[1]:
                raise CodecHeld("descriptor_role")
            expected = (os.O_WRONLY, os.O_RDONLY) if role == "owner" else (os.O_RDONLY, os.O_WRONLY)
            for fd, access in zip(fds, expected):
                info = os.fstat(fd)
                flags = fcntl.fcntl(fd, fcntl.F_GETFL)
                if not stat.S_ISFIFO(info.st_mode) or flags & os.O_ACCMODE != access:
                    raise CodecHeld("descriptor_role")
                self.identities[fd] = (info.st_dev, info.st_ino)
                fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)
                fcntl.fcntl(fd, fcntl.F_SETFD, fcntl.fcntl(fd, fcntl.F_GETFD) | fcntl.FD_CLOEXEC)
            if len(set(self.identities.values())) != 2:
                raise CodecHeld("descriptor_role")
            self.check()
        except BaseException as error:
            self.finish()
            if isinstance(error, CodecHeld):
                raise
            raise CodecHeld("cancelled" if isinstance(error, KeyboardInterrupt) else "descriptor_unavailable") from None
    def now(self):
        try:
            value = self.deps.clock()
        except Exception:
            raise CodecHeld("clock_unavailable") from None
        if not _integer(value, 0, 2**63 - 1) or self.last is not None and value < self.last:
            raise CodecHeld("clock_unavailable")
        self.last = value
        return value
    def check(self):
        try:
            cancelled = self.deps.cancelled()
        except Exception:
            raise CodecHeld("cancelled") from None
        if cancelled is not False:
            raise CodecHeld("cancelled")
        if self.now() >= self.deadline:
            raise CodecHeld("deadline")
    def bind(self, handle):
        if not 0 < handle["invocation_deadline_ns"] - self.start <= MAX_INVOCATION_NS or not 0 < handle["exchange_deadline_ns"] - self.start <= MAX_EXCHANGE_NS:
            raise CodecHeld("invalid_deadline")
        self.deadline = min(self.deadline, handle["invocation_deadline_ns"], handle["exchange_deadline_ns"])
        self.check()
    def wait(self, fd, writing=False):
        self.check()
        remaining = (self.deadline - self.last) / 1_000_000_000
        try:
            self.deps.wait([] if writing else [fd], [fd] if writing else [], [], min(remaining, 0.05))
        except Exception:
            raise CodecHeld("io_unavailable") from None
        self.check()
    def read_exact(self, fd, count):
        value = bytearray()
        while len(value) < count:
            self.wait(fd)
            try:
                chunk = self.deps.read(fd, count - len(value))
            except (BlockingIOError, InterruptedError):
                continue
            except Exception:
                raise CodecHeld("io_unavailable") from None
            self.check()
            if type(chunk) is not bytes or len(chunk) > count - len(value):
                raise CodecHeld("io_unavailable")
            if not chunk:
                raise CodecHeld("partial_frame" if value else "unexpected_eof")
            value.extend(chunk)
        return bytes(value)
    def read_frame(self, fd):
        size = struct.unpack(">I", self.read_exact(fd, 4))[0]
        if not 0 < size <= MAX_FRAME:
            raise CodecHeld("frame_bounds")
        raw = self.read_exact(fd, size)
        try:
            value = json.loads(raw.decode("utf8", "strict"), object_pairs_hook=_pairs, parse_constant=lambda _: (_ for _ in ()).throw(CodecHeld("malformed_frame")))
        except CodecHeld:
            raise
        except Exception:
            raise CodecHeld("malformed_frame") from None
        self.check()
        return value
    def eof(self, fd):
        while True:
            self.wait(fd)
            try:
                extra = self.deps.read(fd, 1)
            except (BlockingIOError, InterruptedError):
                continue
            except Exception:
                raise CodecHeld("io_unavailable") from None
            self.check()
            if type(extra) is not bytes:
                raise CodecHeld("io_unavailable")
            if extra:
                raise CodecHeld("extra_frame")
            return
    def write_frame(self, fd, packet):
        try:
            raw = json.dumps(packet, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")
        except Exception:
            raise CodecHeld("malformed_frame") from None
        if not 0 < len(raw) <= MAX_FRAME:
            raise CodecHeld("frame_bounds")
        framed = struct.pack(">I", len(raw)) + raw
        offset = 0
        while offset < len(framed):
            self.wait(fd, True)
            try:
                count = self.deps.write(fd, memoryview(framed)[offset:])
            except (BlockingIOError, InterruptedError):
                continue
            except Exception:
                raise CodecHeld("io_unavailable") from None
            self.check()
            if not _integer(count, 1, len(framed) - offset):
                raise CodecHeld("io_unavailable")
            offset += count
    def close(self, fd):
        if fd in self.closed:
            return
        self.closed.add(fd)  # Ambiguous close is never retried on possibly reused FD.
        try:
            info = os.fstat(fd)
            if fd in self.identities and (info.st_dev, info.st_ino) != self.identities[fd]:
                raise CodecHeld("cleanup_uncertain")
            self.deps.close(fd)
        except Exception:
            raise CodecHeld("cleanup_uncertain") from None
    def finish(self):
        failed = False
        for fd in self.fds:
            try:
                self.close(fd)
            except Exception:
                failed = True
        if failed:
            raise CodecHeld("cleanup_uncertain")

def _owner_exchange(context, retain_ack, *, _fds=(3, 4), _dependencies=None):
    # Context/callback are trusted bounded owner DTOs; snapshot before callbacks.
    channel = _Channel("owner", _fds, _dependencies or _Dependencies())
    try:
        handle = _handle(context)
        channel.bind(handle)
        channel.write_frame(_fds[0], handle)
        ack = _correlated(channel.read_frame(_fds[1]), handle, ACK)
        channel.eof(_fds[1])
        channel.close(_fds[1])
        channel.check()
        try:
            result = retain_ack(MappingProxyType(ack))
            if result is not None:
                raise CodecHeld("retain_held")
        except Exception:
            raise CodecHeld("retain_held") from None
        channel.check()  # Cannot preempt synchronous callback; no late confirmation.
        confirmation = dict(ack, schema=CONFIRM)
        channel.write_frame(_fds[0], confirmation)
        channel.close(_fds[0])
        channel.check()
        return _ready()
    finally:
        channel.finish()

def _child_exchange(reserve, *, _fds=(3, 4), _dependencies=None):
    channel = _Channel("child", _fds, _dependencies or _Dependencies())
    try:
        handle = _handle(channel.read_frame(_fds[0]))
        channel.bind(handle)
        channel.check()
        try:
            reservation = reserve(MappingProxyType(handle))
        except Exception:
            raise CodecHeld("reserve_held") from None
        channel.check()  # A consumed slot stays consumed if callback returned late.
        ack = _ack(handle, reservation)
        channel.write_frame(_fds[1], ack)
        channel.close(_fds[1])
        confirmation = _correlated(channel.read_frame(_fds[0]), handle, CONFIRM)
        channel.eof(_fds[0])
        channel.close(_fds[0])
        channel.check()
        return _ready()
    finally:
        channel.finish()

def owner_exchange(context, retain_ack):
    """Owner literal FD3(write)/FD4(read); retain validated ACK before confirming."""
    return _owner_exchange(context, retain_ack)

def child_exchange(reserve):
    """Child literal FD3(read)/FD4(write); close both before metadata-ready."""
    return _child_exchange(reserve)

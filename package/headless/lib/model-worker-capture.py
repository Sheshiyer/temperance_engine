"""Bounded private byte capture; no spawn, termination, inference or replay authority."""
from dataclasses import dataclass
import math
import fcntl
import os
from pathlib import Path
import selectors
import stat
import time
import uuid
from types import MappingProxyType

FRAME = 64 * 1024
CAPS = MappingProxyType({'events': 4 * 1024 * 1024, 'stderr': 1024 * 1024, 'final': 256 * 1024})
AGGREGATE = 5 * 1024 * 1024
CHUNK = 16 * 1024
DRAIN = .250


class Held(Exception):
    pass


def identity(fd):
    s = os.fstat(fd)
    return (s.st_dev, s.st_ino, stat.S_IFMT(s.st_mode))


@dataclass(frozen=True)
class Terminal:
    # Caller-observed process termination and final-write contract, never FIFO inference.
    exited: bool
    exit_code: int | None = None
    final_write_completed: bool = False


@dataclass(frozen=True)
class Capture:
    status: str
    reason: str
    counts: tuple
    exit_code: int | None
    events: bytes = b''
    stderr: bytes = b''
    final: bytes = b''

    def receipt(self):
        return {'schema': 'temperance.model-worker-capture.v1', 'status': self.status,
                'reason': self.reason, 'counts': dict(self.counts), 'exit_code': self.exit_code,
                'execution_authorized': False, 'inference_verified': False,
                'resource_contained': False, 'process_cleanup_verified': False,
                'replay_authorized': False, 'pre_effect_proven': False}


class FinalSink:
    """Exclusive FIFO. Trusted directory ancestry and same-UID cooperation are caller policy."""
    def __init__(self, directory):
        directory = Path(directory)
        if not directory.is_absolute() or str(directory.resolve()) != str(directory):
            raise Held('unsafe_directory')
        self.parent = self.reader = self.keeper = None
        self.name = 'capture-' + uuid.uuid4().hex
        self.path = str(directory / self.name)
        self.directory = directory
        self.parent_key = None
        self.key = None
        try:
            self.parent = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
            s = os.fstat(self.parent)
            self.parent_key = (s.st_dev, s.st_ino)
            if s.st_uid != os.getuid() or stat.S_IMODE(s.st_mode) & 0o077:
                raise Held('unsafe_directory')
            if (s.st_dev, s.st_ino) != (directory.stat().st_dev, directory.stat().st_ino):
                raise Held('directory_changed')
            os.mkfifo(self.name, 0o600, dir_fd=self.parent)
            created = os.stat(self.name, dir_fd=self.parent, follow_symlinks=False)
            self.key = (created.st_dev, created.st_ino, stat.S_IFMT(created.st_mode))
            self.reader = os.open(self.name, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=self.parent)
            if identity(self.reader) != self.key:
                raise Held('fifo_changed')
            self.keeper = os.open(self.name, os.O_WRONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=self.parent)
            s = os.fstat(self.reader)
            if not stat.S_ISFIFO(s.st_mode) or s.st_uid != os.getuid() or identity(self.keeper) != self.key:
                raise Held('fifo_changed')
        except Exception:
            self.close()
            raise Held('sink_creation_failed') from None

    def close_keeper(self):
        if self.keeper is not None:
            fd, self.keeper = self.keeper, None
            if identity(fd) != self.key:
                raise Held('descriptor_changed')
            os.close(fd)

    def close(self):
        okay = True
        for name in ('keeper', 'reader'):
            fd = getattr(self, name)
            setattr(self, name, None)
            if fd is not None:
                try:
                    if self.key is not None and identity(fd) != self.key:
                        okay = False
                    else:
                        os.close(fd)
                except Exception:
                    okay = False
        if self.parent is not None:
            try:
                current = self.directory.lstat()
                if not stat.S_ISDIR(current.st_mode) or (current.st_dev, current.st_ino) != self.parent_key:
                    okay = False
            except Exception:
                okay = False
            try:
                s = os.stat(self.name, dir_fd=self.parent, follow_symlinks=False)
                if self.key == (s.st_dev, s.st_ino, stat.S_IFMT(s.st_mode)):
                    os.unlink(self.name, dir_fd=self.parent)
                else:
                    okay = False
            except FileNotFoundError:
                pass
            except Exception:
                okay = False
            try:
                os.close(self.parent)
            except Exception:
                okay = False
            self.parent = None
        return okay


def collect(stdout_fd, stderr_fd, sink, *, deadline, terminal, cancelled=lambda: False,
            clock=time.monotonic):
    """Own supplied descriptors. Trusted synchronous callbacks cannot be preempted.

    Successful capture is private bytes only. Caller terminal evidence must establish
    final-write completion even for empty final output; missing evidence holds.
    """
    buffers = {k: bytearray() for k in CAPS}
    counts = {k: 0 for k in CAPS}
    fds = {'events': stdout_fd, 'stderr': stderr_fd, 'final': sink.reader}
    keys = {}
    owned = {}
    selector = None
    reason = 'capture_failed'
    result_status = 'held'
    last = Terminal(False)
    drain_deadline = None
    frame = 0
    try:
        # Ownership is established independently of deadline/admission validity.
        # Deduplicate descriptors so invalid overlapping input never double-closes.
        invalid_identity = False
        for name, fd in fds.items():
            try:
                key = identity(fd)
                keys[name] = key
                if name != 'final':
                    owned[fd] = key
            except Exception:
                invalid_identity = True
        if invalid_identity:
            raise Held('invalid_descriptors')
        selector = selectors.DefaultSelector()
        now = clock()
        if type(deadline) not in (float, int) or not math.isfinite(deadline) or not now < deadline <= now + 120:
            raise Held('invalid_deadline')
        if len(set(fds.values())) != 3:
            raise Held('invalid_descriptors')
        for name, fd in fds.items():
            s = os.fstat(fd)
            if not stat.S_ISFIFO(s.st_mode) or fcntl.fcntl(fd, fcntl.F_GETFL) & os.O_ACCMODE != os.O_RDONLY:
                raise Held('invalid_descriptors')
            if identity(fd) != keys[name] or (name == 'final' and keys[name] != sink.key):
                raise Held('descriptor_changed')
            os.set_blocking(fd, False)
            os.set_inheritable(fd, False)
            selector.register(fd, selectors.EVENT_READ, name)
        while True:
            end = min(deadline, drain_deadline) if drain_deadline is not None else deadline
            if clock() >= end:
                raise Held('drain_deadline' if drain_deadline is not None else 'deadline')
            cancel = cancelled()
            observation = terminal()
            if clock() >= end:
                raise Held('drain_deadline' if drain_deadline is not None else 'deadline')
            if type(cancel) is not bool or type(observation) is not Terminal:
                raise Held('observation_unknown')
            if cancel:
                raise Held('cancelled')
            if type(observation.exited) is not bool or type(observation.final_write_completed) is not bool:
                raise Held('observation_unknown')
            if observation.exited:
                if type(observation.exit_code) is not int or not 0 <= observation.exit_code <= 255:
                    raise Held('observation_unknown')
                if drain_deadline is None:
                    last = observation
                    sink.close_keeper()
                    drain_deadline = min(deadline, clock() + DRAIN)
                elif observation != last:
                    raise Held('terminal_changed')
            elif drain_deadline is not None:
                raise Held('terminal_changed')
            if not selector.get_map() and drain_deadline is not None:
                if frame:
                    raise Held('partial_event_frame')
                if not last.final_write_completed:
                    raise Held('final_write_unproven')
                result_status, reason = 'captured', 'private_bytes_only'
                break
            end = min(deadline, drain_deadline) if drain_deadline is not None else deadline
            selector.select(max(0, min(.010, end - clock())))
            # Probe registered nonblocking readers too: some kernels do not notify
            # FIFO EOF when the local keeper closes before any external writer.
            for key in list(selector.get_map().values()):
                name, fd = key.data, key.fd
                if clock() >= end:
                    raise Held('drain_deadline' if drain_deadline is not None else 'deadline')
                if identity(fd) != keys[name]:
                    raise Held('descriptor_changed')
                room = min(CAPS[name] - counts[name], AGGREGATE - sum(counts.values()))
                try:
                    data = os.read(fd, min(CHUNK, room + 1))
                except BlockingIOError:
                    continue
                if not data:
                    selector.unregister(fd)
                    continue
                if len(data) > room:
                    raise Held('capture_overflow')
                if name == 'events':
                    for byte in data:
                        if byte == 10:
                            frame = 0
                        else:
                            frame += 1
                            if frame > FRAME:
                                raise Held('event_frame_overflow')
                buffers[name].extend(data)
                counts[name] += len(data)
    except Held as error:
        reason = str(error)
    except Exception:
        reason = 'capture_operation_failed'
    finally:
        if selector is not None:
            try:
                selector.close()
            except Exception:
                result_status, reason = 'held', 'descriptor_cleanup_uncertain'
        for fd, key in owned.items():
            try:
                if identity(fd) != key:
                    result_status, reason = 'held', 'descriptor_cleanup_uncertain'
                else:
                    os.close(fd)
            except Exception:
                result_status, reason = 'held', 'descriptor_cleanup_uncertain'
        try:
            if not sink.close():
                result_status, reason = 'held', 'descriptor_cleanup_uncertain'
        except Exception:
            result_status, reason = 'held', 'descriptor_cleanup_uncertain'
    payloads = tuple(bytes(buffers[k]) if result_status == 'captured' else b'' for k in CAPS)
    try:
        end = min(deadline, drain_deadline) if drain_deadline is not None else deadline
        if result_status == 'captured' and clock() >= end:
            result_status, reason, payloads = 'held', 'deadline', (b'', b'', b'')
    except Exception:
        result_status, reason, payloads = 'held', 'capture_operation_failed', (b'', b'', b'')
    return Capture(result_status, reason, tuple(counts.items()), last.exit_code,
                   *payloads)

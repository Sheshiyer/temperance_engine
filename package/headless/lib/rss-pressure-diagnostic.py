"""Explicit manual-once RSS metadata diagnostic; never background admission."""
import builtins
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import time
import types

MAX_SOURCE_BYTES = 65536
MAX_ROWS = 4096
MAX_NS = 2_000_000_000
PINS = {
    'model-worker-native-observation.py': '1a60f38095dde8d4c50aa5cbe2d2698edc34b723bcf99a1f719e3c47ba6c9170',
    'model-worker-inventory.py': '21242544fce4c6b6c360d948c651730e9fc31a2323245a8b064c276346b98c13',
}
REASONS = frozenset(('source_unavailable', 'source_drift', 'deadline_invalid', 'deadline', 'clock_unavailable',
    'platform_unsupported', 'abi_unavailable', 'uid_invalid', 'snapshot_bound', 'snapshot_invalid',
    'metadata_unavailable', 'identity_unavailable', 'zombie_unavailable', 'native_unavailable',
    'native_adapter_incomplete', 'row_invalid', 'pressure_unavailable', 'diagnostic_unavailable', 'manual_invocation_required'))


class Held(Exception):
    pass


class Timer:
    def __init__(self, clock):
        self.clock, self.last = clock, None
        self.start = self.read()
        self.deadline = self.start + MAX_NS
        if self.deadline > 2**63-1:
            raise Held('deadline_invalid')
    def read(self):
        try:
            value = self.clock()
        except Exception:
            raise Held('clock_unavailable') from None
        if type(value) is not int or not 0 <= value <= 2**63-1 or self.last is not None and value < self.last:
            raise Held('clock_unavailable')
        self.last = value
        return value
    def check(self):
        value = self.read()
        if value >= self.deadline:
            raise Held('deadline')
        return value


def metadata(s):
    return (s.st_dev, s.st_ino, s.st_size, s.st_mode, s.st_uid, s.st_gid, s.st_nlink, s.st_mtime_ns, s.st_ctime_ns)


def read_source(path, timer):
    """Trusted fixed sibling only in production; private fixture path seam."""
    fd = None
    try:
        timer.check()
        before = os.lstat(path)
        if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_SOURCE_BYTES or before.st_size < 1:
            raise Held('source_unavailable')
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
        timer.check()
        opened = os.fstat(fd)
        if metadata(opened) != metadata(before) or not stat.S_ISREG(opened.st_mode):
            raise Held('source_unavailable')
        data = bytearray()
        while len(data) < opened.st_size:
            timer.check()
            chunk = os.read(fd, min(16384, opened.st_size-len(data)))
            timer.check()
            if type(chunk) is not bytes or not chunk:
                raise Held('source_unavailable')
            data.extend(chunk)
        timer.check()
        if os.read(fd, 1):
            raise Held('source_unavailable')
        timer.check()
        if metadata(os.fstat(fd)) != metadata(opened) or metadata(os.lstat(path)) != metadata(opened):
            raise Held('source_unavailable')
        return bytes(data)
    except Held:
        raise
    except Exception:
        raise Held('source_unavailable') from None
    finally:
        if fd is not None:
            try:
                os.close(fd)
            except Exception:
                raise Held('source_unavailable') from None
            timer.check()


def load_sources(timer, *, _reader=read_source):
    """Execute detached reviewed bytes, not a sandbox or global import patch."""
    root = Path(__file__).resolve().parent
    sources = {}
    for name, digest in PINS.items():
        timer.check()
        raw = _reader(root/name, timer)
        if type(raw) is not bytes or not 0 < len(raw) <= MAX_SOURCE_BYTES:
            raise Held('source_unavailable')
        if hashlib.sha256(raw).hexdigest() != digest:
            raise Held('source_drift')
        sources[name] = raw
        timer.check()
    native = types.ModuleType('rss_reviewed_native')
    native.__file__ = str(root/'model-worker-native-observation.py')
    timer.check()
    exec(compile(sources['model-worker-native-observation.py'], native.__file__, 'exec'), native.__dict__)
    timer.check()
    class Loader:
        def exec_module(self, target):
            if target is not native:
                raise Held('source_drift')
    spec = types.SimpleNamespace(loader=Loader())
    def fixed_spec(name, path):
        timer.check()
        if type(name) is not str or name != 'worker_native_inventory_basis' or path != root/'model-worker-native-observation.py':
            raise Held('source_drift')
        return spec
    def fixed_module(value):
        if value is not spec:
            raise Held('source_drift')
        return native
    shim = types.SimpleNamespace(util=types.SimpleNamespace(spec_from_file_location=fixed_spec, module_from_spec=fixed_module))
    def local_import(name, globals=None, locals=None, fromlist=(), level=0):
        if name == 'importlib.util' and not level:
            return shim
        return builtins.__import__(name, globals, locals, fromlist, level)
    inventory = types.ModuleType('rss_reviewed_inventory')
    inventory.__file__ = str(root/'model-worker-inventory.py')
    inventory.__dict__['__builtins__'] = dict(vars(builtins), __import__=local_import)
    timer.check()
    exec(compile(sources['model-worker-inventory.py'], inventory.__file__, 'exec'), inventory.__dict__)
    timer.check()
    if inventory.native is not native:
        raise Held('source_drift')
    return native, inventory


def receipt(reason=None, before=None, after=None, aggregates=None):
    if type(reason) is not str or reason not in REASONS:
        reason = 'diagnostic_unavailable' if reason is not None else None
    allowed = ('normal', 'host_pressure_elevated', 'host_pressure_unavailable')
    result = {'schema': 'temperance.manual-rss-pressure-point.v1', 'status': 'held' if reason else 'measured',
        'reason': reason, 'scope': 'current-UID RSS point metadata', 'source_pins': dict(PINS),
        'pressure_before': before if type(before) is str and before in allowed else None, 'pressure_after': after if type(after) is str and after in allowed else None,
        'measurement_complete': reason is None, 'metadata_rows': None, 'live_rows': None, 'stopped_rows': None,
        'zombie_rows': None, 'rss_sum_bytes': None, 'rss_max_bytes': None,
        'execution_authorized': False, 'capacity_authorization': False, 'cleanup_verified': False,
        'causal_attribution': False, 'sustained_acceptance': False, 'native_worker_acceptance': False}
    if not reason:
        result.update(aggregates)
    return result


def diagnose(*, _clock=time.monotonic_ns, _uid=os.getuid, _dependencies=None):
    """Trusted fixture callbacks only; default native path requires manual CLI."""
    rows = None
    before = after = None
    dependency_held = None
    try:
        timer = Timer(_clock)
        native, inventory = load_sources(timer) if _dependencies is None else _dependencies
        dependency_held = native.Held
        timer.check()
        uid = _uid()
        if type(uid) is not int or not 0 <= uid <= 2**32-1:
            raise Held('uid_invalid')
        observer = native.Backend(timer.deadline, clock=_clock)
        before = observer.pressure()
        timer.check()
        if type(before) is not str or before not in ('normal', 'host_pressure_elevated'):
            raise Held('pressure_unavailable')
        rows = inventory.Capture(uid, timer.deadline, clock=_clock).read()
        timer.check()
        if type(rows) is not dict or not 1 <= len(rows) <= MAX_ROWS:
            raise Held('snapshot_bound')
        counts = {'live': 0, 'stopped': 0, 'zombie': 0}
        total = maximum = 0
        for pid, value in rows.items():
            timer.check()
            if type(value) is not dict or len(value) != 6 or any(type(k) is not str for k in value) or type(value.get('state')) is not str:
                raise Held('row_invalid')
            inventory.row(value)
            if type(pid) is not int or pid != value['pid'] or value['uid'] != uid:
                raise Held('row_invalid')
            counts[value['state']] += 1
            total += value['rss_bytes']
            maximum = max(maximum, value['rss_bytes'])
        after = observer.pressure()
        timer.check()
        if type(after) is not str or after not in ('normal', 'host_pressure_elevated'):
            raise Held('pressure_unavailable')
        # Canonical decimal strings avoid lossy downstream JSON number conversion.
        aggregates = {'metadata_rows': len(rows), 'live_rows': counts['live'], 'stopped_rows': counts['stopped'],
            'zombie_rows': counts['zombie'], 'rss_sum_bytes': str(total), 'rss_max_bytes': str(maximum)}
        timer.check()
        return receipt(before=before, after=after, aggregates=aggregates)
    except Exception as error:
        known = type(error) is Held or dependency_held is not None and type(error) is dependency_held
        reason = error.args[0] if known and len(error.args) == 1 and type(error.args[0]) is str else 'diagnostic_unavailable'
        # Only exact pinned dependency/own Held types can supply whitelisted codes.
        return receipt(reason, before, after)
    finally:
        rows = None  # Private UID/PID/birth metadata never persists or projects.


def main():
    if sys.argv[1:] != ['--manual-once'] or not sys.flags.isolated or not sys.dont_write_bytecode:
        result = receipt('manual_invocation_required')
    else:
        result = diagnose()
    try:
        print(json.dumps(result, separators=(',', ':'), ensure_ascii=True))
    except Exception:
        return 2
    return 0 if result['measurement_complete'] else 2


if __name__ == '__main__':
    raise SystemExit(main())

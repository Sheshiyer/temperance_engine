"""Pure model-worker policy/observation contracts. No native syscalls or launch."""
from dataclasses import dataclass
import re
import time

MIB = 1024 * 1024
MAX_WALL_NS = 10_000_000_000
MAX_INVOCATION_NS = 120_000_000_000
MAX_MEMORY = 128 * MIB


class Held(Exception):
    pass


def closed(value, keys):
    if type(value) is not dict or set(value) != set(keys):
        raise Held('invalid_shape')


def integer(value, low, high):
    if type(value) is not int or not low <= value <= high:
        raise Held('invalid_integer')
    return value


def birth(value):
    if type(value) is not str or len(value) > 128:
        raise Held('invalid_birth')
    if value.startswith('darwin:'):
        parts = value.split(':')
        if len(parts) != 3 or not all(re.fullmatch(r'[0-9]{1,20}', p) for p in parts[1:]):
            raise Held('invalid_birth')
        if int(parts[1]) <= 0 or not 0 <= int(parts[2]) < 1_000_000:
            raise Held('invalid_birth')
    elif not re.fullmatch(r'linux:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}:[1-9][0-9]{0,19}', value):
        raise Held('invalid_birth')
    return value


@dataclass(frozen=True)
class Policy:
    wall_ns: int
    rss_bytes: int
    physical_bytes: int
    active_descendants: int
    lifetime_identities: int
    snapshot_ids: int

    @classmethod
    def parse(cls, value):
        if value is None:
            raise Held('policy_missing')
        closed(value, ('schema', 'kind', 'wall_ns', 'rss_bytes', 'physical_bytes', 'active_descendants', 'lifetime_identities', 'snapshot_ids'))
        if value['schema'] != 'temperance.model-worker-policy.v1' or value['kind'] != 'metadata-calibration':
            raise Held('unsupported_policy')
        return cls(integer(value['wall_ns'], 1, MAX_WALL_NS),
            integer(value['rss_bytes'], 1, MAX_MEMORY), integer(value['physical_bytes'], 1, MAX_MEMORY),
            integer(value['active_descendants'], 0, 0), integer(value['lifetime_identities'], 1, 256),
            integer(value['snapshot_ids'], 1, 4096))


@dataclass(frozen=True)
class Owner:
    nonce: str
    counter: int
    launch_limit: int
    creator_pid: int
    uid: int
    creator_birth: str
    created_ns: int
    invocation_deadline_ns: int

    @classmethod
    def parse(cls, value):
        # Caller must retain successful ACK state; these fields are not wire authentication.
        closed(value, ('schema', 'nonce', 'counter', 'launch_limit', 'creator_pid', 'uid', 'creator_birth', 'created_ns', 'invocation_deadline_ns'))
        if value['schema'] != 'temperance.retained-worker-owner.v1' or type(value['nonce']) is not str or not re.fullmatch(r'[0-9a-f]{32}', value['nonce']):
            raise Held('invalid_owner')
        limit = integer(value['launch_limit'], 1, 4)
        counter = integer(value['counter'], 1, limit)
        created = integer(value['created_ns'], 0, 2**63 - 1)
        end = integer(value['invocation_deadline_ns'], created + 1, min(2**63 - 1, created + MAX_INVOCATION_NS))
        return cls(value['nonce'], counter, limit, integer(value['creator_pid'], 2, 2**31 - 1),
            integer(value['uid'], 0, 2**32 - 1), birth(value['creator_birth']), created, end)


@dataclass(frozen=True)
class Process:
    pid: int
    uid: int
    birth: str
    kernel_start: int | None = None

    @classmethod
    def parse(cls, value):
        closed(value, ('pid', 'uid', 'birth', 'kernel_start'))
        start = value['kernel_start']
        if start is not None:
            integer(start, 1, 2**64 - 1)
        return cls(integer(value['pid'], 2, 2**31 - 1), integer(value['uid'], 0, 2**32 - 1), birth(value['birth']), start)


def _identity(value, pid, uid, expected_birth):
    closed(value, ('pid', 'uid', 'birth', 'state'))
    if type(value['pid']) is not int or value['pid'] != pid or type(value['uid']) is not int or value['uid'] != uid or birth(value['birth']) != expected_birth or value['state'] not in ('live', 'stopped'):
        raise Held('birth_unavailable')
    return value['state']


class Observer:
    def __init__(self, policy, owner, process, *, clock=time.monotonic_ns, cancelled=lambda: False):
        self.policy = Policy.parse(policy)
        self.owner = Owner.parse(owner)
        self.process = Process.parse(process)
        if self.process.pid == self.owner.creator_pid or self.process.uid != self.owner.uid:
            raise Held('invalid_process')
        self.deadline = min(self.owner.invocation_deadline_ns, self.owner.created_ns + self.policy.wall_ns)
        self.clock, self.cancelled = clock, cancelled
        self.last_ns = None
        self.reason = None
        self.status = 'unobserved'
        self.samples = 0
        self.peak_rss = self.peak_physical = 0
        self.check()

    def hold(self, reason):
        self.status, self.reason = 'held', reason
        raise Held(reason)

    def check(self):
        if self.status == 'held':
            raise Held(self.reason)
        try:
            cancelled = self.cancelled()
            now = integer(self.clock(), 0, 2**63 - 1)
            if cancelled is not False:
                self.hold('cancelled')
            if now < self.owner.created_ns or self.last_ns is not None and now < self.last_ns:
                self.hold('clock_unavailable')
            self.last_ns = now
            if now >= self.deadline:
                self.hold('deadline')
        except Held:
            if self.status != 'held':
                self.hold('clock_unavailable')
            raise
        except Exception:
            self.hold('observation_unavailable')

    def sample(self, identity_observer, usage_observer):
        """Trusted synchronous injections; before/after checks cannot preempt syscalls."""
        self.check()
        if self.samples >= 256:
            self.hold('sample_bound')
        try:
            owner = identity_observer(self.owner.creator_pid)
            self.check()
            _identity(owner, self.owner.creator_pid, self.owner.uid, self.owner.creator_birth)
            before = identity_observer(self.process.pid)
            self.check()
            state = _identity(before, self.process.pid, self.process.uid, self.process.birth)
            usage = usage_observer(self.process.pid)
            self.check()
            closed(usage, ('backend', 'native_result', 'rss_bytes', 'physical_bytes', 'kernel_start', 'kernel_exit'))
            if usage['backend'] != 'darwin-proc-pid-rusage-v0' or not self.process.birth.startswith('darwin:'):
                raise Held('physical_unsupported')
            if type(usage['native_result']) is not int or usage['native_result'] != 0 or type(usage['kernel_exit']) is not int or usage['kernel_exit'] != 0:
                raise Held('usage_unavailable')
            start = integer(usage['kernel_start'], 1, 2**64 - 1)
            rss = integer(usage['rss_bytes'], 0, 2**64 - 1)
            physical = integer(usage['physical_bytes'], 0, 2**64 - 1)
            after = identity_observer(self.process.pid)
            self.check()
            if _identity(after, self.process.pid, self.process.uid, self.process.birth) != state:
                raise Held('birth_changed')
            if self.process.kernel_start is not None and start != self.process.kernel_start:
                raise Held('birth_changed')
            owner_after = identity_observer(self.owner.creator_pid)
            self.check()
            _identity(owner_after, self.owner.creator_pid, self.owner.uid, self.owner.creator_birth)
            if rss > self.policy.rss_bytes:
                raise Held('rss_limit')
            if physical > self.policy.physical_bytes:
                raise Held('physical_limit')
            self.process = Process(self.process.pid, self.process.uid, self.process.birth, start)
            self.peak_rss, self.peak_physical = max(self.peak_rss, rss), max(self.peak_physical, physical)
            self.samples += 1
            self.status = 'metadata-observed'
            return self.receipt()
        except Held as error:
            self.hold(str(error))
        except Exception:
            self.hold('observation_unavailable')

    def receipt(self):
        return {'schema': 'temperance.model-worker-observation.v1', 'status': self.status,
            'reason': self.reason, 'samples': self.samples, 'peak_rss_bytes': self.peak_rss,
            'peak_physical_bytes': self.peak_physical, 'scope': 'injected direct-process metadata only',
            'execution_authorized': False, 'capacity_authorization': False, 'inference_verified': False,
            'resource_contained': False, 'cleanup_verified': False, 'actual_phase_role_verified': False,
            'pre_effect_proven': False, 'replay_authorized': False}

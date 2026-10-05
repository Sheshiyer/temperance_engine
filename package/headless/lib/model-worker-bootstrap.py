"""Injected bootstrap state machine only. No descriptors or processes are opened."""
import importlib.util
from pathlib import Path
import sys
import time

_spec = importlib.util.spec_from_file_location('temperance_worker_observation', Path(__file__).with_name('model-worker-observation.py'))
_observation = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = _observation
_spec.loader.exec_module(_observation)
Held = _observation.Held
closed = _observation.closed
CLEANUP_RESERVE_NS = 500_000_000
integer = _observation.integer
_REASONS = frozenset(('invalid_shape', 'invalid_integer', 'invalid_birth',
    'birth_unavailable', 'clock_unavailable', 'cancelled', 'deadline',
    'observation_unavailable', 'cleanup_reserve', 'child_identity_unavailable', 'child_not_stopped',
    'child_identity_changed', 'parent_close_unverified', 'release_unverified',
    'cleanup_identity_unavailable', 'cleanup_deadline'))


def finite_reason(error):
    args = BaseException.args.__get__(error)
    if type(args) is not tuple or len(args) != 1 or type(args[0]) is not str or len(args[0]) > 64:
        return 'adapter_unavailable'
    return args[0] if args[0] in _REASONS else 'adapter_unavailable'


def channel(value):
    closed(value, ('schema', 'status_fd', 'release_fd', 'frame_bytes', 'aggregate_bytes', 'execution_authorized'))
    if value != {'schema': 'temperance.worker-bootstrap-channel.v1', 'status_fd': 5,
                 'release_fd': 6, 'frame_bytes': 16384, 'aggregate_bytes': 32768,
                 'execution_authorized': False} or type(value['execution_authorized']) is not bool:
        raise Held('channel_invalid')
    for key in ('status_fd', 'release_fd', 'frame_bytes', 'aggregate_bytes'):
        if type(value[key]) is not int:
            raise Held('channel_invalid')


class Bootstrap:
    def __init__(self, policy, owner, channels, *, clock=time.monotonic_ns, cancelled=lambda: False):
        self.policy = _observation.Policy.parse(policy)
        self.owner = _observation.Owner.parse(owner)
        channel(channels)
        self.deadline = min(self.owner.invocation_deadline_ns, self.owner.created_ns + self.policy.wall_ns)
        self.admission_deadline = self.deadline - CLEANUP_RESERVE_NS
        self.clock, self.cancelled = clock, cancelled
        self.last_ns = None
        self.child = None
        self.status = 'retained-owner'
        self.reason = None
        self.started = False
        self.emergency_deadline = None
        self.cleanup_attempted = False
        self.check()

    def now(self):
        try:
            value = integer(self.clock(), 0, 2**63 - 1)
            if value < self.owner.created_ns or self.last_ns is not None and value < self.last_ns:
                raise Held('clock_unavailable')
            self.last_ns = value
            return value
        except Exception:
            raise Held('clock_unavailable') from None

    def check(self):
        if self.reason is not None:
            raise Held(self.reason)
        try:
            if self.cancelled() is not False:
                raise Held('cancelled')
            now = self.now()
            if now >= self.deadline:
                raise Held('deadline')
            if now >= self.admission_deadline:
                raise Held('cleanup_reserve')
        except Held:
            raise
        except Exception:
            raise Held('observation_unavailable') from None

    def observe_creator(self, adapter):
        value = adapter.observe(self.owner.creator_pid)
        _observation._identity(value, self.owner.creator_pid, self.owner.uid, self.owner.creator_birth)

    def observe_child(self, value, *, stopped):
        closed(value, ('pid', 'uid', 'birth', 'parent_pid', 'state', 'source'))
        pid = integer(value['pid'], 2, 2**31 - 1)
        uid = integer(value['uid'], 0, 2**32 - 1)
        birth = _observation.birth(value['birth'])
        if pid == self.owner.creator_pid or uid != self.owner.uid or type(value['parent_pid']) is not int or value['parent_pid'] != self.owner.creator_pid or value['source'] != 'adapter-native-observation' or value['state'] not in ('stopped', 'live'):
            raise Held('child_identity_unavailable')
        if stopped and value['state'] != 'stopped':
            raise Held('child_not_stopped')
        if self.child is not None and (pid, uid, birth) != self.child:
            raise Held('child_identity_changed')
        return (pid, uid, birth)

    def run(self, adapter):
        # Adapter is trusted owner code. This module supplies no native adapter.
        if self.started:
            raise Held('already_started')
        self.started = True  # lost ACK cannot cause another create call
        try:
            self.check()
            self.observe_creator(adapter)
            self.check()
            initial = adapter.create_stopped()
            self.child = self.observe_child(initial, stopped=True)
            self.check()
            if adapter.close_parent_channels() is not True:
                raise Held('parent_close_unverified')
            self.check()
            self.observe_creator(adapter)
            self.check()
            self.observe_child(adapter.observe(self.child[0]), stopped=True)
            self.check()
            if adapter.release(self.child[0]) is not True:
                raise Held('release_unverified')
            self.check()
            self.status = 'injected-release-observed'
        except Held as error:
            self.status, self.reason = 'held', finite_reason(error)
        except Exception:
            self.status, self.reason = 'held', 'adapter_unavailable'
        return self.receipt()

    def cleanup(self, adapter):
        # Once-only best-effort cleanup; never converts a held invocation to success.
        if self.cleanup_attempted:
            return self.receipt()
        self.cleanup_attempted = True
        self.status = 'held'
        self.reason = self.reason or 'cleanup_only'
        try:
            now = self.now()
            limit = self.deadline
            if now >= limit:
                self.emergency_deadline = min(2**63 - 1, now + 500_000_000)
                limit = self.emergency_deadline
            if self.child is None:
                raise Held('cleanup_identity_unavailable')
            self.observe_creator(adapter)
            if self.now() >= limit:
                raise Held('cleanup_deadline')
            self.observe_child(adapter.observe(self.child[0]), stopped=False)
            if self.now() >= limit:
                raise Held('cleanup_deadline')
            adapter.terminate(self.child[0])
            if self.now() >= limit:
                raise Held('cleanup_deadline')
            self.reason = 'cleanup_attempted_unverified'
        except Held as error:
            self.reason = finite_reason(error)
        except Exception:
            self.reason = 'cleanup_unavailable'
        return self.receipt()

    def receipt(self):
        return {'schema': 'temperance.worker-bootstrap-state.v1', 'status': self.status,
                'reason': self.reason, 'launch_slot_retained': True,
                'cleanup_attempted': self.cleanup_attempted,
                'emergency_cleanup': self.emergency_deadline is not None,
                'execution_authorized': False, 'capacity_authorization': False,
                'resource_contained': False, 'cleanup_verified': False,
                'actual_phase_role_verified': False, 'inference_verified': False,
                'pre_effect_proven': False, 'replay_authorized': False}

"""Cooperative pinned issuer bridge. No native observation or endpoint operations."""
import os
import re
from types import MappingProxyType

ISSUER_SHA = '4b045df96903c37c4f939b2102858837a740123f82f3a1104dbd0d20f5cee1e1'
FLAGS = ('execution_authorized', 'capacity_authorization', 'inference_authorized')
RECEIPT_KEYS = {'schema', 'operation', 'status', 'nonce', 'counter', 'launch_limit', *FLAGS}
REASONS = {'metadata_invalid', 'clock_unavailable', 'deadline', 'owner_changed', 'issuer_unavailable', 'receipt_invalid', 'preparation_unavailable'}

class Held(Exception):
    pass

def integer(v, lo, hi):
    if type(v) is not int or not lo <= v <= hi:
        raise Held('metadata_invalid')
    return v

def closed(v, keys):
    if type(v) is not dict or len(v) != len(keys) or any(type(k) is not str or len(k) > 64 for k in v) or set(v) != keys:
        raise Held('metadata_invalid')

def creator(v):
    closed(v, {'pid', 'uid', 'birth', 'kernel_start_token'})
    integer(v['pid'], 2, 2**31-1); integer(v['uid'], 0, 2**32-1)
    integer(v['kernel_start_token'], 1, 2**63-1)
    b = v['birth']
    if type(b) is not str or len(b) > 48:
        raise Held('metadata_invalid')
    m = re.fullmatch(r'darwin:([0-9]{1,20}):([0-9]{1,20})', b)
    if m is None or int(m[1]) <= 0 or int(m[2]) >= 1000000:
        raise Held('metadata_invalid')
    return MappingProxyType(dict(v))

class SharedClock:
    """Trusted constructor callback, identical object used by issuer and caller."""
    def __init__(self, callback):
        self.callback = callback; self.last = None; self.first = None; self.failed = False
    def __call__(self):
        if self.failed:
            raise Held('clock_unavailable')
        try:
            now = self.callback()
            if type(now) is not int or not 0 <= now <= 2**63-1 or self.last is not None and now < self.last:
                raise Held('clock_unavailable')
            self.last = now
            if self.first is None: self.first = now
            return now
        except Exception:
            self.failed = True
            raise Held('clock_unavailable') from None

class Bridge:
    def __init__(self, issuer_module, issuer_sha, owner, clock, context, observe_creator):
        # Module and its class definitions are independently attested trusted inputs.
        if type(issuer_sha) is not str or issuer_sha != ISSUER_SHA or type(owner) is not issuer_module.LaunchBudget or type(clock) is not SharedClock or owner.deps.clock is not clock:
            raise Held('issuer_unavailable')
        closed(context, {'directory', 'creator', 'created_ns', 'invocation_deadline_ns', 'exchange_deadline_ns'})
        path = context['directory']
        if type(path) is not str or not path.startswith('/') or '\x00' in path or len(path) > 4096 or any(p in ('', '.', '..') for p in path.split('/')[1:]):
            raise Held('metadata_invalid')
        try:
            path_bytes = len(path.encode('utf8'))
            # Literal UTF8 JSON: reserve1024bytes for all fixed bounded
            # keys/creator/numbers; control/quote/backslash escape overhead.
            path_upper = path_bytes + sum(5 if ord(c)<32 else 1 if c in ('"', '\\') else 0 for c in path) + 2
            if path_bytes > 4096 or path_upper + 1024 > 16384: raise Held('metadata_invalid')
        except UnicodeError: raise Held('metadata_invalid') from None
        c = creator(context['creator'])
        if c['pid'] != os.getpid() or c['uid'] != os.getuid(): raise Held('owner_changed')
        created = integer(context['created_ns'], 0, 2**63-1)
        if clock.first != created: raise Held('clock_unavailable')
        invocation = integer(context['invocation_deadline_ns'], 1, 2**63-1)
        exchange = integer(context['exchange_deadline_ns'], 1, 2**63-1)
        if not 0 < invocation-created <= 120_000_000_000 or not 500_000_000 < exchange-created <= 2_000_000_000 or exchange > invocation or exchange > 2**63-1-500_000_000:
            raise Held('metadata_invalid')
        # Closed input has <=4096 path bytes plus fixed bounded scalars (<16KiB).
        self.module = issuer_module; self.owner = owner; self.clock = clock
        self.path = path; self.creator = c; self.created = created; self.exchange = exchange; self.invocation = invocation
        self.observe_creator = observe_creator; self.started = False; self.reason = None
        self.results = []; self.receipts = []; self.intents = 0; self.reservations_admitted = 0
        self.preparation_attempted = False; self.preparation_completed = False; self.nonce = None
        self.check()

    def check(self):
        if self.reason: raise Held(self.reason)
        if type(self.owner) is not self.module.LaunchBudget or self.owner.deps.clock is not self.clock:
            raise Held('issuer_unavailable')
        now = self.clock()
        if now < self.created: raise Held('clock_unavailable')
        if now >= self.exchange-500_000_000: raise Held('deadline')

    def observe(self):
        self.check(); actual = creator(self.observe_creator()); self.check()
        if actual != self.creator: raise Held('owner_changed')

    def retain(self, value, count):
        # First actual returned object survives subsequent shape/freshness failures.
        self.results.append(value)
        if type(value) is not self.module.RetainedResult or type(value.handle) is not self.module._RetainedHandle or value.handle is not self.owner._latest_handle or self.owner._retained_state != 'acknowledged' or type(value.receipt) is not MappingProxyType:
            raise Held('issuer_unavailable')
        # Exact owner-published proxy backed by its closed scalar dict, not generic
        # hostile MappingProxyType backing objects. Never accepts caller receipts.
        raw = value.receipt
        if len(raw) != 9 or any(type(k) is not str or len(k) > 64 for k in raw) or set(raw) != RECEIPT_KEYS:
            raise Held('receipt_invalid')
        for v in raw.values():
            if type(v) is str:
                if len(v) > 64: raise Held('receipt_invalid')
                try:
                    if len(v.encode('utf8')) > 256: raise Held('receipt_invalid')
                except UnicodeError: raise Held('receipt_invalid') from None
            elif type(v) is int: integer(v, 0, 4)
            elif type(v) is not bool: raise Held('receipt_invalid')
        n = raw['nonce']
        if type(n) is not str or len(n) != 32 or re.fullmatch('[0-9a-f]{32}', n) is None:
            raise Held('receipt_invalid')
        if self.nonce is not None and n != self.nonce: raise Held('receipt_invalid')
        expected = dict(schema='temperance.cli-launch-budget.v1', operation='create' if count == 0 else 'reserve', status='created' if count == 0 else 'reserved', nonce=n, counter=count, launch_limit=2, **{f:False for f in FLAGS})
        if any(type(raw[k]) is not type(expected[k]) or raw[k] != expected[k] for k in RECEIPT_KEYS):
            raise Held('receipt_invalid')
        # Same writer-retained record binds issuer birth to independent creator
        # metadata. kernel_start_token is observer-only, absent from this record.
        record = self.owner._retained_record
        if type(record) is not MappingProxyType: raise Held('issuer_unavailable')
        identity = {'uid':self.creator['uid'], 'owner_pid':self.creator['pid'], 'owner_birth':self.creator['birth'], 'nonce':n, 'counter':count, 'limit':2}
        if any(type(record[k]) is not type(v) or record[k] != v for k,v in identity.items()):
            raise Held('owner_changed')
        self.nonce = n; self.receipts.append(MappingProxyType(dict(raw)))

    def run(self, prepare):
        if self.started: return self.receipt()
        self.started = True
        try:
            self.observe(); self.intents += 1
            value = self.owner.create_retained(self.path, 2, 2000, owner_pid=self.creator['pid'])
            self.retain(value, 0); self.observe()
            for count in (1, 2):
                self.observe(); self.intents += 1
                value = self.owner.reserve_retained(self.results[-1].handle)
                self.retain(value, count); self.observe(); self.reservations_admitted = count
            compact = tuple(dict(nonce=r['nonce'], counter=r['counter'], launch_limit=2) for r in self.receipts[1:])
            self.check(); self.preparation_attempted = True
            result = prepare(compact, self.created, self.exchange, self.clock)
            self.observe()
            if result is not True: raise Held('preparation_unavailable')
            self.preparation_completed = True
        except Exception as e:
            args = BaseException.args.__get__(e)
            reason = args[0] if type(args) is tuple and len(args) == 1 and type(args[0]) is str and len(args[0]) <= 64 and args[0] in REASONS else 'issuer_unavailable'
            self.reason = self.reason or reason
        return self.receipt()

    def receipt(self):
        return dict(schema='temperance.retained-capability-bridge.v1', status='held' if self.reason else 'prepared-mock' if self.preparation_completed else 'pending', reason=self.reason, owner_operation_intents=self.intents, first_results_retained=len(self.results), reservations_admitted=self.reservations_admitted, preparation_attempted=self.preparation_attempted, preparation_completed=self.preparation_completed, native_authentication=False, execution_authorized=False, capacity_authorization=False, inference_authorized=False)

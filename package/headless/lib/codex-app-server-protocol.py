"""Pure conservative Codex0.147 protocol profile. No transport or execution authority."""
import json
import math
import time

MAX_FRAME = 1024 * 1024
MAX_TOTAL = 8 * MAX_FRAME
MAX_DEPTH = 32
MAX_TOKENS = 131072
MAX_NODES = 65536
MAX_ITEMS = 4096
MAX_PENDING = 8
MAX_TEXT = 256 * 1024
VERSION = '0.147.0'


class Held(Exception):
    pass


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise Held('duplicate_key')
        result[key] = value
    return result


def _plain(value, depth=0, budget=None):
    if budget is None:
        budget = [MAX_NODES]
    budget[0] -= 1
    if budget[0] < 0 or depth > MAX_DEPTH:
        raise Held('value_bound')
    if type(value) is dict:
        if any(type(k) is not str for k in value):
            raise Held('invalid_value')
        return {k: _plain(v, depth + 1, budget) for k, v in value.items()}
    if type(value) is list:
        return [_plain(v, depth + 1, budget) for v in value]
    if type(value) is str:
        if len(value) > MAX_FRAME or len(value.encode('utf8')) > MAX_FRAME:
            raise Held('value_bound')
        return value
    if type(value) is int:
        if not -(2**63) <= value < 2**63:
            raise Held('value_bound')
        return value
    if value is None or type(value) is bool:
        return value
    if type(value) is float and math.isfinite(value):
        return value
    raise Held('invalid_value')


def decode(raw):
    if type(raw) is not bytes or not 0 < len(raw) <= MAX_FRAME:
        raise Held('frame_bound')
    try:
        text = raw.decode('utf8', errors='strict')
    except UnicodeError:
        raise Held('invalid_utf8') from None
    depth = tokens = 0
    quoted = escaped = False
    for char in text:
        if quoted:
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == '"':
                quoted = False
        else:
            if not char.isspace():
                tokens += 1
            if char == '"':
                quoted = True
            elif char in '[{':
                depth += 1
                if depth > MAX_DEPTH:
                    raise Held('depth_bound')
            elif char in ']}':
                depth -= 1
            if tokens > MAX_TOKENS:
                raise Held('token_bound')
    try:
        return _plain(json.loads(text, object_pairs_hook=_pairs,
            parse_constant=lambda _: (_ for _ in ()).throw(Held('invalid_number'))))
    except Held:
        raise
    except Exception:
        raise Held('malformed_json') from None


def encode(value):
    value = _plain(value)
    try:
        raw = json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf8')
    except Exception:
        raise Held('invalid_value') from None
    if len(raw) > MAX_FRAME:
        raise Held('frame_bound')
    return raw


def closed(value, required, optional=()):
    if type(value) is not dict or not set(required) <= value.keys() or value.keys() - set(required) - set(optional):
        raise Held('unsupported_shape')


def string(value, cap=4096):
    if type(value) is not str or not value or len(value) > cap or len(value.encode('utf8')) > cap:
        raise Held('invalid_string')
    return value


def same(a, b):
    if type(a) is not type(b):
        return False
    if type(a) is dict:
        return a.keys() == b.keys() and all(same(a[k], b[k]) for k in a)
    if type(a) is list:
        return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    return a == b


def turn(value):
    closed(value, ('id', 'items', 'itemsView', 'status', 'error', 'startedAt', 'completedAt', 'durationMs'))
    string(value['id'], 128)
    if value['status'] not in ('inProgress', 'completed', 'failed', 'interrupted') or value['itemsView'] not in ('notLoaded', 'summary', 'full'):
        raise Held('invalid_turn')
    if type(value['items']) is not list or len(value['items']) > MAX_ITEMS:
        raise Held('item_bound')
    if value['itemsView'] == 'notLoaded' and value['items']:
        raise Held('invalid_turn')
    for key in ('startedAt', 'completedAt', 'durationMs'):
        if value[key] is not None and (type(value[key]) is not int or value[key] < 0):
            raise Held('invalid_turn')
    if value['status'] == 'failed':
        closed(value['error'], ('message', 'codexErrorInfo', 'additionalDetails'))
        string(value['error']['message'], MAX_TEXT)
        if value['error']['additionalDetails'] is not None:
            string(value['error']['additionalDetails'], MAX_TEXT)
    elif value['error'] is not None:
        raise Held('invalid_turn')
    seen = set()
    for item in value['items']:
        if type(item) is not dict or type(item.get('type')) is not str:
            raise Held('invalid_item')
        kind = item['type']
        if kind == 'agentMessage':
            closed(item, ('type', 'id', 'text', 'phase', 'memoryCitation'))
            if type(item['text']) is not str or len(item['text'].encode('utf8')) > MAX_TEXT or item['phase'] not in (None, 'commentary', 'final_answer'):
                raise Held('invalid_item')
        elif kind == 'plan':
            closed(item, ('type', 'id', 'text'))
            if type(item['text']) is not str or len(item['text'].encode('utf8')) > MAX_TEXT:
                raise Held('invalid_item')
        elif kind not in ('userMessage', 'hookPrompt', 'reasoning', 'commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'collabAgentToolCall', 'subAgentActivity', 'webSearch', 'imageView', 'sleep', 'imageGeneration', 'enteredReviewMode', 'exitedReviewMode', 'contextCompaction'):
            raise Held('unsupported_item')
        # Non-result item payloads are bounded opaque history, not action proof.
        item_id = string(item.get('id'), 128)
        if item_id in seen:
            raise Held('duplicate_item')
        seen.add(item_id)
    return value


class Protocol:
    def __init__(self, expected, *, deadline, clock=time.monotonic, cancelled=lambda: False):
        self.clock, self.cancelled, self.deadline = clock, cancelled, deadline
        self.state = 'new'
        self.reason = None
        self.total = 0
        self.pending = []
        self.thread_id = self.session_id = self.turn_id = self.terminal = None
        self.final_text = None
        self.final_kind = None
        self.last_clock = None
        self.expected = _plain(expected)
        closed(self.expected, ('codexHome', 'model', 'modelProvider', 'cwd', 'approvalPolicy', 'sandbox', 'input'))
        for key in ('codexHome', 'model', 'modelProvider', 'cwd', 'approvalPolicy'):
            string(self.expected[key])
        if self.expected['approvalPolicy'] not in ('never', 'on-request', 'untrusted'):
            raise Held('unsupported_policy')
        sandbox = self.expected['sandbox']
        closed(sandbox, ('type', 'networkAccess'))
        if sandbox['type'] != 'readOnly' or type(sandbox['networkAccess']) is not bool:
            raise Held('unsupported_policy')
        # First bootstrap is read-only. Build permission widening needs a separate join.
        if type(self.expected['input']) is not list or len(self.expected['input']) != 1:
            raise Held('unsupported_input')
        closed(self.expected['input'][0], ('type', 'text', 'text_elements'))
        item = self.expected['input'][0]
        if item['type'] != 'text' or item['text_elements'] != []:
            raise Held('unsupported_input')
        string(item['text'], MAX_TEXT)
        self.check()
        if type(deadline) not in (float, int) or not math.isfinite(deadline) or deadline > self.last_clock + 120:
            self.hold('invalid_deadline')

    def hold(self, reason):
        self.state, self.reason = 'held', reason
        self.pending.clear()
        self.final_text = self.final_kind = None
        raise Held(reason)

    def check(self):
        if self.state == 'held':
            raise Held(self.reason)
        try:
            cancel = self.cancelled()
            now = self.clock()
            if type(now) not in (float, int) or not math.isfinite(now) or self.last_clock is not None and now < self.last_clock:
                self.hold('clock_unavailable')
            self.last_clock = now
            if cancel is not False:
                self.hold('cancelled')
            if now >= self.deadline:
                self.hold('deadline')
        except Held:
            raise
        except Exception:
            self.hold('clock_unavailable')

    def request(self, method):
        self.check()
        e = self.expected
        rules = {
            'initialize': ('new', 'initializing', 1, {'clientInfo': {'name': 'temperance_protocol_fixture', 'title': 'Temperance protocol bootstrap', 'version': '1'}, 'capabilities': None}),
            'initialized': ('initialized-response', 'thread-ready', None, {}),
            'thread/start': ('thread-ready', 'thread-starting', 2, {'model': e['model'], 'modelProvider': e['modelProvider'], 'cwd': e['cwd'], 'approvalPolicy': e['approvalPolicy'], 'sandbox': 'read-only', 'ephemeral': False}),
            'turn/start': ('turn-ready', 'turn-starting', 3, {'threadId': self.thread_id, 'input': e['input']}),
            'thread/read': ('terminal', 'reading', 4, {'threadId': self.thread_id, 'includeTurns': True}),
        }
        if method not in rules or self.state != rules[method][0]:
            self.hold('invalid_transition')
        _, state, request_id, params = rules[method]
        message = {'method': method, 'params': params}
        if request_id is not None:
            message['id'] = request_id
        # Mark before returning: uncertain transport delivery never permits another send.
        self.state = state
        try:
            result = encode(message)
            self.check()
            return result
        except Held as error:
            self.hold(str(error))

    def lost_response(self):
        self.hold('submission_uncertain')

    def accept(self, raw):
        self.check()
        if type(raw) is not bytes:
            self.hold('frame_bound')
        self.total += len(raw)
        if self.total > MAX_TOTAL:
            self.hold('aggregate_bound')
        try:
            message = decode(raw)
            response = self._accept(message)
            self.check()
            return response
        except Held as error:
            self.hold(str(error))
        except Exception:
            self.hold('invalid_message')

    def _terminal(self, params):
        closed(params, ('threadId', 'turn'))
        if params['threadId'] != self.thread_id:
            raise Held('identity_mismatch')
        value = turn(params['turn'])
        if value['id'] != self.turn_id or value['status'] == 'inProgress' or self.terminal is not None:
            raise Held('identity_mismatch')
        self.terminal = value
        self.state = 'terminal'

    def _started(self, params):
        closed(params, ('threadId', 'turn'))
        current = turn(params['turn'])
        if self.state != 'turn-running' or params['threadId'] != self.thread_id or current['id'] != self.turn_id or current['status'] != 'inProgress':
            raise Held('identity_mismatch')

    def _accept(self, message):
        if type(message) is not dict:
            raise Held('unsupported_shape')
        if 'method' in message:
            if 'id' in message:
                closed(message, ('method', 'id', 'params'))
                if type(message['id']) not in (int, str) or type(message['id']) is bool:
                    raise Held('invalid_request_id')
                # Unsupported server requests never obtain acceptance or policy amendments.
                raise Held('unsupported_server_request')
            closed(message, ('method', 'params'))
            method = message['method']
            if method == 'thread/started':
                closed(message['params'], ('thread',))
                self._thread(message['params']['thread'])
                if self.state == 'thread-starting':
                    if len(self.pending) >= MAX_PENDING:
                        raise Held('pending_bound')
                    self.pending.append((method, message['params']))
                elif self.thread_id != message['params']['thread']['id'] or self.session_id != message['params']['thread']['sessionId']:
                    raise Held('identity_mismatch')
                return None
            if method not in ('turn/started', 'turn/completed'):
                raise Held('unsupported_notification')
            if self.state == 'turn-starting':
                closed(message['params'], ('threadId', 'turn'))
                if message['params']['threadId'] != self.thread_id:
                    raise Held('identity_mismatch')
                turn(message['params']['turn'])
                if len(self.pending) >= MAX_PENDING:
                    raise Held('pending_bound')
                self.pending.append((method, message['params']))
                return None
            if self.state != 'turn-running':
                raise Held('invalid_transition')
            if method == 'turn/completed':
                self._terminal(message['params'])
            else:
                self._started(message['params'])
            return None
        closed(message, ('id',), ('result', 'error'))
        if type(message['id']) is not int or ('result' in message) == ('error' in message):
            raise Held('invalid_response')
        ids = {'initializing': 1, 'thread-starting': 2, 'turn-starting': 3, 'reading': 4}
        if message['id'] != ids.get(self.state):
            raise Held('identity_mismatch')
        if 'error' in message:
            raise Held('request_failed')
        value = message['result']
        if self.state == 'initializing':
            closed(value, ('userAgent', 'codexHome', 'platformFamily', 'platformOs'))
            for key in value:
                string(value[key])
            if value['codexHome'] != self.expected['codexHome']:
                raise Held('parameter_mismatch')
            self.state = 'initialized-response'
        elif self.state == 'thread-starting':
            closed(value, ('thread', 'model', 'modelProvider', 'serviceTier', 'cwd', 'instructionSources', 'approvalPolicy', 'approvalsReviewer', 'sandbox', 'reasoningEffort'))
            for key in ('model', 'modelProvider', 'cwd', 'approvalPolicy', 'sandbox'):
                if not same(value[key], self.expected[key]):
                    raise Held('parameter_mismatch')
            thread = value['thread']
            self._thread(thread)
            self.thread_id, self.session_id = thread['id'], thread['sessionId']
            if thread['turns']:
                raise Held('unexpected_history')
            pending, self.pending = self.pending, []
            for method, params in pending:
                if method != 'thread/started' or params['thread']['id'] != self.thread_id or params['thread']['sessionId'] != self.session_id:
                    raise Held('identity_mismatch')
            self.state = 'turn-ready'
        elif self.state == 'turn-starting':
            closed(value, ('turn',))
            current = turn(value['turn'])
            if current['status'] != 'inProgress':
                raise Held('invalid_start_response')
            self.turn_id = current['id']
            self.state = 'turn-running'
            pending, self.pending = self.pending, []
            for method, params in pending:
                if method == 'turn/completed':
                    self._terminal(params)
                else:
                    self._started(params)
        else:
            closed(value, ('thread',))
            thread = value['thread']
            self._thread(thread)
            if thread['id'] != self.thread_id or thread['sessionId'] != self.session_id:
                raise Held('identity_mismatch')
            matches = [t for t in thread['turns'] if t.get('id') == self.turn_id]
            if len(matches) != 1:
                raise Held('identity_mismatch')
            current = turn(matches[0])
            if current['itemsView'] != 'full' or current['status'] != self.terminal['status'] or not same(current['error'], self.terminal['error']):
                raise Held('incomplete_history')
            if current['status'] != 'completed':
                self.state, self.reason = 'unsuccessful', current['status']
                return None
            messages = [i for i in current['items'] if i['type'] == 'agentMessage']
            plans = [i for i in current['items'] if i['type'] == 'plan']
            selected = messages[-1] if messages else plans[-1] if plans else None
            summaries = [i for i in self.terminal['items'] if i['type'] == 'agentMessage']
            if summaries and (not messages or summaries[-1]['text'] != messages[-1]['text']):
                raise Held('summary_mismatch')
            if selected is None:
                raise Held('final_unavailable')
            self.final_text, self.final_kind = selected['text'], selected['type']
            self.state = 'completed-history'
        return None

    def _thread(self, value):
        # Validate identity-bearing subset; other bounded schema fields remain opaque.
        if type(value) is not dict or not {'id', 'sessionId', 'ephemeral', 'modelProvider', 'cwd', 'cliVersion', 'turns'} <= value.keys():
            raise Held('invalid_thread')
        string(value['id'], 128)
        string(value['sessionId'], 128)
        if value['ephemeral'] is not False or value['modelProvider'] != self.expected['modelProvider'] or value['cwd'] != self.expected['cwd'] or value['cliVersion'] != VERSION:
            raise Held('parameter_mismatch')
        if type(value['turns']) is not list or len(value['turns']) > MAX_ITEMS:
            raise Held('item_bound')

    def receipt(self):
        return {'schema': 'temperance.codex-app-server-protocol.v1', 'version': VERSION,
            'status': self.state, 'reason': self.reason, 'incoming_bytes': self.total,
            'history_scope': 'available persisted history only',
            'execution_authorized': False, 'capacity_authorization': False,
            'actual_phase_role_verified': False, 'pre_effect_proven': False,
            'replay_authorized': False}

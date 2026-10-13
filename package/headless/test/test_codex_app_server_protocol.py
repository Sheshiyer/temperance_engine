import copy
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('protocol', Path(__file__).resolve().parents[1] / 'lib/codex-app-server-protocol.py')
p = importlib.util.module_from_spec(spec); spec.loader.exec_module(p)


def wire(value):
    return json.dumps(value, separators=(',', ':')).encode()


def agent(text='answer', phase=None, id='message-1'):
    return {'type': 'agentMessage', 'id': id, 'text': text, 'phase': phase, 'memoryCitation': None}


def turn(status='inProgress', view='notLoaded', items=None, id='turn-1'):
    return {'id': id, 'items': items or [], 'itemsView': view, 'status': status,
        'error': {'message': 'failed', 'codexErrorInfo': None, 'additionalDetails': None} if status == 'failed' else None,
        'startedAt': 12, 'completedAt': None if status == 'inProgress' else 13, 'durationMs': None}


def thread(turns=None):
    # Actual0.147 schema casing, including nullable/optional metadata.
    return {'id': 'thread-1', 'sessionId': 'session-1', 'forkedFromId': None,
        'parentThreadId': None, 'preview': '', 'ephemeral': False, 'section': None,
        'sectionEnteredAt': None, 'modelProvider': 'omniroute', 'createdAt': 12,
        'updatedAt': 13, 'recencyAt': None, 'status': {'type': 'idle'}, 'path': '/private/fixture/rollout',
        'cwd': '/private/fixture/workspace', 'cliVersion': '0.147.0', 'source': 'appServer',
        'threadSource': None, 'agentNickname': None, 'agentRole': None, 'gitInfo': None,
        'name': None, 'turns': turns or []}


class ProtocolTests(unittest.TestCase):
    def new(self):
        self.now = [10.]
        return p.Protocol({'codexHome': '/private/fixture/home', 'model': 'noesis-build',
            'modelProvider': 'omniroute', 'cwd': '/private/fixture/workspace',
            'approvalPolicy': 'never', 'sandbox': {'type': 'readOnly', 'networkAccess': False},
            'input': [{'type': 'text', 'text': 'synthetic fixture', 'text_elements': []}]},
            deadline=30., clock=lambda: self.now[0])

    def ready(self):
        state = self.new()
        self.assertEqual(json.loads(state.request('initialize'))['id'], 1)
        state.accept(wire({'id': 1, 'result': {'userAgent': 'codex/0.147.0', 'codexHome': '/private/fixture/home', 'platformFamily': 'unix', 'platformOs': 'macos'}}))
        self.assertNotIn('id', json.loads(state.request('initialized')))
        state.request('thread/start')
        state.accept(wire({'method':'thread/started','params':{'thread':thread()}}))
        state.accept(wire({'id': 2, 'result': {'thread': thread(), 'model': 'noesis-build',
            'modelProvider': 'omniroute', 'serviceTier': None, 'cwd': '/private/fixture/workspace',
            'instructionSources': [], 'approvalPolicy': 'never', 'approvalsReviewer': 'user',
            'sandbox': {'type': 'readOnly', 'networkAccess': False}, 'reasoningEffort': None}}))
        state.request('turn/start')
        return state

    def running(self):
        state = self.ready()
        state.accept(wire({'id': 3, 'result': {'turn': turn()}}))
        return state

    def terminal(self, state, status='completed', items=None, view='summary'):
        state.accept(wire({'method': 'turn/completed', 'params': {'threadId': 'thread-1', 'turn': turn(status, view, items)}}))

    def read(self, state, status='completed', items=None, view='full'):
        request = json.loads(state.request('thread/read'))
        self.assertEqual(request['params'], {'threadId': 'thread-1', 'includeTurns': True})
        state.accept(wire({'id': 4, 'result': {'thread': thread([turn(status, view, items)])}}))

    def test_full_final_and_all_false(self):
        state = self.running()
        self.terminal(state, items=[agent()])
        self.read(state, items=[agent('intermediate', 'commentary', 'message-0'), agent()])
        self.assertEqual(state.final_text, 'answer')
        self.assertEqual(state.state, 'completed-history')
        self.assertTrue(all(v is False for k,v in state.receipt().items() if k.endswith(('authorized','authorization','verified','proven'))))
        self.assertNotIn('answer', str(state.receipt()))

    def test_plan_fallback_and_empty_final(self):
        state = self.running(); self.terminal(state, view='notLoaded')
        self.read(state, items=[{'type': 'plan', 'id': 'plan-1', 'text': 'plan'}])
        self.assertEqual((state.final_text, state.final_kind), ('plan','plan'))
        state = self.running(); self.terminal(state, items=[agent('')]);self.read(state, items=[agent('')])
        self.assertEqual(state.final_text, '')

    def test_failed_and_interrupted_not_success(self):
        for status in ('failed', 'interrupted'):
            state = self.running();self.terminal(state,status,view='notLoaded');self.read(state,status)
            self.assertEqual(state.state,'unsuccessful');self.assertIsNone(state.final_text)

    def test_terminal_before_response_retained_not_promoted(self):
        state = self.ready();self.terminal(state,items=[agent()])
        self.assertEqual(state.state,'turn-starting');self.assertIsNone(state.turn_id)
        state.accept(wire({'id':3,'result':{'turn':turn()}}))
        self.read(state,items=[agent()]);self.assertEqual(state.state,'completed-history')

    def test_turn_started_response_race(self):
        state=self.ready()
        state.accept(wire({'method':'turn/started','params':{'threadId':'thread-1','turn':turn()}}))
        self.terminal(state,items=[agent()])
        state.accept(wire({'id':3,'result':{'turn':turn()}}))
        self.read(state,items=[agent()])
        self.assertEqual(state.state,'completed-history')

    def test_lost_ack_never_resubmits(self):
        state = self.ready();self.terminal(state,items=[agent()])
        with self.assertRaises(p.Held):state.lost_response()
        with self.assertRaises(p.Held):state.request('turn/start')
        self.assertEqual(state.reason,'submission_uncertain');self.assertEqual(state.pending,[])

    def test_wrong_response_terminal_or_readback_identity(self):
        state=self.ready()
        with self.assertRaises(p.Held):state.accept(wire({'id':9,'result':{'turn':turn()}}))
        state=self.running()
        with self.assertRaises(p.Held):state.accept(wire({'method':'turn/completed','params':{'threadId':'other','turn':turn('completed')}}))
        state=self.ready();self.terminal(state,items=[agent()])
        with self.assertRaises(p.Held):state.accept(wire({'id':3,'result':{'turn':turn(id='other')}}))
        state=self.running();self.terminal(state,items=[agent()]);state.request('thread/read')
        with self.assertRaises(p.Held):state.accept(wire({'id':4,'result':{'thread':thread([turn('completed','full',[agent()],id='other')])}}))

    def test_changed_session_readback_or_started_holds(self):
        state=self.running();self.terminal(state,items=[agent()]);state.request('thread/read')
        changed=thread([turn('completed','full',[agent()])]);changed['sessionId']='different-session'
        with self.assertRaises(p.Held):state.accept(wire({'id':4,'result':{'thread':changed}}))
        self.assertEqual(state.reason,'identity_mismatch')
        state=self.running();changed=thread();changed['sessionId']='different-session'
        with self.assertRaises(p.Held):state.accept(wire({'method':'thread/started','params':{'thread':changed}}))
        self.assertEqual(state.reason,'identity_mismatch')

    def test_summary_history_and_conflicting_summary_hold(self):
        state=self.running();self.terminal(state,items=[agent()])
        with self.assertRaises(p.Held):self.read(state,items=[agent()],view='summary')
        state=self.running();self.terminal(state,items=[agent()])
        with self.assertRaises(p.Held):self.read(state,items=[agent('different')])

    def test_unknown_approval_never_accepted(self):
        state=self.running()
        with self.assertRaises(p.Held):state.accept(wire({'id':27,'method':'item/commandExecution/requestApproval','params':{'threadId':'thread-1'}}))
        self.assertEqual(state.reason,'unsupported_server_request')
        with self.assertRaises(p.Held):state.request('turn/start')

    def test_deadline_cancel_and_no_renewal(self):
        state=self.running();self.now[0]=31
        with self.assertRaises(p.Held):state.request('thread/read')
        self.assertEqual(state.reason,'deadline')
        state=self.running();state.cancelled=lambda:True
        with self.assertRaises(p.Held):self.terminal(state)
        self.assertEqual(state.reason,'cancelled')

    def test_parameter_parity_and_history_item_bound(self):
        state=self.new();state.request('initialize')
        with self.assertRaises(p.Held):state.accept(wire({'id':1,'result':{'userAgent':'fixture','codexHome':'/other','platformFamily':'unix','platformOs':'macos'}}))
        state=self.ready()
        self.assertEqual(state.state,'turn-starting')
        value=turn('completed','full',[agent(),agent()])
        with self.assertRaises(p.Held):p.turn(value)
        value=turn('completed','full',[{'type':'plan','id':str(i),'text':'x'} for i in range(p.MAX_ITEMS+1)])
        with self.assertRaises(p.Held):p.turn(value)
        self.assertFalse(p.same({'networkAccess':False},{'networkAccess':0}))

    def test_decoder_bounds_and_duplicates(self):
        for raw in (b'{"id":1,"id":2}', b'{"item":{"type":"commandExecution","type":"agentMessage"}}', b'\xff', b'['*33+b']'*33, b'x'*(p.MAX_FRAME+1), b'{"n":NaN}'):
            with self.assertRaises(p.Held):p.decode(raw)
        with self.assertRaises(p.Held):p.decode(b'['+b'0,'*p.MAX_TOKENS+b'0]')

    def test_pending_and_aggregate_bounds(self):
        state=self.ready()
        for _ in range(p.MAX_PENDING):self.terminal(state,items=[agent()])
        with self.assertRaises(p.Held):self.terminal(state,items=[agent()])
        self.assertEqual(state.reason,'pending_bound')
        state=self.new();state.total=p.MAX_TOTAL
        with self.assertRaises(p.Held):state.accept(b'{}')
        self.assertEqual(state.reason,'aggregate_bound')

    def test_unknown_item_and_invalid_failed_terminal(self):
        state=self.running()
        with self.assertRaises(p.Held):self.terminal(state,items=[{'type':'futureTool','id':'x'}])
        value=turn('failed');value['error']=None
        with self.assertRaises(p.Held):p.turn(value)

if __name__=='__main__':unittest.main()

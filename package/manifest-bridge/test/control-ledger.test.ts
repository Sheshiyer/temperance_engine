import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { SwarmControlLedger, type ApprovedDispatch, type ClaimRequest } from '../src/control-ledger';

const url = process.env.TEMPERANCE_CONTROL_DATABASE_URL;
const control = url ? describe.serial : describe.skip;
let pool: Pool;
let ledger: SwarmControlLedger;

const approval = (overrides: Partial<ApprovedDispatch> = {}): ApprovedDispatch => ({
  approval_id: 'apr-test', project_id: 'project-test', project_cwd: '/tmp/project-test', plan_id: 'plan-test', option_id: 'opt-test',
  policy_hash: 'policy-test', git_head: 'head-test', source_fingerprint: 'source-test', task_fingerprint: 'tasks-test',
  scope_hash: 'a'.repeat(64),
  combo: 'te-dispatch-paid', concurrency: 2, worktree_required: true, expires_at: new Date(Date.now() + 60_000).toISOString(), ...overrides,
});
const request = (overrides: Partial<ClaimRequest> = {}): ClaimRequest => ({ ...approval(), quota_observed_at: new Date().toISOString(), quota_eligible: true, ...overrides });

const attestation = (overrides: Record<string, unknown> = {}) => ({
  schema: 'temperance.approval-attestation.request.v1',
  approval_id: 'apr-test',
  project_id: 'project-test',
  project_cwd: '/tmp/project-test',
  plan_id: 'plan-test',
  option_id: 'opt-test',
  policy_hash: 'policy-test',
  git_head: 'head-test',
  source_fingerprint: 'source-test',
  task_fingerprint: 'tasks-test',
  scope_hash: 'a'.repeat(64),
  ...overrides,
});

type ControlSnapshot = {
  counts: Record<string, number>;
  fingerprint: string;
};

async function controlSnapshot(): Promise<ControlSnapshot> {
  const tables = [
    ['approvals', 'temperance_swarm_approvals', 'approval_id'],
    ['claims', 'temperance_swarm_claims', 'claim_id'],
    ['outbox', 'temperance_swarm_outbox', 'outbox_id'],
    ['receipts', 'temperance_swarm_task_receipts', 'claim_id, task_id'],
  ] as const;
  const counts: Record<string, number> = {};
  const rows: Record<string, unknown[]> = {};
  for (const [name, table, order] of tables) {
    const result = await pool.query(`SELECT * FROM ${table} ORDER BY ${order}`);
    counts[name] = result.rowCount ?? result.rows.length;
    rows[name] = result.rows;
  }
  return {
    counts,
    fingerprint: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
  };
}

async function attest(input: unknown, approvalId?: string): Promise<Record<string, unknown>> {
  return await (ledger as unknown as { attest(value: unknown, canonicalApprovalId?: string): Promise<Record<string, unknown>> }).attest(input, approvalId);
}

control('PostgreSQL swarm control ledger', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    ledger = new SwarmControlLedger(pool, 60_000, 60_000);
    await ledger.migrate();
  });
  afterAll(async () => { await ledger.close(); });
  beforeEach(async () => { await pool.query('TRUNCATE temperance_swarm_outbox, temperance_swarm_task_receipts, temperance_swarm_claims, temperance_swarm_approvals'); });

  test('permits exactly one concurrent approval claim and one outbox event', async () => {
    await ledger.recordApproval(approval());
    const secondLedger = new SwarmControlLedger(new Pool({ connectionString: url }), 60_000, 60_000);
    const [first, second] = await Promise.all([ledger.claim(request()), secondLedger.claim(request())]);
    await secondLedger.close();
    expect([first, second].filter((result) => result.ok)).toHaveLength(1);
    expect([first, second].filter((result) => !result.ok && result.code === 'claimed')).toHaveLength(1);
    expect(Number((await pool.query('SELECT count(*)::int AS count FROM temperance_swarm_claims')).rows[0].count)).toBe(1);
    expect(Number((await pool.query('SELECT count(*)::int AS count FROM temperance_swarm_outbox')).rows[0].count)).toBe(1);
  });

  test('rejects expiry, immutable drift, and stale or ineligible quota before creating a claim', async () => {
    await ledger.recordApproval(approval({ approval_id: 'apr-expired', expires_at: new Date(Date.now() - 1).toISOString() }));
    expect((await ledger.claim(request({ approval_id: 'apr-expired', expires_at: new Date(Date.now() - 1).toISOString() }))).code).toBe('expired');
    await ledger.recordApproval(approval({ approval_id: 'apr-drift' }));
    expect((await ledger.claim(request({ approval_id: 'apr-drift', git_head: 'changed-head' }))).code).toBe('drift');
    await ledger.recordApproval(approval({ approval_id: 'apr-quota' }));
    expect((await ledger.claim(request({ approval_id: 'apr-quota', quota_observed_at: new Date(Date.now() - 61_000).toISOString() }))).code).toBe('quota');
    await ledger.recordApproval(approval({ approval_id: 'apr-ineligible' }));
    expect((await ledger.claim(request({ approval_id: 'apr-ineligible', quota_eligible: false }))).code).toBe('quota');
    expect(Number((await pool.query('SELECT count(*)::int AS count FROM temperance_swarm_claims')).rows[0].count)).toBe(0);
  });

  test('cancellation prevents outbox delivery after a successful claim', async () => {
    await ledger.recordApproval(approval());
    const claimed = await ledger.claim(request());
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) throw new Error('claim unexpectedly rejected');
    expect(await ledger.readyOutbox(claimed.claim_id)).not.toBeNull();
    expect(await ledger.cancel(claimed.claim_id, 'operator cancelled')).toBe(true);
    expect(await ledger.readyOutbox(claimed.claim_id)).toBeNull();
  });

  test('denies unavailable storage and absent canonical approvals with bounded codes', async () => {
    const unavailablePool = new Pool({ connectionString: 'postgresql://invalid:invalid@127.0.0.1:1/temperance_control_test', connectionTimeoutMillis: 100 });
    const unavailableLedger = new SwarmControlLedger(unavailablePool, 60_000, 60_000);
    const unavailable = await (unavailableLedger as unknown as { attest(value: unknown): Promise<Record<string, unknown>> }).attest(attestation());
    await unavailableLedger.close();
    expect(unavailable).toEqual({ schema: 'temperance.approval-attestation.response.v1', ok: false, code: 'control_unavailable' });
    expect(await attest(attestation())).toEqual({ schema: 'temperance.approval-attestation.response.v1', ok: false, code: 'approval_missing' });
  });

  test('rejects malformed requests and malformed canonical rows without disclosure', async () => {
    const malformedRequests: unknown[] = [
      null,
      {},
      { ...attestation(), schema: 'wrong' },
      { ...attestation(), project_id: '' },
      { ...attestation(), scope_hash: 'A'.repeat(64) },
      { ...attestation(), scope_hash: 'a'.repeat(63) },
      { ...attestation(), extra: 'not-closed' },
    ];
    for (const malformed of malformedRequests) {
      expect(await attest(malformed)).toEqual({ schema: 'temperance.approval-attestation.response.v1', ok: false, code: 'invalid_request' });
    }

    await ledger.recordApproval(approval({ approval_id: 'apr-malformed' }));
    await pool.query("UPDATE temperance_swarm_approvals SET project_id = '' WHERE approval_id = 'apr-malformed'");
    expect(await attest(attestation({ approval_id: 'apr-malformed' }))).toEqual({ schema: 'temperance.approval-attestation.response.v1', ok: false, code: 'approval_malformed' });

    await ledger.recordApproval(approval({ approval_id: 'apr-legacy' }));
    await pool.query("UPDATE temperance_swarm_approvals SET scope_hash = NULL WHERE approval_id = 'apr-legacy'");
    expect(await attest(attestation({ approval_id: 'apr-legacy' }))).toEqual({ schema: 'temperance.approval-attestation.response.v1', ok: false, code: 'approval_malformed' });
  });

  test('uses database-owned time and rejects every non-granted approval state', async () => {
    await ledger.recordApproval(approval({ approval_id: 'apr-expired-time', expires_at: '2999-01-01T00:00:00.000Z' }));
    await pool.query("UPDATE temperance_swarm_approvals SET expires_at = now() - interval '1 millisecond' WHERE approval_id = 'apr-expired-time'");
    expect(await attest(attestation({ approval_id: 'apr-expired-time' }))).toEqual({ schema: 'temperance.approval-attestation.response.v1', ok: false, code: 'approval_expired' });

    const states = [
      ['revoked', 'approval_revoked'],
      ['claimed', 'approval_consumed'],
      ['expired', 'approval_expired'],
    ] as const;
    for (const [status, code] of states) {
      const approvalId = `apr-state-${status}`;
      await ledger.recordApproval(approval({ approval_id: approvalId }));
      await pool.query('UPDATE temperance_swarm_approvals SET status = $2 WHERE approval_id = $1', [approvalId, status]);
      expect(await attest(attestation({ approval_id: approvalId }))).toEqual({ schema: 'temperance.approval-attestation.response.v1', ok: false, code });
    }
  });

  test('collapses one-at-a-time immutable binding mismatches into one public code', async () => {
    const bindingKeys = [
      'project_id', 'project_cwd', 'plan_id', 'option_id', 'policy_hash', 'git_head',
      'source_fingerprint', 'task_fingerprint', 'scope_hash',
    ] as const;
    for (const key of bindingKeys) {
      const approvalId = `apr-mismatch-${key.replaceAll('_', '-')}`;
      await ledger.recordApproval(approval({ approval_id: approvalId }));
      const result = await attest(attestation({ approval_id: approvalId, [key]: key === 'scope_hash' ? 'b'.repeat(64) : `wrong-${key}` }));
      expect(result).toEqual({ schema: 'temperance.approval-attestation.response.v1', ok: false, code: 'binding_mismatch' });
      expect(JSON.stringify(result)).not.toContain(key);
    }

    await ledger.recordApproval(approval({ approval_id: 'apr-mismatch-id' }));
    expect(await attest(attestation({ approval_id: 'different-id' }), 'apr-mismatch-id')).toEqual({ schema: 'temperance.approval-attestation.response.v1', ok: false, code: 'binding_mismatch' });
  });

  test('rejects conflicting approval-id reuse and permits byte-equivalent idempotency', async () => {
    await ledger.recordApproval(approval({ approval_id: 'apr-duplicate' }));
    await expect(ledger.recordApproval(approval({ approval_id: 'apr-duplicate', git_head: 'different-head' }))).rejects.toThrow('approval_conflict');
    await expect(ledger.recordApproval(approval({ approval_id: 'apr-duplicate' }))).resolves.toBeUndefined();
    expect(Number((await pool.query("SELECT count(*)::int AS count FROM temperance_swarm_approvals WHERE approval_id = 'apr-duplicate'")).rows[0].count)).toBe(1);
  });

  test('attests repeatedly without mutating approvals, claims, outbox, or receipts', async () => {
    await ledger.recordApproval(approval());
    const before = await controlSnapshot();
    expect(before.counts).toEqual({ approvals: 1, claims: 0, outbox: 0, receipts: 0 });
    const first = await attest(attestation());
    const second = await attest(attestation());
    expect(first).toMatchObject({ schema: 'temperance.approval-attestation.response.v1', ok: true, code: 'attested', approval_id: 'apr-test' });
    expect(second).toMatchObject({ schema: 'temperance.approval-attestation.response.v1', ok: true, code: 'attested', approval_id: 'apr-test' });
    expect(typeof first.attestation_id).toBe('string');
    expect(first.attestation_id).toBe(second.attestation_id);
    const after = await controlSnapshot();
    expect(after.counts).toEqual(before.counts);
    expect(after.fingerprint).toBe(before.fingerprint);
  });

  test('never exposes canonical bindings, connection strings, or secret-like input in results, errors, or logs', async () => {
    const forbidden = ['secret-project', '/private/secret-cwd', 'secret-policy', 'secret-git', 'secret-source', 'secret-task', 'b'.repeat(64), String(url)];
    await ledger.recordApproval(approval({
      approval_id: 'apr-redaction', project_id: forbidden[0], project_cwd: forbidden[1], policy_hash: forbidden[2],
      git_head: forbidden[3], source_fingerprint: forbidden[4], task_fingerprint: forbidden[5], scope_hash: forbidden[6],
    }));
    const logs: unknown[] = [];
    const originals = { log: console.log, warn: console.warn, error: console.error };
    console.log = (...values: unknown[]) => { logs.push(values); };
    console.warn = (...values: unknown[]) => { logs.push(values); };
    console.error = (...values: unknown[]) => { logs.push(values); };
    let result: unknown;
    let thrown: unknown;
    try {
      result = await attest(attestation({ approval_id: 'apr-redaction', project_id: 'caller-secret-project' }));
    } catch (error) {
      thrown = error;
    } finally {
      console.log = originals.log;
      console.warn = originals.warn;
      console.error = originals.error;
    }
    expect(result).toEqual({ schema: 'temperance.approval-attestation.response.v1', ok: false, code: 'binding_mismatch' });
    const publicSurface = JSON.stringify({ result, thrown: String(thrown || ''), logs });
    for (const value of [...forbidden, 'caller-secret-project']) expect(publicSurface).not.toContain(value);
  });
});

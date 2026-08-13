import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Pool } from 'pg';
import { SwarmControlLedger, type ApprovedDispatch, type ClaimRequest } from '../src/control-ledger';

const url = process.env.TEMPERANCE_CONTROL_DATABASE_URL;
const control = url ? describe : describe.skip;
let pool: Pool;
let ledger: SwarmControlLedger;

const approval = (overrides: Partial<ApprovedDispatch> = {}): ApprovedDispatch => ({
  approval_id: 'apr-test', project_id: 'project-test', project_cwd: '/tmp/project-test', plan_id: 'plan-test', option_id: 'opt-test',
  policy_hash: 'policy-test', git_head: 'head-test', source_fingerprint: 'source-test', task_fingerprint: 'tasks-test',
  combo: 'te-dispatch-paid', concurrency: 2, worktree_required: true, expires_at: new Date(Date.now() + 60_000).toISOString(), ...overrides,
});
const request = (overrides: Partial<ClaimRequest> = {}): ClaimRequest => ({ ...approval(), quota_observed_at: new Date().toISOString(), quota_eligible: true, ...overrides });

control('PostgreSQL swarm control ledger', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    ledger = new SwarmControlLedger(pool, 60_000, 60_000);
    await ledger.migrate();
  });
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
});

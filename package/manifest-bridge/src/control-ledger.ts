import { createHash, randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';

export const CONTROL_SCHEMA = 'temperance.swarm-control.v1' as const;
export const AUTO_LAUNCH_ENV = 'TEMPERANCE_SWARM_AUTOLAUNCH';
export const CONTROL_ENABLED_ENV = 'TEMPERANCE_SWARM_CONTROL_ENABLED';

export interface ApprovedDispatch {
  approval_id: string;
  project_id: string;
  project_cwd: string;
  plan_id: string;
  option_id: string;
  policy_hash: string;
  git_head: string;
  source_fingerprint: string;
  task_fingerprint: string;
  combo: string;
  concurrency: number;
  worktree_required: boolean;
  expires_at: string;
}

export interface ClaimRequest extends ApprovedDispatch {
  quota_observed_at: string;
  quota_eligible: boolean;
}

export type ClaimResult =
  | { ok: true; claim_id: string; dispatch_id: string; lease_expires_at: string }
  | { ok: false; code: 'missing' | 'expired' | 'revoked' | 'claimed' | 'drift' | 'quota' | 'policy'; detail: string };

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class SwarmControlLedger {
  constructor(private readonly pool: Pool, private readonly leaseMs = 10 * 60 * 1000, private readonly quotaMaxAgeMs = 6 * 60 * 60 * 1000) {}

  static fromUrl(url = process.env.TEMPERANCE_CONTROL_DATABASE_URL): SwarmControlLedger {
    if (!url) throw new Error('TEMPERANCE_CONTROL_DATABASE_URL is required for swarm control');
    return new SwarmControlLedger(new Pool({ connectionString: url }));
  }

  async close(): Promise<void> { await this.pool.end(); }

  async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS temperance_swarm_approvals (
        approval_id text PRIMARY KEY,
        project_id text NOT NULL,
        project_cwd text NOT NULL,
        plan_id text NOT NULL,
        option_id text NOT NULL,
        policy_hash text NOT NULL,
        git_head text NOT NULL,
        source_fingerprint text NOT NULL,
        task_fingerprint text NOT NULL,
        combo text NOT NULL CHECK (combo = 'te-dispatch-paid'),
        concurrency integer NOT NULL CHECK (concurrency BETWEEN 1 AND 4),
        worktree_required boolean NOT NULL CHECK (worktree_required),
        expires_at timestamptz NOT NULL,
        status text NOT NULL CHECK (status IN ('granted', 'claimed', 'revoked', 'expired')) DEFAULT 'granted',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS temperance_swarm_claims (
        claim_id text PRIMARY KEY,
        dispatch_id text NOT NULL UNIQUE,
        approval_id text NOT NULL UNIQUE REFERENCES temperance_swarm_approvals(approval_id),
        status text NOT NULL CHECK (status IN ('claimed', 'queued', 'running', 'cancelled', 'failed', 'completed')) DEFAULT 'claimed',
        lease_expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        cancelled_at timestamptz,
        cancel_reason text
      );
      CREATE TABLE IF NOT EXISTS temperance_swarm_outbox (
        outbox_id text PRIMARY KEY,
        claim_id text NOT NULL UNIQUE REFERENCES temperance_swarm_claims(claim_id),
        payload jsonb NOT NULL,
        status text NOT NULL CHECK (status IN ('pending', 'delivered', 'cancelled')) DEFAULT 'pending',
        created_at timestamptz NOT NULL DEFAULT now(),
        delivered_at timestamptz
      );
      CREATE TABLE IF NOT EXISTS temperance_swarm_task_receipts (
        claim_id text NOT NULL REFERENCES temperance_swarm_claims(claim_id),
        task_id text NOT NULL,
        status text NOT NULL CHECK (status IN ('succeeded', 'failed', 'cancelled', 'timeout')),
        correlation_id text NOT NULL,
        run_dir text NOT NULL,
        evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
        recorded_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (claim_id, task_id)
      );
    `);
  }

  async recordApproval(input: ApprovedDispatch): Promise<void> {
    if (input.combo !== 'te-dispatch-paid' || input.concurrency < 1 || input.concurrency > 4 || !input.worktree_required) throw new Error('approval violates bounded paid-fleet policy');
    await this.pool.query(`
      INSERT INTO temperance_swarm_approvals
        (approval_id, project_id, project_cwd, plan_id, option_id, policy_hash, git_head, source_fingerprint, task_fingerprint, combo, concurrency, worktree_required, expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (approval_id) DO NOTHING
    `, [input.approval_id, input.project_id, input.project_cwd, input.plan_id, input.option_id, input.policy_hash, input.git_head, input.source_fingerprint, input.task_fingerprint, input.combo, input.concurrency, input.worktree_required, input.expires_at]);
  }

  async claim(request: ClaimRequest): Promise<ClaimResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const now = await client.query<{ now: string }>('SELECT now()::text AS now');
      const databaseNow = Date.parse(now.rows[0].now);
      const result = await client.query<ApprovedDispatch & { status: string }>('SELECT * FROM temperance_swarm_approvals WHERE approval_id = $1 FOR UPDATE', [request.approval_id]);
      const approval = result.rows[0];
      const rejection = this.reject(approval, request, databaseNow);
      if (rejection) { await client.query('ROLLBACK'); return rejection; }
      const claimId = `clm_${randomUUID().replaceAll('-', '')}`;
      const dispatchId = `dsp_${fingerprint({ approval_id: request.approval_id, claim_id: claimId }).slice(0, 24)}`;
      const lease = new Date(databaseNow + this.leaseMs);
      await client.query('UPDATE temperance_swarm_approvals SET status = $2 WHERE approval_id = $1', [request.approval_id, 'claimed']);
      await client.query('INSERT INTO temperance_swarm_claims (claim_id, dispatch_id, approval_id, lease_expires_at) VALUES ($1,$2,$3,$4)', [claimId, dispatchId, request.approval_id, lease]);
      await client.query('INSERT INTO temperance_swarm_outbox (outbox_id, claim_id, payload) VALUES ($1,$2,$3::jsonb)', [`obx_${randomUUID().replaceAll('-', '')}`, claimId, JSON.stringify({ schema: CONTROL_SCHEMA, dispatch_id: dispatchId, claim_id: claimId, ...request })]);
      await client.query('COMMIT');
      return { ok: true, claim_id: claimId, dispatch_id: dispatchId, lease_expires_at: lease.toISOString() };
    } catch (error) {
      await client.query('ROLLBACK');
      if (String(error).includes('unique')) return { ok: false, code: 'claimed', detail: 'approval already has a dispatch claim' };
      throw error;
    } finally { client.release(); }
  }

  async cancel(claimId: string, reason: string): Promise<boolean> {
    const result = await this.pool.query(`UPDATE temperance_swarm_claims SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2 WHERE claim_id = $1 AND status IN ('claimed', 'queued')`, [claimId, reason]);
    if (result.rowCount) await this.pool.query(`UPDATE temperance_swarm_outbox SET status = 'cancelled' WHERE claim_id = $1 AND status = 'pending'`, [claimId]);
    return Boolean(result.rowCount);
  }

  async readyOutbox(claimId: string): Promise<Record<string, unknown> | null> {
    const result = await this.pool.query<{ payload: Record<string, unknown> }>(`
      SELECT o.payload FROM temperance_swarm_outbox o JOIN temperance_swarm_claims c ON c.claim_id = o.claim_id
      WHERE o.claim_id = $1 AND o.status = 'pending' AND c.status = 'claimed' AND c.lease_expires_at > now()
    `, [claimId]);
    return result.rows[0]?.payload || null;
  }

  private reject(approval: (ApprovedDispatch & { status: string }) | undefined, request: ClaimRequest, databaseNow: number): Exclude<ClaimResult, { ok: true }> | null {
    if (!approval) return { ok: false, code: 'missing', detail: 'approval is absent from the control ledger' };
    if (approval.status === 'claimed') return { ok: false, code: 'claimed', detail: 'approval was already consumed' };
    if (approval.status !== 'granted') return { ok: false, code: 'revoked', detail: `approval is ${approval.status}` };
    if (Date.parse(approval.expires_at) <= databaseNow) return { ok: false, code: 'expired', detail: 'approval expired at database-bound receipt time' };
    const exact = ['project_id', 'project_cwd', 'plan_id', 'option_id', 'policy_hash', 'git_head', 'source_fingerprint', 'task_fingerprint', 'combo'] as const;
    if (exact.some((key) => approval[key] !== request[key]) || approval.concurrency !== request.concurrency || approval.worktree_required !== request.worktree_required) return { ok: false, code: 'drift', detail: 'request differs from immutable approved dispatch' };
    const quotaAge = databaseNow - Date.parse(request.quota_observed_at);
    if (!request.quota_eligible || !Number.isFinite(quotaAge) || quotaAge < 0 || quotaAge > this.quotaMaxAgeMs) return { ok: false, code: 'quota', detail: 'quota snapshot is stale or ineligible' };
    return null;
  }
}

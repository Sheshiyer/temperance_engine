-- Temperance control ledger: invariant test suite (disposable database only)
-- Run with psql:  \i schema.sql  \i functions.sql  \i tests.sql
-- The script intentionally exercises fail-closed paths and prints PASS/FAIL.

BEGIN;

SET search_path = control_ledger, public;

-- Deterministic helper to compute a canonical task hash the same way the guard does.
CREATE OR REPLACE FUNCTION test_task_hash(spec jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT sha256(canonical_json(spec));
$$;

\set ON_ERROR_STOP on

-- ===== Fixtures =====
SELECT create_proposal(
  'prop-1', 'plan-1', 'opt-1',
  'policy-hash-1',
  '{"plan":["STATE.md"],"policy":"v1"}'::jsonb,
  'abc123',
  '{"max_tasks":4,"max_tokens":100000}'::jsonb,
  4, true
);

SELECT create_approval('apr-1', 'prop-1', now() + interval '10 minutes');

-- ===== ISC-11 / ISC-12 / ISC-13 / ISC-20: happy-path claim =====
SELECT jsonb_pretty(claim_approval(
  'clm-1', 'apr-1', 'owner-1',
  'policy-hash-1',
  '{"plan":["STATE.md"],"policy":"v1"}'::jsonb,
  'abc123',
  '{"used_tasks":1,"used_tokens":100}'::jsonb,
  1, true,
  'wi-1', '{"desc":"task"}'::jsonb,
  'lease-1', 300
));

DO $$
BEGIN
  IF (SELECT count(*) FROM claim WHERE claim_key = 'clm-1' AND status = 'active') <> 1 THEN
    RAISE EXCEPTION 'FAIL: happy-path claim did not create one active claim';
  END IF;
  IF (SELECT status FROM approval WHERE approval_key = 'apr-1') <> 'consumed' THEN
    RAISE EXCEPTION 'FAIL: happy-path claim did not consume approval';
  END IF;
  IF (SELECT count(*) FROM lease WHERE lease_key = 'lease-1' AND status = 'active') <> 1 THEN
    RAISE EXCEPTION 'FAIL: happy-path claim did not create active lease';
  END IF;
END $$;
SELECT 'PASS ISC-11/12/13/20 happy-path claim' AS result;

-- ===== ISC-21: replay same claim key =====
SELECT claim_approval(
  'clm-1', 'apr-1', 'owner-1',
  'policy-hash-1', '{"plan":["STATE.md"],"policy":"v1"}'::jsonb, 'abc123',
  '{"used_tasks":1,"used_tokens":100}'::jsonb, 1, true,
  'wi-1b', '{"desc":"task"}'::jsonb, 'lease-1b', 300
);

DO $$
BEGIN
  IF (SELECT count(*) FROM claim WHERE claim_key = 'clm-1') <> 1 THEN
    RAISE EXCEPTION 'FAIL: claim replay created duplicate row';
  END IF;
END $$;
SELECT 'PASS ISC-21 claim replay' AS result;

-- ===== ISC-11 (concurrency simulation): second claim must be denied =====
SELECT jsonb_pretty(claim_approval(
  'clm-2', 'apr-1', 'owner-2',
  'policy-hash-1', '{"plan":["STATE.md"],"policy":"v1"}'::jsonb, 'abc123',
  '{"used_tasks":1,"used_tokens":100}'::jsonb, 1, true,
  'wi-2', '{"desc":"task2"}'::jsonb, 'lease-2', 300
));

DO $$
BEGIN
  IF (SELECT count(*) FROM claim WHERE approval_id = (SELECT approval_id FROM approval WHERE approval_key = 'apr-1') AND status = 'active') <> 1 THEN
    RAISE EXCEPTION 'FAIL: active claims for one approval exceed one';
  END IF;
  IF (SELECT count(*) FROM claim WHERE claim_key = 'clm-2') <> 0 THEN
    RAISE EXCEPTION 'FAIL: second claim was not denied';
  END IF;
END $$;
SELECT 'PASS ISC-5/ISC-11 one active claim per approval' AS result;

-- ===== Drift fixtures =====
SELECT create_proposal('prop-drift', 'plan-drift', 'opt-drift', 'policy-drift',
  '{"plan":["STATE.md"],"policy":"v2"}'::jsonb, 'deadbeef',
  '{"max_tasks":2,"max_tokens":50000}'::jsonb, 2, false);
SELECT create_approval('apr-drift', 'prop-drift', now() + interval '10 minutes');

-- ===== ISC-25 / ISC-26 / ISC-27 / ISC-28: drift denials =====
SELECT claim_approval(
  'clm-drift-1', 'apr-drift', 'owner-d',
  'policy-drift', '{"plan":["STATE.md"],"policy":"v2"}'::jsonb, 'wrong-head',
  '{"used_tasks":0,"used_tokens":0}'::jsonb, 1, false,
  'wi-drift-1', '{"desc":"x"}'::jsonb, 'lease-drift-1', 300
);

DO $$
BEGIN
  IF (SELECT count(*) FROM claim WHERE claim_key = 'clm-drift-1') <> 0 THEN
    RAISE EXCEPTION 'FAIL: git head drift was not denied';
  END IF;
END $$;
SELECT 'PASS ISC-27 git head drift denied' AS result;

SELECT claim_approval(
  'clm-drift-2', 'apr-drift', 'owner-d',
  'wrong-policy', '{"plan":["STATE.md"],"policy":"v2"}'::jsonb, 'deadbeef',
  '{"used_tasks":0,"used_tokens":0}'::jsonb, 1, false,
  'wi-drift-2', '{"desc":"x"}'::jsonb, 'lease-drift-2', 300
);

DO $$
BEGIN
  IF (SELECT count(*) FROM claim WHERE claim_key = 'clm-drift-2') <> 0 THEN
    RAISE EXCEPTION 'FAIL: policy drift was not denied';
  END IF;
END $$;
SELECT 'PASS ISC-26 policy drift denied' AS result;

SELECT claim_approval(
  'clm-drift-3', 'apr-drift', 'owner-d',
  'policy-drift', '{"plan":["OTHER.md"]}'::jsonb, 'deadbeef',
  '{"used_tasks":0,"used_tokens":0}'::jsonb, 1, false,
  'wi-drift-3', '{"desc":"x"}'::jsonb, 'lease-drift-3', 300
);

DO $$
BEGIN
  IF (SELECT count(*) FROM claim WHERE claim_key = 'clm-drift-3') <> 0 THEN
    RAISE EXCEPTION 'FAIL: source fingerprint drift was not denied';
  END IF;
END $$;
SELECT 'PASS ISC-25 source fingerprint drift denied' AS result;

SELECT claim_approval(
  'clm-drift-4', 'apr-drift', 'owner-d',
  'policy-drift', '{"plan":["STATE.md"],"policy":"v2"}'::jsonb, 'deadbeef',
  '{"used_tasks":5,"used_tokens":0}'::jsonb, 1, false,
  'wi-drift-4', '{"desc":"x"}'::jsonb, 'lease-drift-4', 300
);

DO $$
BEGIN
  IF (SELECT count(*) FROM claim WHERE claim_key = 'clm-drift-4') <> 0 THEN
    RAISE EXCEPTION 'FAIL: quota drift was not denied';
  END IF;
END $$;
SELECT 'PASS ISC-28 quota drift denied' AS result;

-- ===== ISC-19: worktree requirement =====
SELECT create_proposal('prop-wt', 'plan-wt', 'opt-wt', 'policy-wt',
  '{"plan":["STATE.md"],"policy":"wt"}'::jsonb, 'wt-head',
  '{"max_tasks":2,"max_tokens":50000}'::jsonb, 2, true);
SELECT create_approval('apr-wt', 'prop-wt', now() + interval '10 minutes');

SELECT claim_approval(
  'clm-worktree', 'apr-wt', 'owner-d',
  'policy-wt', '{"plan":["STATE.md"],"policy":"wt"}'::jsonb, 'wt-head',
  '{"used_tasks":0,"used_tokens":0}'::jsonb, 1, false,
  'wi-worktree', '{"desc":"x"}'::jsonb, 'lease-worktree', 300
);

DO $$
BEGIN
  IF (SELECT count(*) FROM claim WHERE claim_key = 'clm-worktree') <> 0 THEN
    RAISE EXCEPTION 'FAIL: worktree-required claim without worktree was not denied';
  END IF;
END $$;
SELECT 'PASS ISC-19 worktree gate denied' AS result;

-- ===== ISC-34 / ISC-40: receipt requires active lease; expired lease rejected =====
SELECT claim_approval(
  'clm-ok', 'apr-drift', 'owner-d',
  'policy-drift', '{"plan":["STATE.md"],"policy":"v2"}'::jsonb, 'deadbeef',
  '{"used_tasks":0,"used_tokens":0}'::jsonb, 1, false,
  'wi-ok', '{"desc":"x"}'::jsonb, 'lease-ok', 300
);

SELECT submit_receipt(
  'rcpt-ok', 'wi-ok', 'owner-d', 'dispatch',
  '{"ok":true}'::jsonb, sha256(canonical_json('{"ok":true}'::jsonb))
);

DO $$
BEGIN
  IF (SELECT count(*) FROM receipt WHERE receipt_key = 'rcpt-ok') <> 1 THEN
    RAISE EXCEPTION 'FAIL: valid receipt was not stored';
  END IF;
END $$;
SELECT 'PASS ISC-36/ISC-37 valid receipt stored' AS result;

-- ===== ISC-39: duplicate receipt kind =====
SELECT submit_receipt(
  'rcpt-dup', 'wi-ok', 'owner-d', 'dispatch',
  '{"dup":true}'::jsonb, sha256(canonical_json('{"dup":true}'::jsonb))
);

DO $$
BEGIN
  IF (SELECT count(*) FROM receipt WHERE work_item_id = (SELECT work_item_id FROM work_item WHERE work_item_key = 'wi-ok') AND kind = 'dispatch') <> 1 THEN
    RAISE EXCEPTION 'FAIL: duplicate receipt kind was not rejected';
  END IF;
END $$;
SELECT 'PASS ISC-39 duplicate receipt kind rejected' AS result;

-- ===== ISC-31/ISC-32/ISC-33: lease heartbeat owner checks =====
SELECT heartbeat_lease('lease-ok', 'owner-d', 300);
SELECT heartbeat_lease('lease-ok', 'wrong-owner', 300);
DO $$
BEGIN
  IF (SELECT count(*) FROM lease WHERE lease_key = 'lease-ok' AND status = 'active') <> 1 THEN
    RAISE EXCEPTION 'FAIL: owner heartbeat should keep lease active';
  END IF;
END $$;
SELECT 'PASS ISC-31/ISC-32 owner heartbeat' AS result;

-- Force expiry and verify heartbeat cannot revive it.
UPDATE lease SET expires_at = now() - interval '1 second' WHERE lease_key = 'lease-ok';
SELECT heartbeat_lease('lease-ok', 'owner-d', 300);
DO $$
BEGIN
  IF (SELECT count(*) FROM lease WHERE lease_key = 'lease-ok' AND status = 'active') <> 1 THEN
    RAISE EXCEPTION 'FAIL: expired lease should be inactive';
  END IF;
END $$;
SELECT 'PASS ISC-33 expired lease cannot renew' AS result;

SELECT expire_leases();
DO $$
BEGIN
  IF (SELECT status FROM work_item WHERE work_item_key = 'wi-ok') <> 'expired' THEN
    RAISE EXCEPTION 'FAIL: expired lease did not close work item';
  END IF;
END $$;
SELECT 'PASS ISC-35 lease expiry closes work item' AS result;

-- ===== ISC-40: receipt after expiry rejected =====
SELECT submit_receipt(
  'rcpt-expired', 'wi-ok', 'owner-d', 'verification',
  '{"v":1}'::jsonb, sha256(canonical_json('{"v":1}'::jsonb))
);

DO $$
BEGIN
  IF (SELECT count(*) FROM receipt WHERE receipt_key = 'rcpt-expired') <> 0 THEN
    RAISE EXCEPTION 'FAIL: receipt after lease expiry was not rejected';
  END IF;
END $$;
SELECT 'PASS ISC-40 receipt after expiry rejected' AS result;

-- ===== ISC-44: hash chain integrity =====
DO $$
BEGIN
  IF NOT ledger_integrity_check() THEN
    RAISE EXCEPTION 'FAIL: ledger hash chain integrity check failed';
  END IF;
END $$;
SELECT 'PASS ISC-44 hash chain intact' AS result;

-- ===== Anti-invariants =====
DO $$
BEGIN
  IF (SELECT count(*) FROM claim c
      JOIN approval a ON a.approval_id = c.approval_id
      WHERE c.status = 'active' AND a.status <> 'granted') <> 0 THEN
    RAISE EXCEPTION 'FAIL: anti-invariant active claim on non-granted approval';
  END IF;
  IF (SELECT count(*) FROM work_item w
      JOIN lease l ON l.work_item_id = w.work_item_id AND l.status = 'active'
      WHERE w.status = 'running' AND (l.expires_at <= now())) <> 0 THEN
    RAISE EXCEPTION 'FAIL: anti-invariant running work item with expired lease';
  END IF;
END $$;
SELECT 'PASS anti-invariants' AS result;

COMMIT;

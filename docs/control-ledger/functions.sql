-- Temperance control ledger: guard functions (fail-closed transitions)
-- All authority-changing writes must flow through these functions.

BEGIN;

SET search_path = control_ledger, public;

-- -------- store idempotent method outcome (first write wins) --------
CREATE OR REPLACE FUNCTION record_outcome(
  p_namespace text,
  p_idem_key  text,
  p_method    text,
  p_outcome   jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO idempotency(namespace, idem_key, method, outcome)
  VALUES (p_namespace, p_idem_key, p_method, p_outcome)
  ON CONFLICT (namespace, idem_key) DO NOTHING;
END;
$$;

-- -------- append hash-linked event --------
CREATE OR REPLACE FUNCTION append_event(
  p_entity_type text,
  p_entity_key  text,
  p_transition  text,
  p_payload     jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  head_row ledger_head%ROWTYPE;
  new_id    bigint;
  new_hash  text;
BEGIN
  SELECT * INTO head_row
  FROM ledger_head
  WHERE singleton = true
  FOR UPDATE;

  new_id   := head_row.event_id + 1;
  new_hash := sha256(
    head_row.event_hash || '|' || p_entity_type || '|' || p_entity_key || '|' ||
    p_transition || '|' || coalesce(p_payload::text, '')
  );

  INSERT INTO ledger_event(event_id, entity_type, entity_key, transition, payload, prev_event_hash, event_hash)
  VALUES (new_id, p_entity_type, p_entity_key, p_transition, p_payload, head_row.event_hash, new_hash);

  UPDATE ledger_head
  SET event_id = new_id,
      event_hash = new_hash
  WHERE singleton = true;

  RETURN new_id;
END;
$$;

-- -------- create proposal (idempotent) --------
CREATE OR REPLACE FUNCTION create_proposal(
  p_proposal_key        text,
  p_plan_id             text,
  p_option_id           text,
  p_policy_hash         text,
  p_source_fingerprints jsonb,
  p_git_head            text,
  p_quota_budget        jsonb,
  p_max_concurrency     integer,
  p_worktree_required   boolean
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  new_id bigint;
BEGIN
  INSERT INTO proposal(
    proposal_key, plan_id, option_id, policy_hash, source_fingerprints,
    git_head, quota_budget, max_concurrency, worktree_required
  )
  VALUES (
    p_proposal_key, p_plan_id, p_option_id, p_policy_hash, p_source_fingerprints,
    p_git_head, p_quota_budget, p_max_concurrency, p_worktree_required
  )
  ON CONFLICT (proposal_key) DO NOTHING
  RETURNING proposal_id INTO new_id;

  IF new_id IS NULL THEN
    SELECT proposal_id INTO new_id FROM proposal WHERE proposal_key = p_proposal_key;
    RETURN jsonb_build_object('status','replayed','proposal_id',new_id);
  END IF;

  PERFORM append_event('proposal', p_proposal_key, 'created', jsonb_build_object('proposal_id',new_id));
  PERFORM record_outcome('proposal', p_proposal_key, 'create_proposal',
    jsonb_build_object('status','created','proposal_id',new_id));
  RETURN jsonb_build_object('status','created','proposal_id',new_id);
END;
$$;

-- -------- create approval (idempotent) --------
CREATE OR REPLACE FUNCTION create_approval(
  p_approval_key text,
  p_proposal_key text,
  p_expires_at   timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  p_id bigint;
  new_id bigint;
BEGIN
  SELECT proposal_id INTO p_id FROM proposal WHERE proposal_key = p_proposal_key;
  IF p_id IS NULL THEN
    RETURN jsonb_build_object('status','denied','reason','proposal_missing');
  END IF;

  INSERT INTO approval(approval_key, proposal_id, status, expires_at)
  VALUES (p_approval_key, p_id, 'granted', p_expires_at)
  ON CONFLICT (approval_key) DO NOTHING
  RETURNING approval_id INTO new_id;

  IF new_id IS NULL THEN
    SELECT approval_id INTO new_id FROM approval WHERE approval_key = p_approval_key;
    RETURN jsonb_build_object('status','replayed','approval_id',new_id);
  END IF;

  PERFORM append_event('approval', p_approval_key, 'granted', jsonb_build_object('approval_id',new_id));
  PERFORM record_outcome('approval', p_approval_key, 'create_approval',
    jsonb_build_object('status','granted','approval_id',new_id));
  RETURN jsonb_build_object('status','granted','approval_id',new_id);
END;
$$;

-- -------- claim approval (the fail-closed choke point) --------
CREATE OR REPLACE FUNCTION claim_approval(
  p_claim_key           text,
  p_approval_key        text,
  p_owner               text,
  p_policy_hash         text,
  p_source_fingerprints jsonb,
  p_git_head            text,
  p_quota_snapshot      jsonb,
  p_concurrency_snapshot integer,
  p_worktree            boolean,
  p_work_item_key       text,
  p_task_spec           jsonb,
  p_lease_key           text,
  p_lease_ttl_seconds   integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  existing_claim_id bigint;
  a approval%ROWTYPE;
  p proposal%ROWTYPE;
  cid bigint;
  wid bigint;
  lid bigint;
  task_hash text;
BEGIN
  -- 1. Idempotent replay first.
  SELECT claim_id INTO existing_claim_id
  FROM claim
  WHERE claim_key = p_claim_key;

  IF existing_claim_id IS NOT NULL THEN
    RETURN jsonb_build_object('status','replayed','claim_id',existing_claim_id);
  END IF;

  -- 2. Lock the approval.
  SELECT * INTO a
  FROM approval
  WHERE approval_key = p_approval_key
  FOR UPDATE;

  IF a.approval_id IS NULL THEN
    RETURN jsonb_build_object('status','denied','reason','approval_missing');
  END IF;

  -- 3. Expiry and status guards.
  IF a.status <> 'granted' THEN
    RETURN jsonb_build_object('status','denied','reason','approval_not_granted');
  END IF;

  IF a.expires_at <= clock_timestamp() THEN
    UPDATE approval SET status = 'expired', deny_reason = 'expired' WHERE approval_id = a.approval_id;
    RETURN jsonb_build_object('status','denied','reason','approval_expired');
  END IF;

  -- 4. Load proposal snapshot.
  SELECT * INTO p FROM proposal WHERE proposal_id = a.proposal_id;
  IF p.proposal_id IS NULL THEN
    RETURN jsonb_build_object('status','denied','reason','proposal_missing');
  END IF;

  -- 5. Drift gates.
  IF p_policy_hash IS DISTINCT FROM p.policy_hash THEN
    RETURN jsonb_build_object('status','denied','reason','drift:policy_hash');
  END IF;

  IF p_source_fingerprints IS DISTINCT FROM p.source_fingerprints THEN
    RETURN jsonb_build_object('status','denied','reason','drift:source_fingerprints');
  END IF;

  IF p_git_head IS DISTINCT FROM p.git_head THEN
    RETURN jsonb_build_object('status','denied','reason','drift:git_head');
  END IF;

  IF (coalesce(p_quota_snapshot, '{}'::jsonb)) IS NOT NULL AND
     (p_quota_snapshot ? 'used_tasks' AND coalesce((p_quota_snapshot->>'used_tasks')::integer, 0) > coalesce((p.quota_budget->>'max_tasks')::integer, 0)) THEN
    RETURN jsonb_build_object('status','denied','reason','drift:quota');
  END IF;

  IF p_concurrency_snapshot > p.max_concurrency THEN
    RETURN jsonb_build_object('status','denied','reason','concurrency_exceeded');
  END IF;

  IF p.worktree_required AND NOT p_worktree THEN
    RETURN jsonb_build_object('status','denied','reason','worktree_required');
  END IF;

  -- 6. Same-transaction authority transition.
  task_hash := sha256(canonical_json(p_task_spec));

  INSERT INTO claim(
    claim_key, approval_id, owner, status, policy_hash, source_fingerprints,
    git_head, quota_snapshot, concurrency_snapshot, worktree
  )
  VALUES (
    p_claim_key, a.approval_id, p_owner, 'active', p_policy_hash, p_source_fingerprints,
    p_git_head, p_quota_snapshot, p_concurrency_snapshot, p_worktree
  )
  RETURNING claim_id INTO cid;

  INSERT INTO work_item(work_item_key, proposal_id, claim_id, task_spec, task_spec_hash, status)
  VALUES (p_work_item_key, p.proposal_id, cid, p_task_spec, task_hash, 'queued')
  RETURNING work_item_id INTO wid;

  INSERT INTO lease(lease_key, work_item_id, claim_id, owner, status, expires_at)
  VALUES (p_lease_key, wid, cid, p_owner, 'active', now() + make_interval(secs => p_lease_ttl_seconds))
  RETURNING lease_id INTO lid;

  UPDATE approval
  SET status = 'consumed', consumed_at = now()
  WHERE approval_id = a.approval_id;

  PERFORM append_event('claim', p_claim_key, 'claimed',
    jsonb_build_object('claim_id',cid,'approval_id',a.approval_id,'work_item_id',wid,'lease_id',lid));

  PERFORM record_outcome('claim', p_claim_key, 'claim_approval',
    jsonb_build_object('status','granted','claim_id',cid,'work_item_id',wid,'lease_id',lid));

  RETURN jsonb_build_object(
    'status','granted',
    'claim_id',cid,
    'work_item_id',wid,
    'lease_id',lid
  );
EXCEPTION
  WHEN OTHERS THEN
    -- Fail closed: an unexpected error is returned as a denial, never a grant.
    RETURN jsonb_build_object(
      'status','denied',
      'reason','error:' || SQLSTATE,
      'message',SQLERRM
    );
END;
$$;

-- -------- authorize dispatch (guarded; does not spawn a worker) --------
CREATE OR REPLACE FUNCTION authorize_dispatch(
  p_dispatch_key text,
  p_work_item_key text,
  p_owner text,
  p_combo text,
  p_concurrency integer
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  existing_id bigint;
  w work_item%ROWTYPE;
  l lease%ROWTYPE;
  new_id bigint;
BEGIN
  SELECT dispatch_id INTO existing_id FROM dispatch WHERE dispatch_key = p_dispatch_key;
  IF existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('status','replayed','dispatch_id',existing_id);
  END IF;

  SELECT * INTO w FROM work_item WHERE work_item_key = p_work_item_key FOR UPDATE;
  IF w.work_item_id IS NULL THEN
    RETURN jsonb_build_object('status','denied','reason','work_item_missing');
  END IF;

  SELECT * INTO l
  FROM lease
  WHERE work_item_id = w.work_item_id
    AND status = 'active'
  ORDER BY lease_id
  LIMIT 1
  FOR UPDATE;

  IF l.lease_id IS NULL THEN
    RETURN jsonb_build_object('status','denied','reason','no_active_lease');
  END IF;

  IF l.owner <> p_owner THEN
    RETURN jsonb_build_object('status','denied','reason','not_lease_owner');
  END IF;

  IF l.expires_at <= clock_timestamp() THEN
    RETURN jsonb_build_object('status','denied','reason','lease_expired');
  END IF;

  INSERT INTO dispatch(dispatch_key, work_item_id, lease_id, combo, concurrency, status)
  VALUES (p_dispatch_key, w.work_item_id, l.lease_id, p_combo, p_concurrency, 'queued')
  RETURNING dispatch_id INTO new_id;

  UPDATE work_item SET status = 'running', updated_at = now() WHERE work_item_id = w.work_item_id;

  PERFORM append_event('dispatch', p_dispatch_key, 'authorized',
    jsonb_build_object('dispatch_id',new_id,'work_item_id',w.work_item_id,'lease_id',l.lease_id));

  PERFORM record_outcome('dispatch', p_dispatch_key, 'authorize_dispatch',
    jsonb_build_object('status','authorized','dispatch_id',new_id,'work_item_id',w.work_item_id));

  RETURN jsonb_build_object('status','authorized','dispatch_id',new_id,'work_item_id',w.work_item_id);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('status','denied','reason','error:' || SQLSTATE, 'message', SQLERRM);
END;
$$;

-- -------- heartbeat lease --------
CREATE OR REPLACE FUNCTION heartbeat_lease(
  p_lease_key      text,
  p_owner          text,
  p_extend_seconds integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE lease
  SET expires_at = greatest(expires_at, now() + make_interval(secs => p_extend_seconds)),
      heartbeat_count = heartbeat_count + 1,
      updated_at = now()
  WHERE lease_key = p_lease_key
    AND owner = p_owner
    AND status = 'active'
    AND expires_at > clock_timestamp();

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  IF updated_count = 0 THEN
    RETURN jsonb_build_object('status','denied','reason','no_active_lease');
  END IF;

  RETURN jsonb_build_object('status','extended');
END;
$$;

-- -------- release lease --------
CREATE OR REPLACE FUNCTION release_lease(
  p_lease_key text,
  p_owner text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  l lease%ROWTYPE;
BEGIN
  SELECT * INTO l FROM lease WHERE lease_key = p_lease_key FOR UPDATE;
  IF l.lease_id IS NULL THEN
    RETURN jsonb_build_object('status','denied','reason','lease_missing');
  END IF;

  IF l.owner <> p_owner THEN
    RETURN jsonb_build_object('status','denied','reason','not_lease_owner');
  END IF;

  UPDATE lease SET status = 'released', updated_at = now() WHERE lease_id = l.lease_id;
  UPDATE claim SET status = 'released', updated_at = now() WHERE claim_id = l.claim_id;

  PERFORM append_event('lease', p_lease_key, 'released', jsonb_build_object('lease_id',l.lease_id));
  RETURN jsonb_build_object('status','released');
END;
$$;

-- -------- expire overdue leases (reaper) --------
CREATE OR REPLACE FUNCTION expire_leases()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  expired_count integer;
BEGIN
  UPDATE lease l
  SET status = 'expired', updated_at = now()
  WHERE l.status = 'active'
    AND l.expires_at <= clock_timestamp();

  GET DIAGNOSTICS expired_count = ROW_COUNT;

  UPDATE work_item w
  SET status = 'expired', updated_at = now()
  FROM lease l
  WHERE l.work_item_id = w.work_item_id
    AND l.status = 'expired'
    AND w.status IN ('queued','running');

  UPDATE claim c
  SET status = 'expired', updated_at = now()
  FROM lease l
  WHERE l.claim_id = c.claim_id
    AND l.status = 'expired'
    AND c.status = 'active';

  RETURN expired_count;
END;
$$;

-- -------- submit receipt --------
CREATE OR REPLACE FUNCTION submit_receipt(
  p_receipt_key text,
  p_work_item_key text,
  p_owner text,
  p_kind text,
  p_payload jsonb,
  p_payload_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  existing_id bigint;
  w work_item%ROWTYPE;
  l lease%ROWTYPE;
  new_id bigint;
BEGIN
  SELECT receipt_id INTO existing_id FROM receipt WHERE receipt_key = p_receipt_key;
  IF existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('status','replayed','receipt_id',existing_id);
  END IF;

  IF p_kind NOT IN ('dispatch','task','verification','report') THEN
    RETURN jsonb_build_object('status','rejected','reason','invalid_receipt_kind');
  END IF;

  IF sha256(canonical_json(p_payload)) <> p_payload_hash THEN
    RETURN jsonb_build_object('status','rejected','reason','receipt_hash_mismatch');
  END IF;

  SELECT * INTO w FROM work_item WHERE work_item_key = p_work_item_key FOR UPDATE;
  IF w.work_item_id IS NULL THEN
    RETURN jsonb_build_object('status','rejected','reason','work_item_missing');
  END IF;

  SELECT * INTO l
  FROM lease
  WHERE work_item_id = w.work_item_id
    AND status = 'active'
  ORDER BY lease_id
  LIMIT 1
  FOR UPDATE;

  IF l.lease_id IS NULL OR l.expires_at <= clock_timestamp() THEN
    RETURN jsonb_build_object('status','rejected','reason','no_active_lease');
  END IF;

  IF l.owner <> p_owner THEN
    RETURN jsonb_build_object('status','rejected','reason','not_lease_owner');
  END IF;

  IF p_kind = 'task' AND p_payload_hash <> w.task_spec_hash THEN
    RETURN jsonb_build_object('status','rejected','reason','task_spec_hash_mismatch');
  END IF;

  INSERT INTO receipt(receipt_key, work_item_id, claim_id, kind, payload, payload_hash, status)
  VALUES (p_receipt_key, w.work_item_id, w.claim_id, p_kind, p_payload, p_payload_hash, 'stored')
  RETURNING receipt_id INTO new_id;

  PERFORM append_event('receipt', p_receipt_key, p_kind,
    jsonb_build_object('receipt_id',new_id,'work_item_id',w.work_item_id));

  PERFORM record_outcome('receipt', p_receipt_key, 'submit_receipt',
    jsonb_build_object('status','stored','receipt_id',new_id));

  RETURN jsonb_build_object('status','stored','receipt_id',new_id);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('status','rejected','reason','duplicate_receipt_kind');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('status','rejected','reason','error:' || SQLSTATE, 'message', SQLERRM);
END;
$$;

-- -------- mark work item completed --------
CREATE OR REPLACE FUNCTION complete_work_item(
  p_work_item_key text,
  p_owner text,
  p_success boolean
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  w work_item%ROWTYPE;
  l lease%ROWTYPE;
BEGIN
  SELECT * INTO w FROM work_item WHERE work_item_key = p_work_item_key FOR UPDATE;
  IF w.work_item_id IS NULL THEN
    RETURN jsonb_build_object('status','denied','reason','work_item_missing');
  END IF;

  SELECT * INTO l
  FROM lease
  WHERE work_item_id = w.work_item_id AND status = 'active'
  ORDER BY lease_id LIMIT 1;

  IF l.lease_id IS NULL OR l.owner <> p_owner OR l.expires_at <= clock_timestamp() THEN
    RETURN jsonb_build_object('status','denied','reason','no_active_lease');
  END IF;

  UPDATE work_item
  SET status = CASE WHEN p_success THEN 'succeeded' ELSE 'failed' END,
      updated_at = now()
  WHERE work_item_id = w.work_item_id;

  UPDATE lease SET status = 'released', updated_at = now() WHERE lease_id = l.lease_id;
  UPDATE claim SET status = 'released', updated_at = now() WHERE claim_id = w.claim_id;

  PERFORM append_event('work_item', p_work_item_key,
    CASE WHEN p_success THEN 'succeeded' ELSE 'failed' END,
    jsonb_build_object('work_item_id',w.work_item_id));

  RETURN jsonb_build_object('status', CASE WHEN p_success THEN 'succeeded' ELSE 'failed' END);
END;
$$;

-- -------- integrity probe: detect broken event chain --------
CREATE OR REPLACE FUNCTION ledger_integrity_check()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  WITH genesis AS (
    SELECT '0000000000000000000000000000000000000000000000000000000000000000'::text AS hash
  ),
  recomputed AS (
    SELECT
      e.event_id,
      sha256(
        e.prev_event_hash || '|' || e.entity_type || '|' || e.entity_key || '|' ||
        e.transition || '|' || coalesce(e.payload::text, '')
      ) AS computed_hash
    FROM ledger_event e
  ),
  head_check AS (
    SELECT h.event_hash AS head_hash,
           coalesce(last_ev.event_hash, g.hash) AS expected_hash
    FROM ledger_head h
    CROSS JOIN genesis g
    LEFT JOIN ledger_event last_ev ON last_ev.event_id = h.event_id
  )
  SELECT
    (SELECT count(*) FROM (
      SELECT e.event_id
      FROM ledger_event e
      LEFT JOIN ledger_event prev ON prev.event_id = e.event_id - 1
      CROSS JOIN genesis g
      JOIN recomputed r ON r.event_id = e.event_id
      WHERE r.computed_hash <> e.event_hash
         OR coalesce(prev.event_hash, g.hash) <> e.prev_event_hash
    ) broken) = 0
    AND
    (SELECT bool_and(head_hash = expected_hash) FROM head_check);
$$;

COMMIT;

-- Temperance control ledger: fail-closed PostgreSQL control plane (schema + indexes)
-- Requires PostgreSQL 14+ and CREATE EXTENSION pgcrypto.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS control_ledger;

SET search_path = control_ledger, public;

-- Hash helper: SHA-256 over a UTF-8 text payload, hex-encoded.
CREATE OR REPLACE FUNCTION sha256(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT encode(digest($1, 'sha256'), 'hex');
$$;

-- Canonical JSON: object keys sorted, arrays preserved, whitespace normalized.
CREATE OR REPLACE FUNCTION canonical_json(v jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT $1::text;
$$;

-- -------- proposal (immutable plan snapshot) --------
CREATE TABLE proposal (
  proposal_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proposal_key        text NOT NULL UNIQUE,
  plan_id             text NOT NULL,
  option_id           text NOT NULL,
  policy_hash         text NOT NULL,
  source_fingerprints jsonb NOT NULL,
  git_head            text NOT NULL,
  quota_budget        jsonb NOT NULL,
  max_concurrency     integer NOT NULL CHECK (max_concurrency >= 1),
  worktree_required   boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- -------- approval (consumable capability) --------
CREATE TABLE approval (
  approval_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  approval_key text NOT NULL UNIQUE,
  proposal_id  bigint NOT NULL REFERENCES proposal(proposal_id),
  status       text NOT NULL DEFAULT 'granted'
               CHECK (status IN ('granted','consumed','expired','revoked','denied')),
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  revoked_at   timestamptz,
  deny_reason  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- -------- claim (atomic consumption of an approval) --------
CREATE TABLE claim (
  claim_id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  claim_key             text NOT NULL UNIQUE,
  approval_id           bigint NOT NULL REFERENCES approval(approval_id),
  owner                 text NOT NULL,
  status                text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','released','expired','failed')),
  policy_hash           text NOT NULL,
  source_fingerprints   jsonb NOT NULL,
  git_head              text NOT NULL,
  quota_snapshot        jsonb NOT NULL,
  concurrency_snapshot  integer NOT NULL,
  worktree              boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_claim_one_active_per_approval
  ON claim(approval_id)
  WHERE status = 'active';

-- -------- work_item (unit of work) --------
CREATE TABLE work_item (
  work_item_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  work_item_key   text NOT NULL UNIQUE,
  proposal_id     bigint NOT NULL REFERENCES proposal(proposal_id),
  claim_id        bigint NOT NULL REFERENCES claim(claim_id),
  task_spec       jsonb NOT NULL,
  task_spec_hash  text NOT NULL,
  status          text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','running','succeeded','failed','blocked','expired')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- -------- lease (short-TTL execution heartbeat) --------
CREATE TABLE lease (
  lease_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lease_key        text NOT NULL UNIQUE,
  work_item_id     bigint NOT NULL REFERENCES work_item(work_item_id),
  claim_id         bigint NOT NULL REFERENCES claim(claim_id),
  owner            text NOT NULL,
  status           text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','released','expired')),
  expires_at       timestamptz NOT NULL,
  heartbeat_count  integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_lease_one_active_per_work_item
  ON lease(work_item_id)
  WHERE status = 'active';

-- -------- dispatch (guarded transition record; never starts workers here) --------
CREATE TABLE dispatch (
  dispatch_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dispatch_key  text NOT NULL UNIQUE,
  work_item_id  bigint NOT NULL REFERENCES work_item(work_item_id),
  lease_id      bigint NOT NULL REFERENCES lease(lease_id),
  combo         text NOT NULL,
  concurrency   integer NOT NULL DEFAULT 1 CHECK (concurrency >= 1),
  status        text NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','started','succeeded','failed','denied')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- -------- receipt (hash-verified evidence) --------
CREATE TABLE receipt (
  receipt_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  receipt_key   text NOT NULL UNIQUE,
  work_item_id  bigint NOT NULL REFERENCES work_item(work_item_id),
  claim_id      bigint NOT NULL REFERENCES claim(claim_id),
  kind          text NOT NULL CHECK (kind IN ('dispatch','task','verification','report')),
  payload       jsonb NOT NULL,
  payload_hash  text NOT NULL,
  status        text NOT NULL DEFAULT 'stored'
                CHECK (status IN ('stored','replayed','rejected')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_receipt_one_per_work_item_kind
  ON receipt(work_item_id, kind);

-- -------- idempotency (cross-entity method outcomes for retry replay) --------
CREATE TABLE idempotency (
  idempotency_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  namespace       text NOT NULL,
  idem_key        text NOT NULL,
  method          text NOT NULL,
  outcome         jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (namespace, idem_key)
);

-- -------- ledger head + append-only event chain --------
CREATE TABLE ledger_head (
  singleton    boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  event_id     bigint NOT NULL DEFAULT 0,
  event_hash   text NOT NULL
);

INSERT INTO ledger_head(singleton, event_hash)
VALUES (true, '0000000000000000000000000000000000000000000000000000000000000000');

CREATE TABLE ledger_event (
  event_id        bigint PRIMARY KEY,
  entity_type     text NOT NULL,
  entity_key      text NOT NULL,
  transition      text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_event_hash text NOT NULL,
  event_hash      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMIT;

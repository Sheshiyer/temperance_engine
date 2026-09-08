---
id: 260907-esb
title: "Pure TypeScript routing-observation receipt contract"
status: complete
base: ffc444440a63fde1425576ced126c5cca9e4ea46
workflow: gsd-quick
scope: source-only
---

# RO-01: pure routing-observation receipt contract

## Objective

Create the product-owned, self-contained v1 receipt boundary described in the
reviewed routing-observation packet. This slice validates, canonicalizes and
builds synthetic routing-observation receipts. It has no collector, adapter,
router, bridge, installer, Superset/Hands, Organ Console or host runtime
wiring.

## Frozen contract decisions

- The schema is exactly temperance.routing-observation-receipt.v1; all receipt
  objects are closed at every level and contain no arrays, metadata bags,
  free-form strings, URLs, paths, account/connection IDs, prompts, tool
  inputs/outputs, credentials or errors.
- Receipt ids use ro_ plus the SHA-256 of compact, recursively ASCII-key-sorted
  canonical receipt content excluding only receipt_id. Observation ids use obs_
  plus 32 lowercase hexadecimal characters.
- A trusted caller supplies an explicit policy containing registered opaque
  project refs, reviewed public provider/model pairs and a maximum freshness
  duration. This contract validates policy shape without treating a
  caller-supplied catalog as proof that an identity is public.
- Project refs use prj_ plus 8-60 lowercase alphanumeric/hyphen characters.
  Provider identifiers use lower-case ASCII identifiers up to 64 characters;
  model identifiers use the reviewed pair membership plus an ASCII
  128-character maximum. A provider/model pair must match one catalog entry,
  not two independent allow-lists.
- Freshness is strictly positive and at most the explicit policy duration; the
  policy duration is positive and capped at 24 hours. Clock-relative
  future/skew/stale decisions remain RO-04 admission behavior.
- Typed-object validation rejects proxies, non-plain prototypes, inherited
  fields, symbols, non-enumerables, accessors, arrays, cycles, control
  characters and coercion. Raw JSON validation also rejects malformed UTF-8,
  a BOM, duplicate keys (including escaped duplicates), lone surrogates,
  non-JSON trailing data and encoded input above 4 KiB.
- Fixed rejection codes never echo input values. Validated results are
  detached copies; the module imports only deterministic Node built-ins for
  hashing and proxy detection.

## Files and ownership

| File | Responsibility |
|---|---|
| package/contracts/routing-observation-receipt.v1.ts | Self-contained types, strict validation, raw parsing, canonical serialization, deterministic ID building. |
| package/contracts/routing-observation-receipt.v1.schema.json | Draft 2020-12 closed structural schema; runtime-only catalog, digest, time and arithmetic semantics are documented. |
| package/contracts/routing-observation-receipt.v1.test.ts | Synthetic fixture, positive union coverage, adversarial boundary, deterministic ID and purity checks. |
| package/contracts/fixtures/routing-observation-receipt.v1/*.json | Only synthetic valid receipt samples. |

No existing router, Manifest, installer, provider, bridge or host-owned file is
within this quick task.

## Test-first execution

1. Add focused tests for a synthetic valid receipt, deterministic content
   digest, registered project/provider-model pair, independent attribution and
   tool states, exact time/count rules, raw duplicate-key rejection and
   hostile object rejection. Run the focused test before the implementation
   exists and retain the missing-contract failure as the red receipt.
2. Implement the smallest self-contained contract that makes those cases pass.
   Use data descriptors before reading untrusted properties; never reuse
   signed-probe canonicalization or Manifest normalization.
3. Add the schema and synthetic fixture. Expand tests across every accepted
   union branch, extra/missing fields, malformed policies, identifiers,
   maximum byte boundaries, timestamp/calendar cases, count/reason
   contradictions, catalog-pair mismatch, getters/proxies/symbols, parser
   duplicate keys, input immutability and fixed-code privacy.
4. Run focused tests, source-only import checks, schema/fixture parsing and
   whitespace checks. A later reviewer may inspect only these owned files.

## Acceptance criteria

- Valid synthetic receipts serialize identically regardless of safe insertion
  order and have an independently pinned ro_ SHA-256 digest.
- Supplied receipt ids are verified rather than repaired; every accepted leaf
  affects the content digest.
- Every nested object rejects missing/extra/unrelated fields before a
  rejection can carry a caller value or create a partial accepted result.
- Observed attribution requires one catalog-listed pair and ordinal 1-10,000;
  unavailable and ambiguous states cannot carry a serving identity.
- Completed tool state has complete arithmetic evidence; incomplete/unavailable
  states retain their distinct, bounded semantics without inferring task
  completion from request outcome.
- Tests use only synthetic data and do not access a gateway, service manager,
  database, host installation, combo, provider, Superset/Hands or Organ
  Console.
- Completion records source-test evidence only. It does not establish live
  provider success, tool completion, origin authenticity, runtime health,
  installation, a bridge projection or consumer behavior.

## Validation

    bun test package/contracts/routing-observation-receipt.v1.test.ts
    bun --no-env-file test package/contracts/routing-observation-receipt.v1.test.ts
    git diff --check

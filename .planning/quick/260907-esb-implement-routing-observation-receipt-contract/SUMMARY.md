---
id: 260907-esb
title: "Pure TypeScript routing-observation receipt contract"
status: complete
scope: source-only
base: ffc444440a63fde1425576ced126c5cca9e4ea46
---

# RO-01 completion: routing-observation receipt contract

## Outcome

Added the product-owned, self-contained TypeScript contract for
temperance.routing-observation-receipt.v1. It creates, validates and parses
only closed, synthetic-safe receipt content with deterministic canonical
SHA-256 receipt ids. It deliberately does not observe a provider, choose a
route, dispatch work, authenticate evidence, claim tool completion, or mutate
any runtime surface.

## Source changes

- package/contracts/routing-observation-receipt.v1.ts defines the closed
  receipt, policy, attribution and tool unions; descriptor-safe typed input
  validation; duplicate-aware raw JSON parsing; catalog-pair/project
  membership checks; UTC time and count arithmetic rules; canonical
  serialization; and detached fixed-code results.
- package/contracts/routing-observation-receipt.v1.schema.json records the
  Draft 2020-12 structural contract and documents checks that remain
  runtime-only.
- package/contracts/fixtures/routing-observation-receipt.v1 contains three
  synthetic receipts for observed/completed, unavailable and
  ambiguous/incomplete states.
- package/contracts/routing-observation-receipt.v1.test.ts covers closed
  union shapes, independent request/attribution/tool states, digest
  determinism, privacy, hostile objects, duplicate raw keys, byte/UTF-8/BOM
  controls, catalog pairs, calendar windows, count constraints and typed-array
  branding.

## Evidence

- Test-first red: bun test package/contracts/routing-observation-receipt.v1.test.ts
  reported the missing contract module, with 0 passing tests, 1 failure and
  1 load error.
- Final focused suite: bun test
  package/contracts/routing-observation-receipt.v1.test.ts passed 21 tests
  and 547 assertions.
- Final isolated suite: bun --no-env-file test
  package/contracts/routing-observation-receipt.v1.test.ts passed the same
  21 tests and 547 assertions.
- The module bundled successfully with Bun. Draft202012 schema validation
  accepted the schema and all three synthetic fixtures. Whitespace checks
  passed.
- Independent Astra review found a forged wider-typed-array narrowing bypass
  before commit. The contract now requires intrinsic Uint8Array branding and
  has Uint16Array and Float64Array regressions; the final Astra re-review
  returned PASS.

## Boundary

This is source and synthetic-fixture evidence only. It does not install to the
connected Mac, change an OmniRoute combo, contact a provider or gateway,
restart launchd, write a database, send work to Superset/Hands, publish a
Manifest projection, modify Organ Console, push, merge or deploy. Policy
authenticity and successful-attempt/tool-lifecycle evidence remain explicit
future adapter and admission responsibilities.

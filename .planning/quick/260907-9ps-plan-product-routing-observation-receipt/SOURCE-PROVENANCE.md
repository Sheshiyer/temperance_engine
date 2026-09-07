# Source provenance and compatibility packet

Date: 2026-09-07. Scope: read-only product source inspection followed by documentation only. Source baseline: `89ffc2789a23042ab5d103ee35c7ccc14df26a9d`. Branch: `codex/routing-observation-source-sync-20260907`. The isolated worktree started clean.

## Evidence precedence and gaps

The parent investigation supplies the facts that an existing host activity receipt is research-only and host/product Manifest implementations diverge. No host module, live endpoint, runtime manifest, private receipt, credentials, provider/combo, database, or Organ Console was read in this lane. Accordingly this packet has no host source hash, host closure, installation read-back, runtime compatibility proof, or successful live attempt receipt. A later sync gate must collect the authorized exact host baseline and classify every candidate import as adopt, reimplement, excluded, or held.

Product directory inspection finds no dedicated `routing-activity-receipt`, `canary-result`, or equivalent dedicated host attribution modules in the inspected router/bridge inventory. Product proxy source does contain stream attribution parsing and route receipts; absence of dedicated modules does not mean absence of all attribution code. That proxy behavior does not satisfy the new schema and is not copied into the pure adapter.

## Inspected boundaries

| Existing product path | Finding / design consequence |
|---|---|
| `package/manifest-bridge/src/types.ts` | Generic Manifest event/state, arbitrary payload, evidence URL/path support; new strict receipt must be separate. |
| `package/manifest-bridge/src/contract.ts` | Generic redaction is key-pattern/truncation-based; event ID suffix randomized by default; strict validator must run first. |
| `package/manifest-bridge/src/store.ts` | Ingest and replay normalize events independently; ID-only `seen` dedup; broad route projection. Both paths need new admission and conflict index. |
| `package/manifest-bridge/src/catalog.ts` | Normalization followed by project registration before store ingestion; explicit validation needed before registration. All-project merge needs new collection handling. |
| `package/manifest-bridge/src/server.ts` | Generic POST events rejects approval/dispatch lifecycle but allows other kinds; echoes generic ingestion result/errors. New kind needs strict handling. |
| `package/manifest-bridge/src/cli.ts` | CLI emit is another entrypoint; server-only validation cannot protect direct ingestion. |
| `package/manifest-bridge/src/hook-adapter.ts` | Existing hook adapter is distinct; do not add raw router evidence passthrough or silently activate hooks. |
| `package/router/temperance-openai-proxy.ts` | Existing route/stream attribution semantics are context; new adapter must remain pure and independent. |
| `package/install-surface/fragments/router.json` | Router COPY record maps source subtree to `TEMPERANCE_STATE/router`. |
| `package/install-surface/fragments/manifest.json` | Bridge COPY record maps source subtree to `TEMPERANCE_STATE/runtime/manifest-bridge`. |
| `scripts/install-spine.sh` | Legacy router rsync and bridge service installer call; generated source owner must remain durable. |
| `scripts/temperance-manifest-bridge-launchd.sh` | CLI_SOURCE/working directory use product package checkout, diverging from fragment destination. Hold runtime claim until converged/tested. |
| `package/install-surface/src/compile.ts` | Canonical lock digest covers semantic records; not a complete source-content import graph. |
| `package/install-surface/src/lifecycle/executor.ts` | Existing source/content-hash lifecycle owner is a future smoke target, not proof exercised here. |

## Baseline inspected-file SHA-256

Hashes below were calculated from the clean assigned product worktree. They are documentation review anchors, not a complete runtime dependency closure or signed release attestation. Paths are repository-relative and contain no host personal paths.

| Path | SHA-256 |
|---|---|
| `package/manifest-bridge/src/types.ts` | `b6436cdb9dbdb8114d779a48c9333a506e117be58a61cc95bd22e743b69eb606` |
| `package/manifest-bridge/src/contract.ts` | `850fcf13d9a2572d06750661e5f333359ebcc47cc66c01fe731190b58b1d8aa8` |
| `package/manifest-bridge/src/store.ts` | `41f448ed0e8a23e1276e667d9e169a6fdfacdff57f80d3c80a49d476753a5dcf` |
| `package/manifest-bridge/src/catalog.ts` | `f66203ddb79d790d728fb371ab27b9e2a6ec2867c0c8afbdc1142c1117a597d3` |
| `package/manifest-bridge/src/server.ts` | `a08ad09c656388b57446f177f2f5a0ce824e1daf0331a80952daea4dbf5d5ed6` |
| `package/manifest-bridge/src/cli.ts` | `68f460a56f6be8fe6cdd3f71bac76cd35f8ea86d6b0e0d3095b16f7a92842040` |
| `package/manifest-bridge/src/hook-adapter.ts` | `00155032072c4f42c90525cfb379b63fa310b13003b1394e93e6d91642006dad` |
| `package/manifest-bridge/package.json` | `047e8d45d47314f3824285c8e44f63ae0e0d99e70de6a233b7b2c3ffca1c5a63` |
| `package/manifest-bridge/bun.lock` | `6caa340cf2ee264a30c340091d8f1305806cc7119ead11a7fb303c79c3aae6fb` |
| `package/router/temperance-openai-proxy.ts` | `818fa09382661286916b4b2b875366a71c63bed6e0a9f34a771df2e08cc00bcc` |
| `package/router/temperance-phase-dispatch.sh` | `3c9abedb82cad9e0b6c9ae153b0dd16b6993cd139cbd6cfdb3db00b13830aa0e` |
| `package/install-surface/fragments/router.json` | `f50270846ca7089cc99a2a5d80f0f65e9fe98e3b709cdc61747e3307a43dbec8` |
| `package/install-surface/fragments/manifest.json` | `b74ac2990f6b4d472ef06c8005ecc912e84d75399c4fbe6ef2db086c93dd4c40` |
| `package/install-surface/install-surface-manifest.lock.json` | `e5b2274db7bdb246f52bc2bf1176902ab1f34d94ed9572ba13f71e2d28cc7030` |
| `package/install-surface/src/compile.ts` | `581eb8074f45dcf31aceed49128a277688eb8b408624d0f7c5501f987d7c5553` |
| `package/install-surface/src/lifecycle/executor.ts` | `1ccee4201177b6d579fb4c9441a5ee055d91481ad37a9f878009dc284a35f18d` |
| `scripts/install-spine.sh` | `0cf07f1e5aec9d916a5abe46bf4cb12f83b40b62a629f44b399300cfafd7b875` |
| `scripts/temperance-manifest-bridge-launchd.sh` | `248c5915526684788129d5f450b9548a9e327856e47201b53104790ece2effee` |

## Future sync decision receipt

Before source implementation is promoted, fill an explicit row for each dependency with product baseline hash, authorized host source hash (or `unavailable`), semantic delta, chosen owner, disposition, destination, generated-source owner, import closure, fixture evidence and rollback evidence. Never infer parity from matching filenames, a host manifest display, or a passing source test. Do not put host raw diffs, account IDs or tool output into this public packet.

The proposed slice is new product-owned contract/adapter/bridge projection. Host activity/canary implementation import is held until separately inventoried and reviewed. No rsync from host root to product is permitted by this packet. Template/ranker ownership, routing contracts and provider state stay outside its scope.

## Verification receipt for this documentation lane

Checks are recorded in [the quick summary](260907-9ps-SUMMARY.md). Implementation tests, installer smoke, source dependency closure and rollback requirements appear in [ARCHITECTURE.md](ARCHITECTURE.md); they are planned work and were not executed here.

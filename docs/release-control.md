# Release control

Temperance Engine and its optional routing gateway have **three independently
versioned planes**. Do not collapse them into a single SemVer. The v4 architecture
name is not the product version; the current product release is `0.8.0`.

Keep a Changelog: [CHANGELOG.md](../CHANGELOG.md). Compatibility pins: [COMPATIBILITY.md](COMPATIBILITY.md).

## Version planes

| Plane | Identity | Source of truth | Bump when |
|---|---|---|---|
| **Glove product** | `temperance_engine` SemVer | repo `VERSION` + git tag `vX.Y.Z` | Public installer, doctor, lifecycle, or docs contract that downloaders consume |
| **Host runtime** | installed generation and receipts | Selected state root and lifecycle transaction receipts; legacy installs may retain `~/.temperance_engine/VERSION` | A reviewed lifecycle operation actually copies and verifies new managed bytes |
| **Mercurius** | OmniRoute package version (9router only for the legacy repair adapter) | Exact pins in [COMPATIBILITY.md](COMPATIBILITY.md), checked against the installed executable | Upstream gateway release, only after gate qualification |

Alchemical display names (Opus, Speculum, Vas, Athanor, Mercurius) are coding names only. Tags, CHANGELOG headings, and `VERSION` files keep the real product names.

## SemVer

Follow [semver.org](https://semver.org/):

- **MAJOR** — breaking public CLI, schema, lockfile, or doctor report envelope.
- **MINOR** — additive public surface that old clients can ignore.
- **PATCH** — bugfix, docs, or verification that does not change contracts.

Pre-1.0: glove `0.1.0` is the first public installer. `0.6.0` publishes the
additive v4 onboarding/operator surfaces with explicit limitations. `0.7.0` adds
the opt-in STE skill, the STE docs gate, and the showreel. `0.8.0` adds the
organ registry with OmniRoute as the default router, the hosted-router bridge
probe, the 3.8.51 gate qualification, and standalone composition inspection.
Milestone
**v1.1 Public Temperance Glove** still requires its separate clean-host,
Apple Silicon/Intel, and exact-candidate qualification gates; a `0.x` feature
release does not mark that milestone complete.

Schema versions (`temperance.doctor.report.v1`, install-surface fragment `{major,minor}`) are **independent** of product SemVer. A product MINOR may keep schema major 1. A schema major bump is always a product MAJOR.

## Changelog contract

Each plane keeps a [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) file:

| Plane | File |
|---|---|
| Glove | [`CHANGELOG.md`](../CHANGELOG.md) |
| Host | Private lifecycle receipts and host changelog, when present; never updated merely because a product tag changes |
| Mercurius | Upstream OmniRoute (and legacy 9router) notes; glove records the **pin** in COMPATIBILITY.md, not a fork changelog |

Required heading shape:

```markdown
## [Unreleased]
### Added
### Changed
### Fixed
### Security

## [X.Y.Z] - YYYY-MM-DD
```

Unreleased is the only place in-progress work may land. Cutting a release:

1. Move Unreleased bullets into `[X.Y.Z] - date`.
2. Write `VERSION` to `X.Y.Z`.
3. Refresh README, compatibility, and local README source-reconciliation metadata.
   Do not label reused NotebookLM assets as newly generated research.
4. Run `./scripts/verify-all.sh`, install-surface typecheck/build, and COPY
   expectation checks. Preserve failing gates; do not publish a failed candidate.
5. Commit the reviewed candidate, then tag `vX.Y.Z` on a **clean** tree. Do not
   change an existing published tag. Push the exact branch/tag without force.
6. Record the commit, the OmniRoute pin (and the legacy 9router pin), and SHA-256 of
   `package/install-surface/install-surface-manifest.lock.json` in the GitHub
   release notes. Include qualification limitations and the local
   `scripts/verify-all.sh` result for that exact commit. Use `gh release create --verify-tag` only after
   verifying the remote tag and successful checks.

There is no GitHub Actions workflow since the local job migration before `0.8.0`.
Verification is the local `scripts/verify-all.sh` gate, run on the exact candidate
before it is pushed. There is no automatic release-publishing workflow, and the
documented release cut is manual. For v1.1, additionally bind the artifact digest and complete RELS-06/07
and both required clean-host platform lanes before publication.

## Ecosystem identifier

An operator-facing ecosystem line is the triple, not a fourth SemVer:

```text
temperance_engine@<VERSION> + omniroute@<PIN> + host@<RECEIPT_OR_UNKNOWN>
```

Example: `temperance_engine@0.8.0 + omniroute@3.8.51 + host@unverified`. Before `0.8.0` the triple named `9router@0.5.75`.

Release notes report the independent planes. Do not change an existing doctor
schema to synthesize a host version, and do not invent an ecosystem SemVer.

## What this file does not do

- It does not activate or repair an operator's runtime merely by publishing.
- It does not promote an unqualified gateway version: OmniRoute other than `3.8.51`, or 9router other than `0.5.75` (including `0.5.81`).
- It does not replace ISA.md as the acceptance judge.
- Dirty host-spine files already in the working tree remain Unreleased until reviewable commits land.

## Next GSD binding

Phase 7 (Reviewable Release and Exact-Candidate Proof) consumes this contract for RELS-06 and RELS-07. Phase 1 plans the provenance lockfile that later release receipts will digest.

# Release control

Temperance Engine and OmniRoute are one operator ecosystem with **three independently versioned planes**. Do not collapse them into a single SemVer.

Keep a Changelog: [CHANGELOG.md](../CHANGELOG.md). Compatibility pins: [COMPATIBILITY.md](COMPATIBILITY.md).

## Version planes

| Plane | Identity | Source of truth | Bump when |
|---|---|---|---|
| **Glove product** | `temperance_engine` SemVer | repo `VERSION` + git tag `vX.Y.Z` | Public installer, doctor, lifecycle, or docs contract that downloaders consume |
| **Host runtime** | install generation | `~/.temperance_engine/VERSION` | `install.sh` / `--with-spine` actually copies a new generation onto the machine |
| **Mercurius** | OmniRoute package version | installed OmniRoute `version` field (currently **3.8.48**) | Upstream OmniRoute release, only after glove qualification |

Alchemical display names (Opus, Speculum, Vas, Athanor, Mercurius) are coding names only. Tags, CHANGELOG headings, and `VERSION` files keep the real product names.

## SemVer

Follow [semver.org](https://semver.org/):

- **MAJOR** — breaking public CLI, schema, lockfile, or doctor report envelope.
- **MINOR** — additive public surface that old clients can ignore.
- **PATCH** — bugfix, docs, or verification that does not change contracts.

Pre-1.0: glove `0.1.0` is the first public installer. Milestone **v1.1 Public Temperance Glove** ships as tag `v1.1.0` at Phase 7, not sooner.

Schema versions (`temperance.doctor.report.v1`, install-surface fragment `{major,minor}`) are **independent** of product SemVer. A product MINOR may keep schema major 1. A schema major bump is always a product MAJOR.

## Changelog contract

Each plane keeps a [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) file:

| Plane | File |
|---|---|
| Glove | [`CHANGELOG.md`](../CHANGELOG.md) |
| Host | `~/.temperance_engine/CHANGELOG.md` (host-only distill / install generation) |
| Mercurius | upstream OmniRoute notes; glove records the **pin** in COMPATIBILITY.md, not a fork changelog |

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
3. Tag `vX.Y.Z` on a **clean** tree (Phase 7 RELS-06).
4. Record OmniRoute pin + manifest lock digest in the release notes.

## Ecosystem identifier

An operator-facing ecosystem line is the triple, not a fourth SemVer:

```text
temperance_engine@<VERSION> + omniroute@<PIN> + host@<HOST_VERSION>
```

Example: `temperance_engine@0.1.0 + omniroute@3.8.48 + host@0.1.0`.

Doctor JSON and release receipts should report this triple. Do not invent `ecosystem 2.0` that disagrees with `VERSION`.

## What this file does not do

- It does not execute Phase 1 (`package/install-surface`).
- It does not promote OmniRoute 3.8.49 (see `docs/audits/omniroute-3.8.49-a2a-comparison.json` — comparison only).
- It does not replace ISA.md as the acceptance judge.
- Dirty host-spine files already in the working tree remain Unreleased until reviewable commits land.

## Next GSD binding

Phase 7 (Reviewable Release and Exact-Candidate Proof) consumes this contract for RELS-06 and RELS-07. Phase 1 plans the provenance lockfile that later release receipts will digest.

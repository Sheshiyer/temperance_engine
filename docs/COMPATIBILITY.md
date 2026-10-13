# Compatibility matrix

Pins the three version planes defined in [release-control.md](release-control.md).
Update this table when `VERSION`, the gateway pin, or the host install contract changes.

## Current

| Plane | Version | Evidence | Status |
|---|---|---|---|
| Glove product | `0.8.0` | repo `VERSION` | Minor feature release (organ registry, OmniRoute default router and 3.8.51 gates, hosted-router probe, composition inspection); v1.1 clean-host qualification remains separate |
| Host runtime | Installation-specific | Selected state root and lifecycle transaction receipts | A product tag is not proof of installed byte parity or health |
| OmniRoute (default router) | `3.8.51` | Router gates re-qualified against the 3.8.51 source; onboarding pin `OMNIROUTE_PACKAGE.version` in lockstep | **Pin**; 3.8.48 and later versions remain held until re-qualified |
| Mercurius (9router) | `0.5.75` | Exact-version capability adapter, legacy `--router-setup` repair flow only | **Pin**; not the shipped default since 0.8.0; 0.5.81 and other mismatches remain held |
| Noesis/Cambium | Optional external profile | Explicit host profile, binding, project capsules, and session policy | No private profile, mounted-volume requirement, or provider auth is bundled |
| PAI Algorithm | Host-selected | Host `PAI/ALGORITHM/LATEST` | External host policy; not a glove tag or bundled version guarantee |
| GSD | Host-selected | External workflow directory and query CLI | Do not fork; verify availability on the target host |

## Rules

1. OmniRoute is the default router since 0.8.0 and owns provider credentials, models,
   combo membership, quotas, and fallback. 9router remains only in the legacy
   `--router-setup` repair flow. The adapter that is active owns
   provider credentials, models, combo membership, quotas, and fallback.
2. A product MINOR does not change the gateway pin. A pin change requires explicit
   compatibility qualification; version detection alone does not prove API health.
3. Product releases do not rewrite a host generation. Verify managed bytes,
   receipts, and runtime health independently after an approved install/update.
4. Algorithm and GSD are external policy dependencies. Noesis is optional.
5. Long-context admission remains held where per-attempt gateway enforcement is
   unavailable. This release does not prove 900k–1M context or durable recovery.

## Historical pins

| Date | Glove | OmniRoute | Note |
|---|---|---|---|
| 2026-08-01 | 0.1.0 | 3.8.48 | Offline readiness inspector + synthetic Context Settings work |
| 2026-08-01 | 0.1.0 | 3.8.49 (candidate only) | A2A comparison JSON; not installed |
| 2026-10-04 | 0.7.0 | 3.8.51 | Router gates re-qualified: native CLI readiness, context and Hermes preview, control plane. Live 401 stays unresolved |
| 2026-10-13 | 0.8.0 | 3.8.51 | OmniRoute is the shipped default router; organ registry and hosted-router probe land; 9router kept for the legacy repair flow only |

## Probe

```bash
cat VERSION
cd package/install-surface
bun src/cli.ts onboard --health --json
```

For a personal layer, supply the same explicit profile/binding/capsule inputs as
onboarding. A generic probe does not assert readiness of an unselected overlay.

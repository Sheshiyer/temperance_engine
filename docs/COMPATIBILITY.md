# Compatibility matrix

Pins the three version planes defined in [release-control.md](release-control.md).
Update this table when `VERSION`, the gateway pin, or the host install contract changes.

## Current

| Plane | Version | Evidence | Status |
|---|---|---|---|
| Glove product | `0.6.0` | repo `VERSION` | v4 feature release; v1.1 clean-host qualification remains separate |
| Host runtime | Installation-specific | Selected state root and lifecycle transaction receipts | A product tag is not proof of installed byte parity or health |
| Mercurius (9router) | `0.5.75` | Exact-version onboarding capability and management adapters | **Pin**; 0.5.81 and other mismatches remain held, not silently qualified |
| Noesis/Cambium | Optional external profile | Explicit host profile, binding, project capsules, and session policy | No private profile, mounted-volume requirement, or provider auth is bundled |
| PAI Algorithm | Host-selected | Host `PAI/ALGORITHM/LATEST` | External host policy; not a glove tag or bundled version guarantee |
| GSD | Host-selected | External workflow directory and query CLI | Do not fork; verify availability on the target host |

## Rules

1. 9router is the successor package, not a parallel OmniRoute authority. It owns
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

## Probe

```bash
cat VERSION
cd package/install-surface
bun src/cli.ts onboard --health --json
```

For a personal layer, supply the same explicit profile/binding/capsule inputs as
onboarding. A generic probe does not assert readiness of an unselected overlay.

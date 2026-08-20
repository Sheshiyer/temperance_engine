# Compatibility matrix

Pins the three version planes defined in [release-control.md](release-control.md).
Update this table when `VERSION`, the OmniRoute pin, or the host install generation changes.

## Current

| Plane | Version | Evidence | Status |
|---|---|---|---|
| Glove product | `0.1.0` | repo `VERSION` | Released installer; v1.1 work is Unreleased |
| Host runtime | `0.1.0` | `~/.temperance_engine/VERSION` after install | Local operator generation; may drift until `--with-spine` is re-run |
| Mercurius (OmniRoute) | `3.8.48` | Product ISA + `docs/audits/omniroute-3.8.49-a2a-comparison.json` `installed.version` | **Pin**. 3.8.49 is comparison-only, not promoted |
| PAI Algorithm | `v6.3.0` | `~/.claude/PAI/Algorithm/LATEST` | Host policy; not a glove tag |
| GSD | `1.42.3` | `~/.claude/get-shit-done/VERSION`, `~/.codex/get-shit-done/VERSION`, and external `gsd-sdk` | Do not fork; query CLI required |

## Rules

1. Glove code may **observe** OmniRoute 3.8.48. It may not vendor or fork OmniRoute.
2. A glove MINOR that still talks to 3.8.48 keeps this pin. Changing the pin is a documented compatibility event, not a silent doctor pass.
3. Host `VERSION` should equal glove `VERSION` after a successful install from that tag. Drift is `DRIFT` for the future install-surface doctor, not a second product number.
4. Algorithm and GSD versions are policy dependencies. They are not bundled inside the public tarball.

## Historical pins

| Date | Glove | OmniRoute | Note |
|---|---|---|---|
| 2026-08-01 | 0.1.0 | 3.8.48 | Offline readiness inspector + synthetic Context Settings work |
| 2026-08-01 | 0.1.0 | 3.8.49 (candidate only) | A2A comparison JSON; not installed |

## Probe

```bash
cat VERSION
python3 -c "import json,urllib.request; print('omniroute pin documented: 3.8.48')"
test -f docs/audits/omniroute-3.8.49-a2a-comparison.json
```

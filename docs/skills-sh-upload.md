# skills.sh Upload Checklist

Use this checklist before submitting Temperance Engine to skills.sh.

## Files

- `skills/temperance-engine/SKILL.md`
- `skills.sh.json`
- `assets/banner.png`
- `assets/icon.png`
- `README.md`
- `CREDITS.md`
- `UPSTREAM.md`
- `SECURITY.md`
- `LICENSE`

## Suggested Listing

- Name: `Temperance Engine`
- Category: `Developer Tooling`
- Summary: `Install a local PAI operator runtime with skill-cluster routing, optional peon-ping voice feedback, and CodeGraph-first .agents search.`
- Platforms: `macOS`, `Linux`, `Unix-like`
- Voice note: `Voice packs are optional and not bundled.`
- Install command: `git clone https://github.com/Sheshiyer/temperance_engine.git && cd temperance_engine && ./install.sh`
- Verify command: `./verify.sh`

## Safety Notes

- The installer backs up existing files before writes.
- The installer uses `$HOME` and override variables.
- Non-macOS systems skip voice by default.
- Audio packs and credentials are not included.

## Final Checks

```bash
./verify.sh
./install.sh --dry-run --skip-voice
git status --short
```

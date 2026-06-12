# Contributing

Temperance Engine is a public packaging repo for local AI-operator runtime setup. Contributions should preserve the safety boundary: no private memory, no credentials, no bundled voice packs, and no hard-coded personal paths.

## Local Checks

```bash
./verify.sh
./install.sh --dry-run --skip-voice
```

## Guidelines

- Keep installer scripts POSIX-shell compatible unless there is a documented reason not to.
- Back up before writing to user config paths.
- Use `$HOME` and documented override variables instead of hard-coded usernames.
- Reference optional dependencies; do not vendor unclear-license binaries or audio.
- Update `CREDITS.md` and `UPSTREAM.md` when adding a new integration surface.

## Pull Requests

Include:

- What changed.
- Which install surface it touches.
- Verification command output.
- Any rollback implications.

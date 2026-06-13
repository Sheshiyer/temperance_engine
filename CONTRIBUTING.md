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

## README Continuity (Required)

README is treated as a generated, versioned artifact, not a one-shot document.

Before opening or updating a PR to `main`, run:

```bash
bash scripts/readme-continuity-check.sh
```

When version-significant files change (`CHANGELOG.md`, docs, scripts, skills, etc.), PRs are required to include updated README sections:

- `## 🚀 Project Intelligence Snapshot`
- `## 🧠 Concept Map`
- `## 📊 Repository Signals Table`
- `## 🔍 Asset Trail`

README continuity is validated on every PR to `main` via `.github/workflows/readme-continuity.yml`.

A companion workflow (`.github/workflows/readme-auto-refresh.yml`) runs after merges on `main` and opens/updates a follow-up branch PR (`readme-continuity-refresh`) when NotebookLM sections need refresh.

For release/version updates, PRs are still expected to keep README blocks current; the auto-refresh workflow can also backfill missed updates in a separate follow-up commit/PR.

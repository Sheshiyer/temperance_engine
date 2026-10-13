# Contributing

Themed page: [docs/site/contributing.html](docs/site/contributing.html) · library: [docs/index.html](docs/index.html)

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

README continuity is validated locally: run `scripts/readme-continuity-check.sh origin/main` before you open a PR, and the release cut runs it on the candidate. The GitHub Actions workflows that ran this check and the NotebookLM auto-refresh were removed before `0.8.0` (local job migration).

For release and version updates, a PR must keep the README blocks and the NotebookLM reconciliation metadata current. There is no automatic backfill.

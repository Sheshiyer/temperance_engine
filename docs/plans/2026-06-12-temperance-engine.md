# Temperance Engine Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a public-ready installer repository for the custom PAI, skill-cluster, peon-ping, and CodeGraph runtime.

**Architecture:** The repo ships templates, scripts, and docs only. Live machine state remains outside the repo and is installed through backup-first scripts.

**Tech Stack:** POSIX shell, Bun for optional Pulse compatibility, CodeGraph CLI, GitHub CLI.

---

### Task 1: Create Skeleton

**Files:**

- Create: `README.md`
- Create: `install.sh`
- Create: `verify.sh`
- Create: `docs/*.md`

**Steps:** create files, run `sh -n`, verify expected docs exist.

### Task 2: Add Installer Scripts

**Files:**

- Create: `scripts/*.sh`
- Create: `package/pulse-compat/compat-server.ts`

**Steps:** add backup-first helpers, add optional voice behavior, run shell syntax checks.

### Task 3: Add Templates and Credits

**Files:**

- Create: `templates/*.md`
- Create: `CREDITS.md`
- Create: `SECURITY.md`

**Steps:** document upstream surfaces, avoid vendoring private assets, verify no local username path in install surface.

### Task 4: Publish

**Files:**

- Modify: git metadata only.

**Steps:** initialize local git, commit, create `Sheshiyer/temperance_engine` as public, push main.

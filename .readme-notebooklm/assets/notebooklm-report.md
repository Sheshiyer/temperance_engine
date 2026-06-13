# Temperance Engine: Local AI-Operator Runtime Packaging

## Executive Summary
Developed by Thoughtseed Labs, **Temperance Engine** is a comprehensive public packaging repository and one-time installer designed to standardize and secure local AI-operator runtimes. The project addresses the problem of "configuration sprawl"—the fragmentation of local AI-agent setups across hidden directories, voice hooks, and search indexes—by consolidating these elements into a reviewable, modular framework.

The engine integrates high-profile upstream patterns, most notably Daniel Miessler’s Personal AI Infrastructure (PAI), providing a structured environment for Algorithm-driven workflows. Its core mission is to provide a readable public repository that installs safe components, references optional local assets, and verifies configurations without leaking private machine state. Adhering to a "privacy-first" and "backup-first" philosophy, Temperance Engine ensures operators maintain absolute control over their local environment while benefiting from a unified, inspectable loop.

## Project Intelligence Snapshot

| Feature | Description |
| :--- | :--- |
| **Developer** | Thoughtseed Labs |
| **Core Function** | One-time installer for local PAI operator runtimes |
| **Primary Platforms** | macOS (primary), Linux/other (with voice skipped) |
| **Philosophy** | Privacy-first, backup-first, and POSIX-shell compatible |
| **Key Integrations** | PAI, CodeGraph, peon-ping, OpenCode, OpenAI Codex CLI |

---

## Detailed Analysis of Key Themes

### 1. Mitigation of Configuration Sprawl
Local AI-agent setups often suffer from a lack of organization, with configuration files scattered across various hidden directories. Temperance Engine centralizes these elements, turning a "scattered local-agent setup into one explicit, inspectable loop." It documents every touched surface and installs visible templates, ensuring that the runtime remains reviewable rather than opaque.

### 2. Privacy and Security Guardrails
A central tenet of the Temperance Engine is the preservation of the "safety boundary." The project explicitly excludes private memory, credentials, bundled voice packs, and hard-coded personal paths. 
*   **Safe Defaults:** The installer uses `$HOME` and user-overridable environment variables to prevent leaking machine-specific data.
*   **Secret Management:** The `SECURITY.md` guidelines strictly forbid the commitment of API keys, model tokens, or private memory folders.
*   **Local Network:** The Pulse compatibility server is restricted to `127.0.0.1:31337` to ensure local-only JSON POST operations.

### 3. Modular Architecture and Upstream Fidelity
The engine acts as a "public installer wrapper" rather than a standalone application, maintaining high fidelity to upstream projects without claiming ownership.

| Integration Type | Project | Role in Runtime |
| :--- | :--- | :--- |
| **Principal** | Personal AI Infrastructure (PAI) | Inspiration for Algorithm/ISA runtime patterns. |
| **Structural Search** | CodeGraph | Provides AST-backed code indexing and search. |
| **Voice Feedback** | peon-ping | Maps Algorithm phases to local sound notifications. |
| **Runtime** | Bun | Powers the optional Pulse compatibility server. |
| **Search Fallback** | ripgrep | Used for literal file and text search patterns. |

### 4. Continuity and Automated Maintenance
The project treats its `README.md` as a "generated, versioned artifact" rather than a static document. It employs GitHub Actions to validate "README continuity" on every Pull Request. This ensures that repository signals, concept maps, and asset trails remain synchronized with the actual state of the codebase.

---

## Important Quotes with Context

### On Project Purpose
> "Temperance Engine gives a user a readable public repo that explains the runtime, installs the safe pieces, references optional local voice packs, and verifies the configuration without leaking private machine state."
*   **Context:** Found in `ISA.md`, this quote defines the "Vision" of the project, contrasting the packaged repository against existing machine-specific, non-portable runtimes.

### On Installation Safety
> "Installer must create backups before modifying local config."
*   **Context:** A primary constraint in the `ISA.md` (ISC-5), this emphasizes the "backup-first" philosophy to prevent data loss during the setup of AI-operator surfaces.

### On Scope Limitations
> "This repository does not claim ownership of those upstream projects... it only ships local templates and does not redistribute [them]."
*   **Context:** From `CREDITS.md`, this highlights the project's role as an integration layer that respects the licensing and boundaries of tools like Claude Code and CodeGraph.

### On Operator Responsibility
> "Review scripts before running them on any important machine. Built for operators who want local autonomy without hidden runtime sprawl."
*   **Context:** Found in the `README.md` Status section, this serves as a final disclaimer that emphasizes user autonomy and the necessity of manual code review for developer tooling.

---

## Actionable Insights

### Installation and Verification
*   **Use Dry-Runs:** Before mutating live configurations, users should execute `./install.sh --dry-run` to see intended changes and backup actions.
*   **Platform Specifics:** Voice integration is enabled by default only on macOS and requires a local `peon-ping` script at `~/.claude/hooks/peon-ping/peon.sh`. Non-macOS users should expect voice features to be skipped automatically.
*   **Post-Install Validation:** Run `./verify.sh` to ensure all required files, shell syntax, and paths are correctly configured without hard-coded local usernames.

### Contribution Requirements
*   **Preserve Safety Boundaries:** Contributions must not include private memory, credentials, or bundled binaries with unclear licenses.
*   **Documentation Updates:** Any PR that changes version-significant files (scripts, docs, skills) must include updated README sections for the "Project Intelligence Snapshot" and "Repository Signals Table."
*   **Verification Logs:** Pull requests are required to include the output of verification commands and a description of any rollback implications.

### Deployment to skills.sh
*   **Skill Metadata:** When uploading to `skills.sh`, use the generated `assets/banner.png` and `assets/icon.png`.
*   **Entry Point:** The marketplace-facing entry file is designated as `skills/temperance-engine/SKILL.md`.
*   **Categorization:** The project should be listed under "Developer Tooling" or "Agent Operations."
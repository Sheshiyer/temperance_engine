# Temperance Engine: Local AI-Operator Runtime Briefing Document

## Executive Summary

The Temperance Engine, developed by Thoughtseed Labs, is a comprehensive packaging repository and one-time installer designed for local AI-operator runtimes. It specifically targets environments utilizing **OpenCode** and **Cursor**, providing a modular framework that consolidates scattered configurations, voice hooks, MCP servers, and search indexes into a reviewable, secure system. 

The project focuses on "Absolute Source Fidelity" and safety, ensuring that the installation process does not leak private machine state, credentials, or proprietary data. By implementing a "backup-first" installation philosophy and utilizing a multi-backend routing system, the Temperance Engine allows operators to maintain local autonomy while benefiting from advanced AI orchestration patterns like the Personal AI Infrastructure (PAI) and CodeGraph structural search.

---

## Key Themes and Systematic Analysis

### 1. Architectural Integrity and Safety Boundaries
The core philosophy of the Temperance Engine is the preservation of a safety boundary. The system is designed to be public-ready without exposing private information.

*   **Zero-Leakage Policy:** The installer is strictly prohibited from bundling private memory, credentials, voice packs, or hard-coded personal paths.
*   **Infrastructure Management:** The system utilizes `$HOME` and environment variables to ensure compatibility across different local environments.
*   **Single Preference Store:** A critical architectural decision recorded in `ISA.md` is that the Temperance Engine owns exactly one preference store: `ISA.md`. External configurations (like GSD or PAI steering) remain untouched to prevent system sprawl.
*   **Backup-First Operations:** Every write operation is preceded by the creation of timestamped backups, ensuring full reversibility.

### 2. Multi-Backend Routing and Task Classification
The Temperance Engine introduces a sophisticated routing layer that directs tasks to the most appropriate AI model based on the nature of the work.

| Task Type | Trigger Keywords | Primary Model Recommendation |
| :--- | :--- | :--- |
| **Fast** | "quick", "simple", "minor" | `deepseek/deepseek-v4-flash` |
| **Long-horizon** | "refactor", "migrate", "entire" | `moonshotai/Kimi-K2.7-Code` |
| **Reasoning** | "analyze", "debug", "explain" | `claude-fable-5` |
| **Validation** | "review", "verify", "audit" | `google/gemini-3.5-flash` |
| **Creative** | "brainstorm", "explore" | `claude-sonnet-5` |
| **Inline** | "extract", "list" | Current session (no tools) |

**Backend Characteristics:**
*   **command-code:** Primary and versatile, supporting 35 models but with higher latency (~10s startup).
*   **kimi:** Optimized for long-horizon coding with a 262K context window.
*   **grok:** Targeted for fast iteration with 10-15s task completion.
*   **nvidia:** Leverages Nemotron Ultra for deep reasoning with low latency.

### 3. Integrated Intelligence Components
The engine synthesizes several upstream projects into a single cohesive runtime:

*   **Personal AI Infrastructure (PAI):** Provides the Algorithm/ISA runtime pattern (Current state -> Ideal state -> Criteria -> Verification).
*   **CodeGraph:** Powers local AST-backed code indexing and structural search for the `.agents` directory.
*   **peon-ping:** Provides local audio notifications for Algorithm phase transitions (optional and referenced, not bundled).
*   **Skill-Cluster Routing:** Uses a hub-and-spoke organization to prevent startup bloat by keeping skill discovery explicit through `skill-index.json`.

---

## Important Quotes and Contextual Significance

> "Temperance Engine owns exactly one preference store (ISA.md); GSD config and PAI steering/memory stay fully external."
*   **Context:** Found in the Changelog and `ISA.md` Decisions. This highlights the project’s commitment to modularity and preventing "configuration sprawl" by strictly limiting what the engine controls.

> "Contributions should preserve the safety boundary: no private memory, no credentials, no bundled voice packs, and no hard-coded personal paths."
*   **Context:** From `CONTRIBUTING.md`. This serves as the primary directive for developers to maintain the project's public-safe status.

> "README is treated as a generated, versioned artifact, not a one-shot document."
*   **Context:** From `CONTRIBUTING.md`. This reflects a high standard for documentation integrity, where the README must be automatically refreshed and validated to match the current state of the repository signals.

> "Default mode skips Claude/Pulse and Codex while installing OpenCode/Cursor templates."
*   **Context:** From `ISA.md` Verification. This emphasizes the "OpenCode/Cursor-first" priority of the engine, making other popular tools like Claude Code opt-in only.

---

## Performance and Latency Metrics

To assist operators in selecting backends, the project provides specific latency characteristics based on task complexity:

| Backend | Startup | Simple Task | Complex Task | Recommended Timeout |
| :--- | :--- | :--- | :--- | :--- |
| **command-code** | ~10s | 15-20s | 30-120s | 180s |
| **kimi** | ~3s | 10-15s | 30-60s | 120s |
| **grok** | ~5s | 10-15s | 20-40s | 90s |
| **nvidia** | ~1s | 5-10s | 15-30s | 60s |

---

## Actionable Insights for Implementation

### Installation Guidelines
*   **Standard Install:** Run `install.sh` to set up OpenCode and Cursor templates.
*   **Opt-in Features:** Use flags `--with-claude` for Claude Code templates/Pulse server or `--with-codex` for OpenAI Codex CLI surfaces.
*   **Voice Integration:** On macOS, voice is enabled only if `peon.sh` is detected at `~/.claude/hooks/peon-ping/peon.sh`. Users must provide their own audio packs.
*   **Dry Run:** Always execute `./install.sh --dry-run` first to verify intended file writes and backup actions without mutating the system.

### Maintenance and Verification
*   **Routine Checks:** Use `./verify.sh` to ensure shell syntax, file presence, and the absence of hard-coded paths.
*   **Routing Execution:** Use the `temperance-route` CLI to automatically inject `<temperance-context>` blocks into prompts, providing routing hints to AI agents.
*   **Reversion:** To undo changes, utilize the provided rollback guidance; since the engine uses symlinks and backups, the process is fully reversible.

### Project Intelligence Alignment
Operators should ensure that any project-local Cursor rules follow the `AGENTS.md` and `.cursor/rules/*.mdc` templates provided by the installer to maintain alignment with the PAI instruction surfaces.
# Multi-Surface Orchestration Architecture

Temperance Engine serves as the **orchestration brain** across multiple AI coding surfaces, providing ISA-driven context enrichment and cost-aware model routing.

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TEMPERANCE ENGINE                                   │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                      ENRICHMENT CORE                                  │  │
│  │                      package/enrich/                                  │  │
│  │                                                                       │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │  │
│  │  │  classify   │  │   intent    │  │  guardrails │  │   memory    │  │  │
│  │  │   stage     │  │   stage     │  │    stage    │  │   stage     │  │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │  │
│  │                         │                                             │  │
│  │                         ▼                                             │  │
│  │              <temperance-context> block                               │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                   │                                         │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                    SURFACE ADAPTERS                                   │  │
│  │                    package/adapters/                                  │  │
│  │                                                                       │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │  │
│  │  │ Claude Code │  │   Codex     │  │  OpenCode   │  │Command Code │  │  │
│  │  │             │  │             │  │             │  │             │  │  │
│  │  │ hooks/*.ts  │  │  hook.sh    │  │  hook.sh    │  │ AGENTS.md + │  │  │
│  │  │             │  │             │  │             │  │ dispatch.sh │  │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                   │                                         │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                    TASK-MODEL ROUTER                                  │  │
│  │                    package/router/                                    │  │
│  │                                                                       │  │
│  │  ISC complexity signals → executor decision → model selection         │  │
│  │                                                                       │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │  Trivial extraction    →  inline (lightweight tier)             │  │  │
│  │  │  Needs coordination    →  team (TeamCreate)                     │  │  │
│  │  │  Architectural         →  subagent (Architect)                  │  │  │
│  │  │  Long-horizon coding   →  command-code (Kimi K2.7)              │  │  │
│  │  │  Multi-file + tools    →  subagent (Engineer + worktree)        │  │  │
│  │  │  Validation/review     →  command-code (Gemini 3.5 Flash)       │  │  │
│  │  │  Standard coding       →  command-code (DeepSeek v4 Flash)      │  │  │
│  │  │  Default               →  command-code (Claude Sonnet 5)        │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                   │                                         │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                    CONDUCTOR INTEGRATION                              │  │
│  │                    package/conductor/                                 │  │
│  │                                                                       │  │
│  │  shape → plan → execute → verify → improve → review → ship            │  │
│  │                    ↓                                                  │  │
│  │           routed-execute.sh                                           │  │
│  │           (replaces general-purpose dispatch)                         │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Enrichment Core (`package/enrich/`)

The SP0 enrichment pipeline that provides ISA-driven context to all surfaces.

| File | Purpose |
|------|---------|
| `contract.ts` | Type definitions (Surface, Mode, EnrichInput, ResolvedContext) |
| `resolver.ts` | I/O layer - resolves ISA, memory, planning state |
| `index.ts` | Assembler - runs stages, wraps in `<temperance-context>` |
| `stages/*.ts` | Pure functions: classify, intent, guardrails, isaPointer, memory, dispatch |

**Output format:**
```xml
<temperance-context>
mode/tier: ALGORITHM | reason: multi-step build | source: claude-adapter
intent: implement auth middleware | not: breaking changes
guardrails: Paths must be generalized through $HOME | anti: none
isa: /path/to/ISA.md
memory: worked=/path/to/reflection failed=/path/to/failure
</temperance-context>
```

### 2. Surface Adapters (`package/adapters/`)

Surface-specific hooks that invoke the enrichment core.

| Surface | Adapter | Installation |
|---------|---------|--------------|
| Claude Code | `~/.claude/hooks/PromptProcessing.hook.ts` | Via install.sh |
| Codex | `package/adapters/codex/PromptProcessing.hook.sh` | Copy to `~/.codex/hooks/` |
| OpenCode | `package/adapters/opencode/PromptProcessing.hook.sh` | Copy to `~/.config/opencode/hooks/` |
| Command Code | `package/adapters/command-code/generate-agents-md.sh` | Via parallel-dispatch.sh |

All adapters:
- Read from the same ISA sources
- Emit the same `<temperance-context>` block format
- Fail-open (never block a session)

### 3. Task-Model Router (`package/router/`)

Routes tasks to optimal backends and models based on complexity signals.

**Backends supported:**
| Backend | CLI | Models | Strengths |
|---------|-----|--------|-----------|
| `command-code` | `command-code` | 35 models | Versatile, many providers |
| `kimi` | `kimi` | K2.7 Code | 262K context, long-horizon coding |
| `grok` | `~/.grok/bin/grok` | grok-composer-2.5-fast, grok-build | Fast iteration, fresh perspective |
| `nvidia` | NVIDIA API | Nemotron Ultra/Super | Reasoning, efficient |

**Task types & routing:**
| Task Type | Triggers | Primary Backend | Fallback |
|-----------|----------|-----------------|----------|
| `fast` | "quick", "simple", "minor" | grok | command-code |
| `long-horizon` | "refactor", "migrate", "redesign" | kimi | command-code (Kimi K2.7) |
| `reasoning` | "analyze", "debug", "explain" | nvidia | command-code (Fable) |
| `validation` | "review", "verify", "audit" | grok (build) | command-code (Gemini) |
| `creative` | "brainstorm", "explore", "design" | grok | command-code |
| `inline` | "extract", "list" (no tool use) | inline (current session) | - |
| `balanced` | Default | command-code | kimi |

**Usage:**
```bash
# Route a single task (human output)
./package/router/multi-backend-router.sh "implement auth middleware"

# Get JSON output
./package/router/multi-backend-router.sh --json "refactor the database layer"

# Generate execution command
./package/router/multi-backend-router.sh --command "implement auth"

# Execute directly
./package/router/multi-backend-router.sh --execute "quick fix: update comment"

# Force specific backend
./package/router/multi-backend-router.sh --backend kimi "long coding task"

# List available backends
./package/router/multi-backend-router.sh --list-backends

# List all models in catalog
./package/router/multi-backend-router.sh --list-models
```

**Parallel dispatch:**
```bash
# Compare task across multiple backends
./package/router/parallel-backend-dispatch.sh "implement auth middleware"

# Force specific backends
./package/router/parallel-backend-dispatch.sh --backends "kimi,grok" "refactor API"

# Use all available backends
./package/router/parallel-backend-dispatch.sh --all "analyze architecture"
```

### 4. Conductor Integration (`package/conductor/`)

Integrates the router into the conductor loop's Execute phase.

**Usage:**
```bash
# Execute routed tasks from tasks.md
./package/conductor/routed-execute.sh tasks.md plan.md

# Dry-run (see routing without executing)
./package/conductor/routed-execute.sh --dry-run tasks.md
```

**tasks.md format:**
```markdown
## Tasks

- [ ] T01 [P] Implement auth middleware
- [ ] T02 [P] Write unit tests for auth
- [ ] T03 Document the auth flow
- [ ] T04 Review security implications
```

`[P]` marks tasks for parallel execution.

## Model Catalog

### Command Code (35 models)
| Model | Tier | Strength | Use Case |
|-------|------|----------|----------|
| `deepseek/deepseek-v4-flash` | fast | Speed | Fast iteration, standard coding |
| `deepseek/deepseek-v4-pro` | deep | Reasoning | Complex analysis |
| `moonshotai/Kimi-K2.7-Code` | deep | Long-horizon | Large refactors, 1M context |
| `claude-sonnet-5` | balanced | Balance | Default, general work |
| `claude-fable-5` | premium | Reasoning | Complex analysis |
| `google/gemini-3.5-flash` | fast | Parallel | Validation, fresh perspective |
| `Qwen/Qwen3.7-Max` | deep | Frontier | Cutting-edge coding |
| `gpt-5.5` | premium | General | General tasks |

### Kimi CLI (Direct)
| Model | Tier | Strength | Use Case |
|-------|------|----------|----------|
| `kimi-code/kimi-for-coding` | deep | Coding | 262K context, long-horizon coding |

### Grok CLI
| Model | Tier | Strength | Use Case |
|-------|------|----------|----------|
| `grok-composer-2.5-fast` | fast | Creative | Fast iteration, exploratory |
| `grok-build` | balanced | Coding | Validation, fresh perspective |

### NVIDIA API
| Model | Tier | Strength | Use Case |
|-------|------|----------|----------|
| `nvidia/nemotron-3-ultra-550b` | premium | Reasoning | Complex analysis |
| `nvidia/llama-3.3-nemotron-super-49b` | balanced | Efficient | Cost-effective reasoning |

## Delegation Patterns

### Two-Tier Delegation

| Tier | Model | Max Turns | Use Case |
|------|-------|-----------|----------|
| Lightweight | haiku / deepseek-flash | 3 | One-shot extraction, classification |
| Full | sonnet / kimi-k2.7 | unlimited | Multi-step, tool use, iteration |

**Decision rule:** "Can this be answered in one LLM call with no tool use?" → Lightweight. Otherwise → Full.

### Dispatch Modes

1. **Inline** - Handle in current session (lightweight tier)
2. **Subagent** - `Task(subagent_type)` with built-in agents
3. **Command Code** - External CLI with 35 models
4. **Team** - `TeamCreate` for coordinated multi-turn work

## Installation

### Quick Install

```bash
cd temperance_engine
./install.sh
```

This installs:
- Enrichment core to `~/.claude/PAI/enrich/`
- Claude Code adapter to `~/.claude/hooks/`

### Manual Adapter Installation

**Codex:**
```bash
cp package/adapters/codex/PromptProcessing.hook.sh ~/.codex/hooks/
# Add to ~/.codex/settings.json
```

**OpenCode:**
```bash
cp package/adapters/opencode/PromptProcessing.hook.sh ~/.config/opencode/hooks/
# Configure in opencode.json
```

**Command Code:**
```bash
# No installation needed - parallel-dispatch.sh generates per-task AGENTS.md
```

## Usage Flows

### Flow 1: Single Session with Multi-Model Dispatch

```
User prompt
    │
    ▼
[Enrichment] → <temperance-context>
    │
    ▼
[Classify as ALGORITHM]
    │
    ▼
[Decompose into ISCs]
    │
    ├─────────────────────────────────────┐
    ▼                                     ▼
[Route ISC-1]                         [Route ISC-2]
    │                                     │
    ▼                                     ▼
[DeepSeek Flash]                      [Kimi K2.7]
(fast coding)                         (long-horizon)
    │                                     │
    └─────────────────────────────────────┘
                    │
                    ▼
            [Collect Results]
                    │
                    ▼
            [Verify per ISC]
                    │
                    ▼
            [Synthesize & Ship]
```

### Flow 2: Conductor Loop with Routed Execute

```
spec.md → /specify
    │
    ▼
plan.md → /plan
    │
    ▼
tasks.md → /tasks
    │
    ▼
[routed-execute.sh]
    │
    ├── [Route each task]
    │       │
    │       ├── inline → handle in session
    │       ├── subagent → Task(Engineer/Architect)
    │       ├── command-code → deepseek/kimi/gemini
    │       └── team → TeamCreate flow
    │
    ▼
[Verify per task]
    │
    ▼
[Ship battery]
```

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `TEMPERANCE_ENRICH_DIR` | `~/.claude/PAI/enrich` | Enrichment core location |
| `TEMPERANCE_DISPATCH_DIR` | `/tmp/temperance-dispatch` | Dispatch workspace |
| `CLAUDE_PROJECT_DIR` | `$PWD` | Working directory |
| `CODEX_PROJECT_DIR` | `$PWD` | Working directory (Codex) |
| `OPENCODE_PROJECT_DIR` | `$PWD` | Working directory (OpenCode) |

## Fail-Open Guarantees

All components are designed to never block a session:

1. **Enrichment fails** → Falls back to `SOURCE: fail-safe`
2. **ISA not found** → `guardrails: none`
3. **Router fails** → Falls back to `claude-sonnet-5`
4. **Command-code fails** → Logged, other tasks continue
5. **Stage throws** → Omitted from block, others continue

## Security Notes

- Adapters **read-only** from ISA and memory
- No credentials stored in enrichment context
- Dispatch workspaces are ephemeral (`/tmp/`)
- All external model calls go through authenticated CLIs

## Related Documentation

- [ISA Skill](../skills/ISA/SKILL.md) - Ideal State Artifact specification
- [Delegation Skill](~/.agents/skills/delegation/SKILL.md) - Agent orchestration patterns
- [Conductor Core](~/.agents/skills/conductor-core/SKILL.md) - Closed-loop execution
- [Command Code Docs](https://commandcode.ai/docs) - External CLI reference

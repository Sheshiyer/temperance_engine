# Command Code Adapter

SP0 enrichment adapter for [Command Code](https://commandcode.ai) - enables parallel multi-model dispatch with ISA-driven context.

## Overview

This adapter bridges Temperance Engine's SP0 enrichment to Command Code sessions:

```
┌──────────────────────────────────────────────────────────┐
│                    SP0 ENRICHMENT                        │
│  ISA → guardrails, intent, memory pointers               │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│              COMMAND CODE AGENTS.MD                      │
│  Task context + guardrails + memory                      │
└────────────────────────┬─────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   ┌─────────┐     ┌─────────┐     ┌─────────┐
   │DeepSeek │     │  Kimi   │     │ Claude  │
   │ v4-flash│     │ K2.7    │     │ Sonnet  │
   └─────────┘     └─────────┘     └─────────┘
```

## Usage

### Generate AGENTS.md (standalone)

```bash
npx ts-node generate-agents-md.ts \
  --task "implement auth middleware" \
  --cwd /path/to/project \
  --model deepseek-v4-flash \
  > /tmp/workspace/AGENTS.md
```

### Parallel Dispatch (via script)

```bash
# Single task, single model
../scripts/parallel-dispatch.sh \
  --task "implement auth middleware" \
  --model deepseek-v4-flash

# Same task, compare 3 models
../scripts/parallel-dispatch.sh \
  --compare "implement auth middleware"

# Multiple tasks from JSON
../scripts/parallel-dispatch.sh \
  --tasks-file tasks.json
```

### Tasks JSON format

```json
[
  { "task": "implement auth middleware", "model": "deepseek-v4-flash" },
  { "task": "write tests for auth", "model": "kimi-k2.7-code" },
  { "task": "document auth flow", "model": "claude-sonnet-5" }
]
```

## Model Selection Matrix

| Task Type | Recommended Model | Rationale |
|-----------|-------------------|-----------|
| Fast iteration | `deepseek-v4-flash` | Speed, low cost |
| Long-horizon coding | `kimi-k2.7-code` | 1M context, persistence |
| Complex reasoning | `claude-fable-5` | Deep analysis |
| Multi-file refactor | `qwen3.7-max` | Frontier coding |
| Validation/review | `gemini-3.5-flash` | Fresh perspective |
| Balanced | `claude-sonnet-5` | Best speed/intelligence |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TEMPERANCE_DISPATCH_DIR` | `/tmp/temperance-dispatch` | Workspace root |
| `HOME` | system | ISA/memory resolution root |

## Output Structure

```
/tmp/temperance-dispatch/
├── workspaces/
│   ├── deepseek-v4-flash_12345/
│   │   └── AGENTS.md
│   └── kimi-k2.7-code_12346/
│       └── AGENTS.md
├── logs/
│   ├── deepseek-v4-flash_0.log
│   └── kimi-k2.7-code_1.log
└── results/
    └── 20260702T150000/
        ├── SUMMARY.md
        ├── deepseek-v4-flash_0.md
        └── kimi-k2.7-code_1.md
```

## Integration with Task tool

From an OpenCode/Claude session, dispatch to Command Code:

```typescript
// Parallel dispatch via Task tool
Task("Run: ../scripts/parallel-dispatch.sh --compare 'implement auth'")

// Or via bash directly
bash(`
  cd /path/to/temperance_engine
  ./scripts/parallel-dispatch.sh \
    --task "implement auth middleware" \
    --model deepseek-v4-flash
`)
```

## Fail-Open Behavior

The adapter inherits SP0's fail-open contract:
- If ISA resolution fails → minimal AGENTS.md with task only
- If enrichment throws → fallback to basic context
- If command-code fails → logged, other sessions continue

## License

Apache-2.0 (same as parent Temperance Engine)

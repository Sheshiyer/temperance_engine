# CodeGraph Routing

Temperance Engine routes `.agents` structural search through CodeGraph.

## Why

Home-directory semantic retrieval can be blocked by dynamic-index security or provider errors. CodeGraph uses a local initialized index and is better for symbols, files, call graphs, and architecture questions.

## Index Target

```bash
cd "$HOME/.agents"
codegraph init -i
```

## Routing Rule

For structural questions about agent skills, skill-clusters, cluster scripts, or `.agents` code, use CodeGraph with:

```text
projectPath: "$HOME/.agents"
```

Use direct file reads or text search only for literal text queries or known files.

## OpenCode MCP

The included OpenCode template enables CodeGraph and disables Augment by default:

```json
{
  "mcp": {
    "augment-context-engine": { "enabled": false },
    "codegraph": { "enabled": true }
  }
}
```

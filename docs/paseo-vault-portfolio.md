# Paseo vault portfolio

Temperance treats project discovery and agent execution as separate concerns:

- The vault inventory decides which local repositories belong to the working
  portfolio.
- Paseo gives each present repository a project and local-checkout workspace.
- Orchestration preferences choose a provider/model portfolio when an agent is
  launched.
- A repository's optional `paseo.json` controls setup, teardown, scripts,
  services, and metadata generation for that repository.

Registering a project does not import historical sessions, launch an agent, run
a model, create a worktree, or add a `paseo.json` file.

## Why reconciliation uses the daemon

Paseo's running daemon owns project and workspace state. The reconciler reads
the live workspace list and creates missing local workspaces through the Paseo
CLI. It never edits `projects.json` or `workspaces.json` directly.

Before a live apply, the current project registry is copied into a timestamped
forensic snapshot. A receipt records every preserved, created, duplicate, or
invalid inventory entry and the IDs returned for newly created workspaces.
Rollback is performed by archiving workspace IDs from that receipt, not by
overwriting live registry files.

## Role routing

The example in
`package/paseo/orchestration-preferences.example.json` uses:

| Role | Paseo provider/model | Purpose |
|---|---|---|
| implementation | `opencode/omniroute/te-dispatch` | Spark-enabled parallel fleet |
| planning | `opencode/omniroute/te-plan` | quota-aware planning |
| research | `opencode/omniroute/te-write-research` | research council |
| audit | `opencode/omniroute/te-validate` | independent validation council |
| UI | `claude/claude-fable-5` | native visual and human-skill work |

OpenCode is the client loop for OmniRoute-backed portfolios. Paseo supplies the
remote control plane around that local provider, so the same project workspace
can be operated from desktop, CLI, mobile, or another paired Paseo client.
Paseo does not make a local checkout exist on another machine: the daemon host
must retain access to the repository paths.

## Reconcile a portfolio

Dry-run is the default:

```sh
bun scripts/paseo-vault-projects.ts \
  --inventory /path/to/_projects_inventory.json
```

Apply after reviewing the create, preserve, duplicate, and error counts:

```sh
bun scripts/paseo-vault-projects.ts \
  --inventory /path/to/_projects_inventory.json \
  --apply \
  --allow-invalid
```

Omit `--allow-invalid` when the inventory has no stale records. If invalid
records exist, apply aborts before mutation unless this acknowledgment is
present; with it, only valid roots are reconciled and every invalid record
remains named in the receipt.

Run the same apply command again. A healthy second run reports zero creations.
This proves sequential convergence and is the safest regular refresh procedure.
Apply runs are single-flight: a second overlapping run fails closed on an
exclusive lock. Immediately before every creation, the reconciler also reloads
the daemon workspace list so an externally created workspace is preserved
instead of duplicated.

## Inventory edge cases

- Paths are compared canonically without trimming whitespace. A repository
  directory whose name ends in a space remains a distinct, valid path.
- Missing paths and directories that are not their own Git root fail closed and
  remain visible in the receipt.
- Multiple active workspaces for one path are reported but not automatically
  archived. This can be intentional when a project has task-specific workspaces.
- Different checkouts that share a Git remote remain different Paseo projects.
- Global archives and GitHub-only repositories are absent unless the supplied
  inventory explicitly includes them.

## Repository-local project settings

Add `paseo.json` only when a repository needs repeatable setup, services,
scripts, or metadata-generation instructions. Commit that file to the
repository's base branch so new Paseo worktrees can read it.

Do not generate one generic `paseo.json` across a mixed portfolio. Package
managers, service dependencies, secrets, and teardown needs differ by project;
incorrect setup automation is more disruptive than leaving those optional
settings absent.

# Rollback

Installer writes are preceded by backups when a destination file already exists.

## Backup Location

```bash
$HOME/.temperance_engine/backups
```

Override with:

```bash
TEMPERANCE_BACKUP_DIR=/path/to/backups ./install.sh
```

## Restore Manually

Review the newest timestamped folder, then copy files back to their original locations.

Example:

```bash
cp "$HOME/.temperance_engine/backups/<timestamp>/AGENTS.md" "$HOME/AGENTS.md"
```

## Stop Optional Pulse Compatibility Server

The Pulse compatibility server is installed only when Claude/Pulse compatibility was enabled with `--with-claude`. If you did not opt in, this path will not exist.

```bash
if [ -f "$HOME/.claude/PAI/PULSE/compat-server.pid" ]; then
  kill "$(cat "$HOME/.claude/PAI/PULSE/compat-server.pid")"
fi
```

## Restart Apps

After rollback, restart OpenCode and Cursor sessions so they reload instruction surfaces. Restart Claude or Codex only if those optional templates were installed.

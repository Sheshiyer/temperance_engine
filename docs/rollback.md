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

## Stop Pulse Compatibility Server

```bash
if [ -f "$HOME/.claude/PAI/PULSE/compat-server.pid" ]; then
  kill "$(cat "$HOME/.claude/PAI/PULSE/compat-server.pid")"
fi
```

## Restart Apps

After rollback, restart Claude, Codex, and OpenCode sessions so they reload instruction surfaces.

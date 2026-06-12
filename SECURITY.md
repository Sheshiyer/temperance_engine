# Security

Temperance Engine modifies local AI-agent configuration files. Treat it like developer tooling with access to your home-directory config surface.

## Review Before Running

Read `install.sh`, `scripts/*.sh`, and `package/pulse-compat/compat-server.ts` before installation.

## Secrets

Do not commit:

- API keys or model tokens.
- Claude, Codex, OpenCode, or GitHub auth files.
- Private memory folders.
- Audio packs unless you own redistribution rights.
- Generated backups.

## Network Behavior

The local Pulse compatibility server listens on `127.0.0.1:31337` by default. It accepts local JSON POSTs to `/notify` and triggers a local peon-ping command when configured.

## Reporting Issues

Open a GitHub issue with a redacted description, OS, shell, install flags, and relevant logs. Do not include secrets or private memory content.

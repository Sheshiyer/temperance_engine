# Peon-Ping Packs

Temperance Engine references peon-ping packs but does not bundle audio files. Users must provide packs they have rights to use.

## Skip Behavior

- Non-macOS hosts skip voice by default.
- Any host can skip voice with `./install.sh --skip-voice`.
- macOS users can force voice probing with `./install.sh --with-voice`.

## Pack Mapping

| PAI phase | Pack | Meaning |
|---|---|---|
| Native | `nier-2b` | Fast local action |
| Algorithm entry | `nier-2b` | Full loop begins |
| Observe | `glados` | Inspect live state |
| Think | `hal_2001` | Reason and diagnose |
| Plan | `jarvis-mk2` | Choose implementation route |
| Build | `peon` | Construct artifacts |
| Execute | `nier-2b` | Apply the chosen action |
| Verify | `cortana` | Prove the result |
| Learn | `sc_kerrigan` | Record and consolidate |

## Expected Local Script

```bash
$HOME/.claude/hooks/peon-ping/peon.sh
```

The compatibility server calls it with a pack and category. If the script is absent, notifications still return JSON but no sound is played.

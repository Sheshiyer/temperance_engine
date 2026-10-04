# Simplified Technical English (STE)

This document is in Simplified Technical English (STE).
The STE docs gate checks this document. Refer to [The docs gate](#the-docs-gate).

## What STE is

STE is a controlled language for technical documentation.
The specification ASD-STE100 gives the rules and a dictionary of approved words.
Text in STE is clear, short, and easy to translate.
ASD (AeroSpace and Defence Industries Association of Europe) owns the specification.
You can get the specification free of charge from https://www.asd-ste100.org.

Temperance Engine uses STE in two ways:
- An optional agent skill tells agents to write technical text in STE.
- A docs gate stops new STE errors in the Temperance Engine docs.

## The skill

The skill is [0xpili/simplified-technical-english](https://github.com/0xpili/simplified-technical-english).
Its text and its check script have the MIT license.
Temperance Engine does not include a copy of the skill.
The installer gets the skill from GitHub at a pinned commit.

| Item | Value |
|---|---|
| Repository | `https://github.com/0xpili/simplified-technical-english.git` |
| Pinned commit | `1e148d670cba46685ad2b4c3f2354a637a7fdbbe` |
| Skill folder | `$AGENTS_HOME/skills/simplified-technical-english` |

### Install the skill

The skill is optional. The installer does not install the skill if you do not ask for it.

```bash
./install.sh --with-ste
./install.sh --with-ste --with-claude
./install.sh --dry-run --with-ste
```

You can also run the installer script alone:

```bash
TEMPERANCE_ROOT="$PWD" TEMPERANCE_STE_MODE=install sh scripts/install-ste.sh
```

The installer does these steps:
1. It gets the skill at the pinned commit into `$STE_SKILL_HOME`.
2. It makes sure that `HEAD` is the pinned commit.
3. It makes sure that `SKILL.md`, `references/word-list.md`, `NOTICE.md`, and `LICENSE` exist.
4. If the Claude mode is install, it links `$PAI_HOME/skills/simplified-technical-english` to the skill folder.
5. If the OpenCode mode is install, it links `$OPENCODE_HOME/skills/simplified-technical-english` to the skill folder.

If the skill folder is already at the pinned commit, the installer does not change it.
If the skill folder is at a different commit or has local changes, the installer stops.
To replace the skill folder, add `--force`.
The installer then puts a backup of the old folder in `$TEMPERANCE_BACKUP_DIR`.
The installer gets and checks the new skill before it moves the old folder.
If that step fails, the old folder and its links do not change.

These environment variables change the installer:

| Variable | Default |
|---|---|
| `STE_SKILL_HOME` | `$AGENTS_HOME/skills/simplified-technical-english` |
| `STE_PIN` | The pinned commit |
| `STE_REPO_URL` | The upstream repository |

### Use the skill

In Claude Code, type `/simplified-technical-english`, or ask for STE.
On the default macOS host profile, the managed Temperance agents in OpenCode allow the skill.
The EC2 host profile has a different list of skills. On that profile, the managed agents do not allow the skill.
The skill applies to technical text only.
The skill does not apply to code, commands, or sales text.

## The check tool

`package/ste-check/cli.ts` is a bun port of the upstream `scripts/ste_check.py`.
The port gives the same output and the same exit codes as the upstream tool.
Temperance Engine does not need Python.

```bash
bun package/ste-check/cli.ts --mode procedural draft.md
bun package/ste-check/cli.ts --mode descriptive chapter.md
cat draft.txt | bun package/ste-check/cli.ts --mode mixed
```

| Mode | Use |
|---|---|
| `procedural` | Text that tells the reader to do something. Maximum 20 words in a sentence. |
| `descriptive` | Text that gives information. Maximum 25 words in a sentence. |
| `mixed` | Text of the two types. This is the default mode. |

The exit code is 0 when the text has no errors.
The exit code is 1 when the text has errors.
The exit code is 2 when the command is not correct.

The tool also compares each word with the approved word list.
The tool finds the word list in the skill folder.
If the skill is not installed, the tool does not do the word check.
Use `--word-list` to give a different word list.
Use `--no-vocab` to stop the word check.

The upstream `SKILL.md` tells agents to run `python3 scripts/ste_check.py`.
In Temperance Engine, use `bun package/ste-check/cli.ts` instead.

## The docs gate

The docs gate is `package/ste-check/docs-gate.ts`.
The gate checks the docs in `package/ste-check/docs-scope.json`.
The file `package/ste-check/docs-baseline.json` keeps the permitted number of errors for each doc.

The gate fails in these conditions:
- A doc has more errors than its baseline.
- A doc that is not in the baseline has one or more errors.

The gate checks only the structural rules. The gate does not use the word list.
Thus, the gate does not need the network or the skill.
`scripts/verify-all.sh` runs the gate, and CI runs `scripts/verify-all.sh`.

When you write a new doc, do these steps:
1. Write the doc in STE.
2. Run `bun package/ste-check/docs-gate.ts`.
3. If the gate fails, run `bun package/ste-check/cli.ts --no-vocab --mode <mode> <file>`.
4. Correct each error. Then run the gate again.

When you correct errors in an old doc, do these steps:
1. Run `bun package/ste-check/docs-gate.ts --tighten`.
2. Commit the new `docs-baseline.json` with the doc.

Do not increase a number in the baseline to make the gate pass.
The `--tighten` option never increases a number.

These files are not in the scope of the gate:
- `README.md`. A script makes parts of this file, and the file must keep its emoji headings.
- `CHANGELOG.md`, `ISA.md`, `CREDITS.md`, `UPSTREAM.md`, and `THIRD_PARTY_NOTICES.md`
- `templates/` and `docs/site/`
- The two retired stubs

## Limits

The check tool cannot find all the errors.
The tool cannot know if each word has its approved definition.
A person who knows STE must also examine an important text.

The skill is not an official ASD product.
ASD and the STE Maintenance Group did not approve the skill and do not endorse it.
The skill does not certify compliance with ASD-STE100.
If your project must comply with ASD-STE100, use the official specification.

## Copyright

ASD-STE100 is a registered trade mark of ASD.
The ASD-STE100 dictionary is the property of ASD.
Temperance Engine does not include the approved word list.
The installer gets the word list from the upstream skill.
Refer to [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## Remove the skill

Run the installer in uninstall mode:

```bash
TEMPERANCE_ROOT="$PWD" TEMPERANCE_STE_MODE=uninstall sh scripts/install-ste.sh
```

The installer removes only the links that point to the managed skill folder.
It moves the skill folder to the backup folder. It does not delete the folder.
Refer to [docs/rollback.md](rollback.md).

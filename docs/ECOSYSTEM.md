# Temperance ecosystem (compose, do not merge)

Wiring diagram for the glove product and the matching host runtime.
Owner table: [OWNERS.md](OWNERS.md). Versions: [release-control.md](release-control.md).

Alchemical **coding names** are display-only. Ports, LaunchAgents, and vendor CLIs keep their real names.

## Organs (alchemical coding names)

| Code | Vendor / process | Port | Job |
|---|---|---|---|
| **OPUS** | GSD / get-shit-done | files | Repo planning spine (`.planning/STATE.md`, ROADMAP) |
| **SPECULUM** | Manifest Zone | `:5173` | Visual projection glass |
| **VAS** | Manifest bridge | `:8766` | Observation vessel (JSONL + SSE) |
| **ATHANOR** | Pulse compat | `:31337` | Phase furnace (peon packs on `/notify`) |
| **CAMPANA** | peon-ping hooks | — | Bell on Claude lifecycle events |
| **VOX** | VoiceServer | `:8888` | Spoken non-phase (ElevenLabs) |
| **MERCURIUS** | OmniRoute | `:20128` | Messenger / model failover |
| **LIBER** | GitHub Project | web | Human book of record |
| **GRAPHIA** | CodeGraph | MCP | Structure of the matter |
| **ARCANUM** | skill-clusters | index | Capability resolution |
| **ISA** | Ideal State Artifact | files | Algorithm acceptance ledger |

## Map

```text
HUMAN ── Liber (GitHub) ── Speculum :5173
              │                    ▲ SSE
         Opus .planning            │
         ISA.md                    │
              │                    │
     rails / Algorithm ── Vas :8766
              │
     ┌────────┼──────────┬────────────┐
  Mercurius  Athanor   Campana      Vox
   :20128    :31337    peon.sh      :8888
```

Athanor and Speculum share an **operator HUD**, not a process. Vas `/health` reports `athanor.ok`. Speculum paints the chip. Agents still POST Athanor `/notify`.

## Compose vs never-merge

**Compose:** Opus artifacts → Vas watcher → Speculum PLANNING cards. Athanor health → Vas → Speculum chip. PAI alchemy strip beside Opus STATE.

**Never merge:** Athanor PID with Speculum PID; Opus workflows into Vas; ISA into Opus; Mercurius into Speculum; Liber into Speculum as an editable board; OmniRoute SemVer into glove `VERSION`.

## Version triple

`temperance_engine@VERSION + omniroute@PIN + host@HOST_VERSION`

See [COMPATIBILITY.md](COMPATIBILITY.md). Current pin: OmniRoute **3.8.48**.

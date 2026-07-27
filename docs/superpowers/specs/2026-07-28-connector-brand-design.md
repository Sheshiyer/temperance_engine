# Temperance Engine Connector Brand — Design

**Context:** follow-on from this session's architecture refresh
(`docs/architecture/omniroute-routing.html` and updates to the four
companion docs) and the PAI alchemical-sigil rework
(`~/.claude/PAI/Algorithm/v6.3.0.md`'s 7-phase Nigredo→Rubedo vocabulary).
The user asked to "brand all the connectors" (PAI, GSD, OmniRoute, Hermes,
Cloudflare Vectorize, NVIDIA) under Temperance Engine as the root brand.

**Status:** design (awaiting user review of this file before writing-plans).

---

## 1. Problem

Temperance Engine's docs currently describe the systems it touches — PAI,
GSD, OmniRoute, its EC2 co-location with Hermes — using each system's own
native vocabulary, with no consistent naming layer tying them together as
"parts of one thing." Separately, this session's research surfaced that
the literal request ("Temperance Engine as the main arch" for *everything*,
including Cloudflare Vectorize and NVIDIA) does not match reality: those
two belong to a much larger, live, actively-governed production system
(Thoughtseed: Cambium + Hermes + Plexus + Telegram, documented in that
monorepo's own `INFRA_STATUS.md`, outside this repository) in which
Temperance Engine is a parenthetical addendum to Hermes's
execution body, not an architectural root. That system already has its
own deliberate, actively-maintained brand (a plant-growth metaphor:
Cambium, organs named genesis/taste/hands/will/cortex) governed by its own
PRs and issue tracker (45 open issues on `hermes-aws-ts` alone as of
2026-07-16).

Renaming that system was confirmed **out of scope** during brainstorming
(see §3, D1). This design covers only what Temperance Engine itself owns.

## 2. Goal

Give Temperance Engine's *own* documentation a consistent, alchemical
connector vocabulary — consistent with the phase-sigil system already
built this session — for the systems it directly integrates with, while
factually and clearly marking everything it merely neighbors (without
inventing branding for systems it doesn't own or touch in code).

## 3. Decisions (locked — from the brainstorm)

| # | Decision | Rationale |
|---|---|---|
| **D1** | Scope is bounded to Temperance Engine's own ownership boundary, as its own docs already declare (`verify.sh only checks Temperance's own install surface`; ISA `Out of Scope`). Cambium/Hermes/Plexus/Thoughtseed's own naming is never touched. | Confirmed via brainstorming after the Thoughtseed/`INFRA_STATUS.md` discovery; renaming a live, issue-tracked, client-facing production system around a side-utility is out of proportion to the request's intent once the scale was visible. |
| **D2** | PAI gets a **display-only** rename to **the Athanor**. The technical folder `~/.claude/PAI`, the `$PAI_HOME` env var, and every hardcoded path reference are untouched in this pass. | Confirmed: full technical rename would touch 130+ files (already-edited this session for the sigil work) and risk breaking anything reading the old path, for a purely cosmetic goal. |
| **D3** | Naming style is **full alchemical proper nouns** for what Temperance owns (Athanor / Caduceus / Vigil), not plain functional labels. | Confirmed: consistent with the Nigredo/Albedo/Citrinitas/Rubedo phase names and 🜃☿🜍🜂🜄🜁🜔 sigils already built and applied this session. |
| **D4** | Deliverable is **docs-first**: a new companion doc + light touch-ups to existing docs + an ISA decision entry. Applying the new names to *live* display text (PAI's `Banner.ts`, hook output) is an explicitly separate, later pass — not part of this spec. | Confirmed: mirrors the two-phase approach already used for the emoji→sigil work (map it out and verify before touching anything users see at runtime). |
| **D5** | GSD, OmniRoute (the gateway product), and Hermes (the EC2 neighbor) keep their **real names** in all prose. Only Temperance's *own* code/integration layer around OmniRoute gets a connector name (Caduceus); GSD and Hermes get consistent *role* language, not new proper nouns, since Temperance doesn't own them even conceptually. | They're third-party or externally-governed; inventing brand names for systems Temperance doesn't control would be misleading, not clarifying. |
| **D6** | Cloudflare Vectorize and NVIDIA NIM embeddings get a **factual "neighbor" note**, not a connector name. NVIDIA-as-OmniRoute-model-provider (the tier-2 bench entry already in `omniroute-fallback-policy.json`) is documented as one row in the Caduceus's routing table, not a separate connector. | Temperance Engine has zero lines of code touching Vectorize or NVIDIA NIM directly — confirmed via full repo/vault survey (see agent research this session). Branding something never actually integrated would misrepresent the architecture. |

## 4. Non-goals (YAGNI)

- **Not** renaming or restructuring Cambium, Plexus, Telegram, TeamForge, or any Thoughtseed product branch (Fitcheck, Vantyx, Snow Gloves OS, IVerif).
- **Not** renaming `gsd-core`, OmniRoute (the gateway product), or `hermes-agent` (NousResearch's upstream) — third-party, not Temperance's to rename.
- **Not** a full technical rename of PAI (folder path, `$PAI_HOME`, hardcoded references) — display-only per D2.
- **Not** touching any live output text this pass (banners, hook `console.log` calls, CLI output) — docs-first per D4.
- **Not** inventing a connector identity for Cloudflare Vectorize or NVIDIA NIM — no code touches them (D6).
- **Not** a wholesale find-and-replace of "OmniRoute" → "Caduceus" (or similar) across existing prose in `docs/omniroute-*.md` — those docs correctly describe the *product*; only new material introduces the connector nickname, with a single cross-reference added to the existing docs.

## 5. Architecture — the connector taxonomy

```text
                         Temperance Engine (root brand)
                                    |
        +---------------+----------+----------+------------------+
        |               |                     |                  |
   the Athanor      the Caduceus          the Vigil        (role-language only,
   (PAI, display-   (Temperance's own     (package/headless, no new proper noun)
    only rename)     OmniRoute            EC2 shadow          |
        |             integration:         runtime)      "the workflow-backbone
   sigil: ⚗           proxy+reconciler+       |             connector" (gsd-core)
   (Alembic)           portfolios)         sigil: ☽
        |                  |               (Moon)
        |             sigil: 🝐
        |             (Caduceus,
        |              real alchemical
        |              glyph, U+1F750)
        |                  |
        |             connects to -> "the routing gateway" (OmniRoute product,
        |                             real name kept; NVIDIA appears here as
        |                             one tier-2 bench provider row, not its
        |                             own connector)
        |                  |
        +------------------+------ co-locates with ------> "Hermes" (real name
                                                              kept — the EC2
                                                              neighbor, NOT
                                                              renamed or claimed)

   Documented as NEIGHBORS, not connectors (no Temperance branding invented):
   Cambium, Plexus, Telegram, TeamForge, Thoughtseed product branches,
   Cloudflare Vectorize, NVIDIA NIM embeddings.
```

| Name | Referent | Owns? | Sigil | Treatment |
|---|---|---|---|---|
| the Athanor | PAI (`~/.claude/PAI`) | Yes | ⚗ | New proper noun, display-only |
| the Caduceus | Temperance's OmniRoute integration code (`package/router/*`) | Yes | 🝐 | New proper noun |
| the Vigil | `package/headless` EC2 shadow runtime | Yes | ☽ | New proper noun |
| "the workflow-backbone connector" | gsd-core | No (external) | — | Role language only, real name kept |
| "the routing gateway" | OmniRoute (the product) | No (external) | — | Real name kept; Caduceus connects *to* it |
| Hermes | NousResearch `hermes-agent` on EC2 | No (external) | — | Real name kept; Vigil co-locates *with* it |
| "the Grimoire" (optional, light touch) | skill-cluster resolver (`~/.agents/skill-clusters`) | Shared, not Temperance-exclusive | — | Nickname in passing prose only, no dedicated doc section |
| *(no name — documented as neighbor)* | Cambium, Plexus, Telegram, TeamForge, product branches, Cloudflare Vectorize, NVIDIA NIM | No | — | Factual note only |

## 6. Deliverable

### 6.1 New file: `docs/architecture/brand-connectors.html`

Sixth companion doc in the existing set (matches the CSS/layout system
established by `architecture.html`, `system-internals.html`,
`integration-map.html`, `session-trace.html`, `omniroute-routing.html` —
same `:root` variables, `.layer`/`.card`/`.grid`/`.callout`/table classes,
explicit `background: #ffffff` on body). Sections:

1. **Header + scope callout** — states the taxonomy is for what Temperance
   Engine owns only, with an explicit link to why (the Thoughtseed
   ownership-boundary finding), so nobody mistakes this for a claim over
   Cambium/Hermes/Plexus.
2. **The taxonomy diagram** — an SVG rendering of §5's tree (root → 3 owned
   connectors → neighbors), using the sigils as visual anchors, following
   the same box+arrow SVG pattern as the other docs.
3. **Connector reference table** — the table from §5, one row per name,
   with a one-paragraph rationale each (why Athanor, why Caduceus, why
   Vigil — the alchemical reasoning from the brainstorm). "The Grimoire"
   (skill-cluster resolver) appears here only as a one-sentence footnote
   below the table, explicitly labeled as a passing nickname rather than a
   fourth connector — it's shared infra Temperance doesn't exclusively
   own, so it doesn't get a table row, a sigil, or diagram placement.
4. **"Neighbors, not connectors" section** — explicit, named list of
   Cambium/Plexus/Telegram/TeamForge/product branches/Vectorize/NVIDIA-NIM,
   each with one line on the actual (indirect) relationship, so the
   boundary is undeniable on re-read.
5. **Deferred work note** — states plainly that live display text
   (banners, hook output) has NOT been updated yet, pointing at this spec
   as the record of that decision (D4), so a future session doesn't
   assume the rename already happened.
6. Standard Deep-Dives grid + footer, linking back to the other 5 docs.

### 6.2 Touch-ups to existing docs

- `docs/architecture/architecture.html` — one new Deep-Dives card linking
  `brand-connectors.html`.
- `docs/architecture/omniroute-routing.html` — one sentence in the scope
  callout noting Temperance's own integration layer is nicknamed "the
  Caduceus," with a link to the new doc. No renaming of existing section
  headers or the combo/provider tables.

### 6.3 ISA.md

One Decision entry recording the taxonomy and the scope boundary (D1–D6
condensed), dated 2026-07-28, plus a row in the arch-assets table for the
new HTML file (same pattern used for `omniroute-routing.html` earlier this
session).

## 7. Verified gap register (implementation must satisfy)

1. `brand-connectors.html` exists, renders without visual breakage
   (verified in-browser, matching the QA pattern used for the other 5
   docs this session), and its internal links resolve.
2. Every one of the other 5 architecture docs that links to companion docs
   still has working links after the touch-up (no broken cross-references
   introduced).
3. The new doc explicitly names Cambium, Plexus, Telegram, TeamForge, the
   Thoughtseed product branches, Cloudflare Vectorize, and NVIDIA NIM as
   neighbors — grep-able proof the boundary isn't just implied.
4. No file outside `docs/` and `ISA.md` (repo root) is modified in this
   pass (no code, no live banner/hook text, nothing under `~/.claude/PAI`
   besides what's already done, nothing in Hermes/Cambium's own repos).
5. ISA.md's arch-assets table and Decisions section both reflect the new
   doc and the taxonomy decision.
6. `git status` after implementation shows only the expected files: the
   new HTML doc, this spec, the two touched HTML files, and ISA.md.

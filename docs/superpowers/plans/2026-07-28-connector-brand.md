# Temperance Engine Connector Brand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Temperance Engine's own docs a consistent alchemical connector vocabulary (the Athanor / the Caduceus / the Vigil) for the systems it actually owns, while explicitly documenting Cambium/Hermes/Plexus/Vectorize/NVIDIA as neighbors rather than inventing branding for systems Temperance doesn't control.

**Architecture:** One new companion doc (`docs/architecture/brand-connectors.html`, sixth in the existing set) is the authoritative reference; two existing docs get a one-line cross-reference each; ISA.md gets a Decision entry and an arch-assets row. No code, no live display text, and nothing outside this repo's `docs/`+`ISA.md` is touched.

**Tech Stack:** Static HTML/CSS/SVG matching the existing `docs/architecture/*.html` design system (CSS custom properties, `.layer`/`.card`/`.grid`/`.callout`/table classes); Markdown for ISA.md.

## Global Constraints

- Sigils used: ⚗ (Alembic, U+2697) for the Athanor; 🝐 (Alchemical Symbol for Caduceus, U+1F750) for the Caduceus; ☽ (Moon, U+263D) for the Vigil. Verify each codepoint with `python3 -c "import unicodedata; print(unicodedata.name('<char>'))"` before use if copy-pasting — a wrong glyph shipped once already in this session's spec draft.
- New HTML file must include `background: #ffffff` on `body` explicitly (the existing 5 docs all needed this fix — dark-mode browsers otherwise invert to unreadable dark-on-black).
- No renaming of GSD/`gsd-core`, OmniRoute (the product), or Hermes (`hermes-agent`) anywhere — real names only, role language in prose (Design §3 D5).
- No connector identity for Cloudflare Vectorize or NVIDIA NIM — factual neighbor note only (Design §3 D6).
- No edits to live display text (`Banner.ts`, hook `console.log` calls, CLI output) — docs-only this pass (Design §3 D4).
- No file outside `docs/` and `ISA.md` (repo root) may be modified (Design §7, gap-register item 4).

---

### Task 1: Create `docs/architecture/brand-connectors.html`

**Files:**
- Create: `docs/architecture/brand-connectors.html`

**Interfaces:**
- Consumes: the CSS design system from `docs/architecture/architecture.html` (copy its exact `<style>` block — `:root` variables `--data`/`--processing`/`--ai`/`--success`/`--private`/`--ink`/`--muted`/`--line`, `.layer`/`.card`/`.grid`/`.callout`/`.legend`/`.swatch` classes, table styles); the taxonomy content from `docs/superpowers/specs/2026-07-28-connector-brand-design.md` §5–§6.1.
- Produces: `docs/architecture/brand-connectors.html`, a file that Tasks 2 and 3 link to and that must exist before those tasks can add working links.

- [ ] **Step 1: Write the full HTML file**

Write this exact file content (the `<style>` block is copied verbatim from `docs/architecture/architecture.html`'s design system):

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Temperance Engine - Connector Brand</title>
<style>
  :root {
    --data: #4299e1;
    --processing: #ed8936;
    --ai: #9f7aea;
    --success: #48bb78;
    --private: #718096;
    --ink: #1a202c;
    --muted: #4a5568;
    --line: #e2e8f0;
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    max-width: 1200px;
    margin: 0 auto;
    padding: 20px;
    color: var(--ink);
    line-height: 1.5;
    background: #ffffff;
  }
  h1 {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 30px;
    border-radius: 10px;
    margin-bottom: 10px;
  }
  h1 small {
    display: block;
    font-weight: 400;
    font-size: 15px;
    opacity: 0.9;
    margin-top: 8px;
  }
  h2 {
    border-bottom: 3px solid var(--line);
    padding-bottom: 8px;
    color: var(--ink);
  }
  .section { margin: 36px 0; }
  .callout {
    background: #fffaf0;
    border: 1px solid #fbd38d;
    border-left: 5px solid var(--processing);
    border-radius: 8px;
    padding: 18px 22px;
    margin: 18px 0;
  }
  .callout strong { color: #9c4221; }
  svg { max-width: 100%; height: auto; display: block; margin: 0 auto; }
  .legend { display: flex; gap: 22px; flex-wrap: wrap; font-size: 13px; color: var(--muted); margin-top: 6px; }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .swatch { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 16px;
  }
  .card {
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 16px 18px;
    background: #fafafa;
  }
  .card h3 { margin-top: 0; font-size: 15px; color: var(--ink); }
  .card p { margin: 4px 0; font-size: 13.5px; color: var(--muted); }
  .layer {
    border-radius: 8px;
    padding: 14px 18px;
    margin: 8px 0;
    color: white;
    font-size: 14px;
  }
  .layer b { display: block; font-size: 15px; margin-bottom: 4px; }
  code {
    background: #edf2f7;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 0.9em;
  }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th, td { border: 1px solid var(--line); padding: 8px 10px; text-align: left; }
  th { background: #f7fafc; }
</style>
</head>
<body>

<h1>Connector Brand
  <small>What Temperance Engine names as its own, and what it only neighbors</small>
</h1>

<div class="section">
  <div class="callout">
    <strong>Scope.</strong> This taxonomy covers only what Temperance Engine itself owns and controls. It does not rename, restructure, or claim authority over Cambium, Hermes, Plexus, or any part of the separately-governed Thoughtseed production system (documented in that monorepo's own <code>INFRA_STATUS.md</code>, outside this repository) &mdash; that system already has its own deliberate brand (a plant-growth metaphor: Cambium, with organs named genesis/taste/hands/will/cortex) and is governed by its own PRs and issue tracker. Temperance Engine is a parenthetical addendum to Hermes's execution body in that system's own operating model, not its architectural root. Design record: <code>docs/superpowers/specs/2026-07-28-connector-brand-design.md</code>.
  </div>
</div>

<div class="section">
  <h2>1. The Taxonomy</h2>
  <svg viewBox="0 0 1080 380" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <marker id="arrowB" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill="#666"/>
      </marker>
    </defs>

    <rect x="440" y="10" width="200" height="60" rx="10" fill="#4a5568"/>
    <text x="540" y="35" text-anchor="middle" fill="white" font-size="13" font-weight="bold">Temperance Engine</text>
    <text x="540" y="55" text-anchor="middle" fill="#e2e8f0" font-size="10">root brand</text>

    <path d="M540,70 L540,95" stroke="#666" stroke-width="2" marker-end="url(#arrowB)"/>
    <path d="M540,95 L200,95" stroke="#666" stroke-width="2"/>
    <path d="M540,95 L540,95" stroke="#666" stroke-width="2"/>
    <path d="M540,95 L880,95" stroke="#666" stroke-width="2"/>

    <path d="M200,95 L200,120" stroke="#666" stroke-width="2" marker-end="url(#arrowB)"/>
    <path d="M540,95 L540,120" stroke="#666" stroke-width="2" marker-end="url(#arrowB)"/>
    <path d="M880,95 L880,120" stroke="#666" stroke-width="2" marker-end="url(#arrowB)"/>

    <rect x="100" y="120" width="200" height="90" rx="10" fill="#4299e1"/>
    <text x="200" y="145" text-anchor="middle" fill="white" font-size="14" font-weight="bold">⚗ the Athanor</text>
    <text x="200" y="165" text-anchor="middle" fill="white" font-size="10.5">PAI, display-only rename</text>
    <text x="200" y="180" text-anchor="middle" fill="#ebf8ff" font-size="9.5" font-style="italic">~/.claude/PAI unchanged</text>
    <text x="200" y="196" text-anchor="middle" fill="#ebf8ff" font-size="9.5">sigil: ⚗ (Alembic)</text>

    <rect x="440" y="120" width="200" height="90" rx="10" fill="#9f7aea"/>
    <text x="540" y="145" text-anchor="middle" fill="white" font-size="14" font-weight="bold">🝐 the Caduceus</text>
    <text x="540" y="165" text-anchor="middle" fill="white" font-size="10.5">Temperance's OmniRoute</text>
    <text x="540" y="180" text-anchor="middle" fill="#f3e8ff" font-size="9.5" font-style="italic">integration code (proxy+</text>
    <text x="540" y="194" text-anchor="middle" fill="#f3e8ff" font-size="9.5" font-style="italic">reconciler+portfolios)</text>

    <rect x="780" y="120" width="200" height="90" rx="10" fill="#718096"/>
    <text x="880" y="145" text-anchor="middle" fill="white" font-size="14" font-weight="bold">☽ the Vigil</text>
    <text x="880" y="165" text-anchor="middle" fill="white" font-size="10.5">package/headless EC2</text>
    <text x="880" y="180" text-anchor="middle" fill="#edf2f7" font-size="9.5" font-style="italic">shadow runtime</text>
    <text x="880" y="196" text-anchor="middle" fill="#edf2f7" font-size="9.5">sigil: ☽ (Moon)</text>

    <path d="M540,210 L540,235" stroke="#666" stroke-width="2" marker-end="url(#arrowB)"/>
    <rect x="420" y="235" width="240" height="45" rx="8" fill="#f7fafc" stroke="#e2e8f0"/>
    <text x="540" y="255" text-anchor="middle" font-size="10.5" fill="#4a5568">"the routing gateway"</text>
    <text x="540" y="270" text-anchor="middle" font-size="9.5" fill="#4a5568">(OmniRoute product, real name kept)</text>

    <path d="M880,210 L880,235" stroke="#666" stroke-width="2" marker-end="url(#arrowB)"/>
    <rect x="780" y="235" width="200" height="45" rx="8" fill="#f7fafc" stroke="#e2e8f0"/>
    <text x="880" y="255" text-anchor="middle" font-size="10.5" fill="#4a5568">"Hermes"</text>
    <text x="880" y="270" text-anchor="middle" font-size="9.5" fill="#4a5568">(EC2 neighbor, real name kept)</text>

    <rect x="60" y="310" width="960" height="55" rx="8" fill="#fffaf0" stroke="#fbd38d"/>
    <text x="540" y="332" text-anchor="middle" font-size="11" fill="#9c4221" font-weight="bold">Neighbors, not connectors -- no Temperance branding invented</text>
    <text x="540" y="350" text-anchor="middle" font-size="10" fill="#9c4221">Cambium &middot; Plexus &middot; Telegram &middot; TeamForge &middot; Thoughtseed product branches &middot; Cloudflare Vectorize &middot; NVIDIA NIM embeddings</text>
  </svg>
</div>

<div class="section">
  <h2>2. Connector Reference</h2>
  <table>
    <tr><th>Name</th><th>Referent</th><th>Sigil</th><th>Why</th></tr>
    <tr><td><b>the Athanor</b></td><td>PAI (<code>~/.claude/PAI</code>) &mdash; display-only rename, technical paths unchanged</td><td>⚗</td><td>The athanor is the alchemical furnace that sustains the Great Work day after day &mdash; the vessel hosting the Algorithm's 7-phase Nigredo&rarr;Rubedo loop.</td></tr>
    <tr><td><b>the Caduceus</b></td><td>Temperance's own OmniRoute integration code (<code>package/router/*</code> &mdash; the proxy, the reconciler, the governed portfolios)</td><td>🝐</td><td>The herald's staff &mdash; the classical symbol for routing and exchange between parties. A real alchemical glyph exists for it (U+1F750).</td></tr>
    <tr><td><b>the Vigil</b></td><td><code>package/headless</code>, the EC2 shadow runtime that co-locates with Hermes</td><td>☽</td><td>Night-watch, silent observation &mdash; captures "runs beside Hermes, watches, never touches Hermes's own units" better than the old generic "shadow" label.</td></tr>
  </table>
  <p style="font-size:13px;color:#4a5568;">"The Grimoire" (the skill-cluster resolver, <code>~/.agents/skill-clusters</code>) is sometimes used in passing prose as a nickname &mdash; it is <em>not</em> a fourth connector. It's shared infrastructure Temperance doesn't exclusively own, so it gets no table row, no sigil, and no diagram placement here.</p>
</div>

<div class="section">
  <h2>3. Referenced By Their Real Names</h2>
  <table>
    <tr><th>System</th><th>Role</th><th>Treatment</th></tr>
    <tr><td><code>gsd-core</code></td><td>Recommended-default workflow backbone</td><td>"the workflow-backbone connector" in prose; the tool keeps its real name (third-party, <code>open-gsd/gsd-core</code>)</td></tr>
    <tr><td>OmniRoute</td><td>The routing gateway product the Caduceus connects to</td><td>Real name kept; NVIDIA appears here only as one tier-2 bench provider row in the routing table, not its own connector</td></tr>
    <tr><td>Hermes</td><td>EC2 execution-body neighbor (NousResearch <code>hermes-agent</code>)</td><td>Real name kept; the Vigil co-locates <em>with</em> it, never claims it</td></tr>
  </table>
</div>

<div class="section">
  <h2>4. Neighbors, Not Connectors</h2>
  <p style="font-size:13.5px;color:#4a5568;">These belong to the separate, live, actively-governed Thoughtseed production system. Temperance Engine has no code touching any of them directly and invents no branding for them.</p>
  <table>
    <tr><th>System</th><th>Actual relationship</th></tr>
    <tr><td>Cambium</td><td>The "conductor-of-conductors" Worker at <code>curious.thoughtseed.space</code>; owns the Cloudflare D1/KV/R2/Vectorize plane. Temperance Engine has zero lines of code touching it.</td></tr>
    <tr><td>Plexus</td><td>The native member assistant in the Thoughtseed operating model; unrelated to Temperance's own routing or algorithm surfaces.</td></tr>
    <tr><td>Telegram</td><td>Founder/operator ingress for the Thoughtseed system; Temperance Engine has no Telegram surface.</td></tr>
    <tr><td>TeamForge</td><td>Retired plane in the Thoughtseed system; not part of Temperance Engine at any point.</td></tr>
    <tr><td>Thoughtseed product branches (Fitcheck, Vantyx, Snow Gloves OS, IVerif)</td><td>Client-facing product branches under Cambium; entirely outside Temperance Engine's scope.</td></tr>
    <tr><td>Cloudflare Vectorize (<code>cambium-cortex</code>)</td><td>Bound inside Cambium's own Worker, reached only indirectly &mdash; Hermes has its own <code>cortex-vectorize-client.ts</code>. Temperance Engine's repo has no <code>wrangler.toml</code>, no Cloudflare config, and no code calling Vectorize.</td></tr>
    <tr><td>NVIDIA NIM embeddings (<code>nv-embedqa-e5-v5</code>)</td><td>Feeds Cambium's Vectorize cortex, called from Cambium/Hermes code, not Temperance's. Temperance's only real NVIDIA touchpoint is the unrelated OmniRoute tier-2 bench model entry (<code>nvidia/deepseek-ai/deepseek-v4-pro</code>) &mdash; a routing-table row, not an integration.</td></tr>
  </table>
</div>

<div class="section">
  <h2>5. What Hasn't Changed Yet</h2>
  <div class="callout">
    <strong>Deferred.</strong> This is a documentation-only pass. The Athanor/Caduceus/Vigil names do not yet appear anywhere in live output &mdash; <code>~/.claude/PAI/Tools/Banner.ts</code>'s startup banner still says "PAI," hook <code>console.log</code> calls are unchanged, and no CLI output reflects this taxonomy. Applying these names to live display text is an explicit, separate follow-up (see Decision D4 in the design spec) &mdash; not assumed to have happened just because this doc exists.
  </div>
</div>

<div class="section">
  <h2>Deep Dives</h2>
  <div class="grid">
    <div class="card">
      <h3><a href="architecture.html">architecture.html</a></h3>
      <p>Productization narrative, install orchestration, and the full layered system view.</p>
    </div>
    <div class="card">
      <h3><a href="system-internals.html">system-internals.html</a></h3>
      <p>Component-by-component mechanics: exact flags, env vars, file writes, endpoints.</p>
    </div>
    <div class="card">
      <h3><a href="integration-map.html">integration-map.html</a></h3>
      <p>Which seams are real code paths (WIRED) versus documentation-only (REFERENCE ONLY).</p>
    </div>
    <div class="card">
      <h3><a href="session-trace.html">session-trace.html</a></h3>
      <p>Concrete walkthroughs, including an automatic chat request end to end.</p>
    </div>
    <div class="card">
      <h3><a href="omniroute-routing.html">omniroute-routing.html</a></h3>
      <p>OmniRoute gateway topology, the full combo roster, provider lanes, and the availability reconciler &mdash; what the Caduceus actually does.</p>
    </div>
  </div>
</div>

<p style="color:#a0aec0; font-size:12px; margin-top:40px;">Design record: <code>docs/superpowers/specs/2026-07-28-connector-brand-design.md</code>. Source of truth for the neighbor boundary: the Thoughtseed monorepo's own <code>INFRA_STATUS.md</code> (outside this repository).</p>

</body>
</html>
```

- [ ] **Step 2: Verify the file is well-formed**

Run:
```bash
python3 -c "
import re
text = open('docs/architecture/brand-connectors.html', encoding='utf-8').read()
open_div = len(re.findall(r'<div', text))
close_div = len(re.findall(r'</div>', text))
assert open_div == close_div, f'div mismatch: {open_div} open vs {close_div} close'
print(f'OK: {open_div} divs balanced')
"
```
Expected: `OK: N divs balanced` (no assertion error).

- [ ] **Step 3: Verify the sigil codepoints are correct before shipping**

Run:
```bash
python3 -c "
import unicodedata
for ch, expected_word in [('⚗','ALEMBIC'), ('🝐','CADUCEUS'), ('☽','MOON')]:
    name = unicodedata.name(ch)
    assert expected_word in name, f'{ch} is {name}, not {expected_word}'
    print(f'{ch} OK: {name}')
"
```
Expected: three `OK:` lines, no `AssertionError`.

- [ ] **Step 4: Render in the browser and visually verify**

Run `pwd` in this worktree to get its absolute root path, then navigate the Browser pane to `file://<worktree-root>/docs/architecture/brand-connectors.html`. Screenshot the full page top to bottom (scroll through all 6 sections), and confirm:
- The header/scope callout is legible (not dark-on-black — confirms `background: #ffffff` took effect).
- The taxonomy SVG renders without overlapping text or broken boxes.
- All 5 Deep-Dive links are present and styled as links (blue/underlined).
- No raw HTML entity text (like `&rarr;` showing literally instead of →) is visible anywhere.

Expected: clean render matching the visual style of the other 5 architecture docs.

- [ ] **Step 5: Click through every internal link**

In the browser, click each of the 5 Deep-Dive links and confirm each one loads its target file without a 404/file-not-found.

Expected: all 5 links resolve.

- [ ] **Step 6: Commit**

```bash
git add docs/architecture/brand-connectors.html
git commit -m "docs(architecture): add connector-brand reference (Athanor/Caduceus/Vigil)"
```

---

### Task 2: Link `brand-connectors.html` from `architecture.html`

**Files:**
- Modify: `docs/architecture/architecture.html` (Deep Dives section, the `<div class="grid">` block that currently has 4 cards)

**Interfaces:**
- Consumes: `docs/architecture/brand-connectors.html` from Task 1 (must exist first — this task adds a link to it).
- Produces: a working link from `architecture.html` to `brand-connectors.html`, which Task 1's Step 5 (if re-run) or Task 4's verification will check.

- [ ] **Step 1: Read the current Deep Dives section**

Run: `grep -n "omniroute-routing.html" docs/architecture/architecture.html`
Expected: one match showing the existing 4th card (`<h3><a href="omniroute-routing.html">omniroute-routing.html</a></h3>` and its closing `</div>` for the grid).

- [ ] **Step 2: Add the new card**

Using the Edit tool, find this exact block (it's the last card in the Deep Dives `.grid`, immediately before the grid's closing `</div>`):

```html
    <div class="card">
      <h3><a href="omniroute-routing.html">omniroute-routing.html</a></h3>
      <p>OmniRoute gateway topology, the full combo roster, provider lanes, and the availability reconciler.</p>
    </div>
  </div>
</div>
```

Replace it with:

```html
    <div class="card">
      <h3><a href="omniroute-routing.html">omniroute-routing.html</a></h3>
      <p>OmniRoute gateway topology, the full combo roster, provider lanes, and the availability reconciler.</p>
    </div>
    <div class="card">
      <h3><a href="brand-connectors.html">brand-connectors.html</a></h3>
      <p>What Temperance Engine names as its own (the Athanor, the Caduceus, the Vigil) versus what it only neighbors.</p>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Verify the div balance still holds**

Run:
```bash
python3 -c "
import re
text = open('docs/architecture/architecture.html', encoding='utf-8').read()
o, c = len(re.findall(r'<div', text)), len(re.findall(r'</div>', text))
assert o == c, f'{o} vs {c}'
print('OK')
"
```
Expected: `OK`.

- [ ] **Step 4: Render and click the new link**

Run `pwd` in this worktree to get its absolute root path, then navigate the Browser pane to `file://<worktree-root>/docs/architecture/architecture.html`. Scroll to Deep Dives, confirm the 5th card renders, click it, confirm it loads `brand-connectors.html`.

Expected: card renders correctly, link resolves.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/architecture.html
git commit -m "docs(architecture): link brand-connectors.html from Deep Dives"
```

---

### Task 3: Cross-reference the Caduceus from `omniroute-routing.html`

**Files:**
- Modify: `docs/architecture/omniroute-routing.html` (the opening Scope callout)

**Interfaces:**
- Consumes: `docs/architecture/brand-connectors.html` from Task 1.
- Produces: a one-sentence cross-reference readers hit before the rest of the doc, establishing the Caduceus nickname without renaming any existing section.

- [ ] **Step 1: Read the current scope callout**

Run: `grep -n "Full prose lives in" docs/architecture/omniroute-routing.html`
Expected: one match — the last sentence of the opening `<div class="callout">` block.

- [ ] **Step 2: Add the cross-reference sentence**

Using the Edit tool, find:

```html
  <div class="callout">
    <strong>Scope.</strong> This doc is the OmniRoute reference: the local gateway topology, every governed combo and its strategy, the provider/connection lanes, and the policy-driven reconciler that keeps combos pointed at healthy providers. For the productization narrative see <code>architecture.html</code>; for install mechanics see <code>system-internals.html</code>; for wired-vs-reference seams see <code>integration-map.html</code>. Full prose lives in <code>docs/omniroute-runtime.md</code>, <code>docs/omniroute-fleet.md</code>, <code>docs/omniroute-connections.md</code>, and <code>docs/kimi-surface.md</code>.
  </div>
```

Replace it with:

```html
  <div class="callout">
    <strong>Scope.</strong> This doc is the OmniRoute reference: the local gateway topology, every governed combo and its strategy, the provider/connection lanes, and the policy-driven reconciler that keeps combos pointed at healthy providers. For the productization narrative see <code>architecture.html</code>; for install mechanics see <code>system-internals.html</code>; for wired-vs-reference seams see <code>integration-map.html</code>. Full prose lives in <code>docs/omniroute-runtime.md</code>, <code>docs/omniroute-fleet.md</code>, <code>docs/omniroute-connections.md</code>, and <code>docs/kimi-surface.md</code>. Temperance's own integration layer described here (the proxy, the reconciler, the portfolios &mdash; not the OmniRoute product itself) is nicknamed <b>the Caduceus</b> &mdash; see <a href="brand-connectors.html">brand-connectors.html</a>.
  </div>
```

- [ ] **Step 3: Verify div balance**

Run:
```bash
python3 -c "
import re
text = open('docs/architecture/omniroute-routing.html', encoding='utf-8').read()
o, c = len(re.findall(r'<div', text)), len(re.findall(r'</div>', text))
assert o == c, f'{o} vs {c}'
print('OK')
"
```
Expected: `OK`.

- [ ] **Step 4: Render and verify**

Run `pwd` in this worktree to get its absolute root path, then navigate the Browser pane to `file://<worktree-root>/docs/architecture/omniroute-routing.html`. Confirm the scope callout renders with the new sentence and the link is styled/clickable, click it, confirm it loads `brand-connectors.html`.

Expected: clean render, working link.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/omniroute-routing.html
git commit -m "docs(omniroute): cross-reference the Caduceus nickname"
```

---

### Task 4: Record the decision in ISA.md

**Files:**
- Modify: `ISA.md` (arch-assets table in the Architecture section; Decisions section)

**Interfaces:**
- Consumes: the arch-assets table format already established (rows for `omniroute-routing.html` etc. from this session's earlier work); the Decisions section's existing dated-entry format.
- Produces: nothing later tasks depend on — this is the terminal task.

- [ ] **Step 1: Find the arch-assets table**

Run: `grep -n "omniroute-routing.html" ISA.md`
Expected: one match inside the arch-assets table (a row ending `| manual (LLM skill) |`).

- [ ] **Step 2: Add a new table row**

Using the Edit tool, find the exact row:

```
| [`docs/architecture/omniroute-routing.html`](docs/architecture/omniroute-routing.html) | ✅ current (new 2026-07-27) | manual (LLM skill) |
```

Replace it with (adding a new row immediately after, keeping the original row unchanged):

```
| [`docs/architecture/omniroute-routing.html`](docs/architecture/omniroute-routing.html) | ✅ current (new 2026-07-27) | manual (LLM skill) |
| [`docs/architecture/brand-connectors.html`](docs/architecture/brand-connectors.html) | ✅ current (new 2026-07-28) | manual (LLM skill) |
```

- [ ] **Step 3: Add a Decision entry**

Run: `grep -n "^## Decisions" ISA.md` to find the Decisions section, then find its last bullet line (the most recent dated entry) so the new entry can be appended immediately after it in chronological order.

Using the Edit tool, append this new bullet after the last existing Decisions entry (match the exact text of that last line as your anchor so the insertion point is unambiguous):

```
- 2026-07-28: Named Temperance Engine's owned connectors with alchemical proper nouns consistent with the Algorithm's phase-sigil system: PAI -> the Athanor (display-only rename; `~/.claude/PAI` and `$PAI_HOME` unchanged), Temperance's own OmniRoute integration code -> the Caduceus, the headless EC2 shadow runtime -> the Vigil. Explicitly scoped OUT: renaming Cambium/Hermes/Plexus or any part of the separately-governed Thoughtseed production system (documented in that monorepo's own `INFRA_STATUS.md`, outside this repository), renaming third-party deps (`gsd-core`, OmniRoute the product, `hermes-agent`), and applying these names to live display text (deferred). See `docs/superpowers/specs/2026-07-28-connector-brand-design.md`.
```

- [ ] **Step 4: Verify both edits landed correctly**

Run:
```bash
grep -c "brand-connectors.html" ISA.md
grep -c "the Athanor" ISA.md
```
Expected: both commands print `1` or higher (non-zero).

- [ ] **Step 5: Commit**

```bash
git add ISA.md
git commit -m "docs(isa): record connector-brand decision and arch-asset"
```

---

### Task 5: Final gap-register verification

**Files:**
- None modified — this task only verifies.

**Interfaces:**
- Consumes: all files from Tasks 1–4.
- Produces: a pass/fail report against the design spec's §7 gap register.

- [ ] **Step 1: Verify neighbor terms are all present**

Run:
```bash
for term in "Cambium" "Plexus" "Telegram" "TeamForge" "Vectorize" "NVIDIA NIM"; do
  count=$(grep -c "$term" docs/architecture/brand-connectors.html)
  echo "$term: $count"
done
```
Expected: every term shows a count of `1` or higher (gap-register item 3).

- [ ] **Step 2: Verify no unexpected files changed**

Run: `git status --short`
Expected: working tree clean (everything from Tasks 1–4 was already committed); if anything else from earlier, unrelated session work still shows as modified, confirm by path that none of it is a file this plan was supposed to touch (gap-register item 6 — only the new HTML file, this plan file, the two touched HTML files, and ISA.md should ever have been staged by this plan's tasks).

- [ ] **Step 3: Verify Task 1's file count wasn't silently reduced**

Run: `wc -l docs/architecture/brand-connectors.html`
Expected: comparable line count to the other companion docs (roughly 150-320 lines, matching `omniroute-routing.html`'s ~300 or `session-trace.html`'s ~100 range) — a suspiciously short file would indicate a truncated write.

- [ ] **Step 4: Report**

Summarize: all 5 companion docs cross-link correctly, the neighbor boundary is grep-provable, ISA.md reflects the decision, and confirm no file outside `docs/`+`ISA.md` was touched by this plan (distinguish from any pre-existing unrelated uncommitted changes in the working tree, which are out of this plan's scope to commit or revert).

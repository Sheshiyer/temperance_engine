#!/usr/bin/env bash
set -euo pipefail

ROOT="${TEMPERANCE_ROOT:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
PIPELINE="/Users/sheshnarayaniyer/.craft-agent/workspaces/my-workspace/skills/mvp-roadmap-orchestrator/run_mvp_pipeline.py"
README_PATH="$ROOT/README.md"
ASSET_DIR="$ROOT/.readme-notebooklm/assets"
PROJECT_NAME="${1:-$(basename "$ROOT")}" \
OWNER="${2:-Thoughtseed}"
FORCE_UPDATE="${READMEREBUILD_FORCE:-0}"
SKIP_NOTEBOOKLM="${READMEREBUILD_SKIP_NOTEBOOKLM:-0}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required." >&2
  exit 1
fi

if [[ "$SKIP_NOTEBOOKLM" == "1" ]]; then
  echo "READMEREBUILD_SKIP_NOTEBOOKLM=1 so NotebookLM regeneration is skipped."
elif ! command -v notebooklm >/dev/null 2>&1; then
  echo "NotebookLM CLI not found; reusing existing assets if available." >&2
else
  if ! notebooklm list --json >/tmp/readme-nl-list.json 2>/tmp/readme-nl-list.err; then
    echo "NotebookLM auth unavailable; reusing existing assets if available." >&2
    cat /tmp/readme-nl-list.err >&2 || true
    if [[ "$FORCE_UPDATE" == "1" ]]; then
      exit 1
    fi
  else
    python3 "$PIPELINE" \
      --project-dir "$ROOT" \
      --project-name "$PROJECT_NAME" \
      --owner "$OWNER" \
      --asset report --asset mind-map --asset data-table \
      --output-root "$ROOT/.readme-notebooklm" \
      >/tmp/readme-pipeline.log 2>&1 || {
        echo "NotebookLM pipeline failed; reusing existing assets if available." >&2
        cat /tmp/readme-pipeline.log >&2
        if [[ "$FORCE_UPDATE" == "1" ]]; then
          exit 1
        fi
      }
  fi
fi

if [[ ! -f "$ASSET_DIR/manifest.json" ]]; then
  echo "Manifest not found; skipping README rewrite." >&2
  exit 0
fi

python3 - "$README_PATH" "$ASSET_DIR" "$OWNER" "$PROJECT_NAME" <<'PY'
import csv
import json
import re
from pathlib import Path
from datetime import datetime, timezone
import sys

README_PATH = Path(sys.argv[1])
ASSET_DIR = Path(sys.argv[2])
OWNER = sys.argv[3]
PROJECT_NAME = sys.argv[4]

manifest_path = ASSET_DIR / "manifest.json"
report_path = ASSET_DIR / "notebooklm-report.md"
mind_map_path = ASSET_DIR / "notebooklm-mind-map.json"
table_csv_path = ASSET_DIR / "notebooklm-data-table.csv"
json_table_path = ASSET_DIR / "notebooklm-data-table.json"

# --- Load source-of-truth artifact data ---------------------------------------------------------

manifest = {}
if manifest_path.exists():
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception:
        manifest = {}


def clean_text(path: Path) -> str:
    if not path.exists():
        return ""
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""


def build_snapshot(report_markdown: str) -> str:
    if not report_markdown.strip():
        return "- Intelligence snapshot unavailable (NotebookLM report not found)."

    lines = report_markdown.splitlines()
    start = None
    end = None
    for idx, line in enumerate(lines):
        if line.strip().startswith("## Executive Summary"):
            start = idx + 1
            continue
        if start is not None and line.startswith("## ") and idx > start:
            end = idx
            break

    if start is None:
        body = lines
    else:
        body = lines[start:end]

    cleaned = []
    for line in body:
        s = line.strip()
        if not s or s in ("-", "--", "---", "----"):
            continue
        if s.startswith("##"):
            continue
        cleaned.append(s)
        if len(cleaned) >= 10:
            break

    if not cleaned:
        return "- Intelligence snapshot unavailable (unable to parse report)."

    items = []
    for line in cleaned:
        if line.startswith("-"):
            items.append(line)
        else:
            items.append(f"- {line}")

    items.append("- [Read the full report for deeper context](.readme-notebooklm/assets/notebooklm-report.md)")
    return "\n".join(items)


def render_mind_map() -> str:
    raw = clean_text(mind_map_path)
    if not raw.strip():
        return "graph LR\n  TE[Temperance Engine] --> MM[Mind map unavailable]"

    try:
        payload = json.loads(raw)
    except Exception:
        return "graph LR\n  TE[Temperance Engine] --> MM[Invalid mind map JSON]"

    root_name = "Temperance Engine"
    if isinstance(payload, dict) and isinstance(payload.get("mind_map"), dict):
        root_name = payload["mind_map"].get("name") or root_name

    node_id = 0
    lines = ["graph LR"]

    def next_id() -> str:
        nonlocal node_id
        node_id += 1
        return f"N{node_id:03d}"

    def esc(text: str) -> str:
        return str(text).replace('"', '\\"').replace("\n", " ").strip()[:50]

    if not isinstance(payload, dict) or not isinstance(payload.get("mind_map"), dict):
        return "graph LR\n  TE[Temperance Engine] --> MM[Malformed mind map schema]"

    def walk(node, parent, depth=0):
        children = node.get("children") or []
        if depth >= 3:
            return
        for child in children:
            if not isinstance(child, dict):
                continue
            cid = next_id()
            cname = esc(child.get("name", "Untitled"))
            lines.append(f"  {cid}[{cname}]")
            lines.append(f"  {parent} --> {cid}")
            walk(child, cid, depth + 1)

    root_id = next_id()
    lines.append(f"  {root_id}[{esc(root_name)}]")
    walk(payload["mind_map"], root_id, 0)

    if len(lines) <= 2:
        lines.append("  MM[No mind-map entries]")
        lines.append(f"  {root_id} --> MM")

    return "\n".join(lines)


def render_table() -> str:
    if not table_csv_path.exists():
        return "| Project Name | Description | Integration Type | Upstream URL | Role in Runtime |\n| --- | --- | --- | --- | --- |\n| - | No table data available | - | - | - |"

    with table_csv_path.open(newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    if not rows:
        return "| Project Name | Description | Integration Type | Upstream URL | Role in Runtime |\n| --- | --- | --- | --- | --- |\n| - | Table contained no rows | - | - | - |"

    if len(rows) > 20:
        cols = rows[0].keys()
        json_rows = []
        for row in rows:
            json_rows.append({k: row.get(k, "") for k in cols})

        table_blob = {"columns": [{"key": k, "label": k, "type": "text"} for k in cols], "rows": json_rows}
        json_table_path.write_text(json.dumps(table_blob, indent=2), encoding="utf-8")

        return (
            "```datatable\n"
            f"{{\"title\": \"Repository Signals\", \"src\": \"./.readme-notebooklm/assets/notebooklm-data-table.json\"}}\n"
            "```"
        )

    headers = [h for h in rows[0].keys() if h != "Source"]
    if not headers:
        headers = list(rows[0].keys())

    rows_out = ["| " + " | ".join(headers) + " |", "| " + " | ".join(["---"] * len(headers)) + " |"]
    for r in rows:
        vals = [str(r.get(h, "")).replace("|", "\\|") for h in headers]
        rows_out.append("| " + " | ".join(vals) + " |")

    return "\n".join(rows_out)


snapshot_md = clean_text(report_path)
snapshot = build_snapshot(snapshot_md)
mindmap = render_mind_map()
table_block = render_table()

sources = manifest.get("sources", [])
source_names = ", ".join([f"{s.get('input', '').rsplit('/', 1)[-1]}" for s in sources if s.get("input")]) or "unavailable"

marker_headings = {
    "notebooklm-report": "## 🚀 Project Intelligence Snapshot",
    "notebooklm-mindmap": "## 🧠 Concept Map",
    "notebooklm-table": "## 📊 Repository Signals Table",
    "notebooklm-metadata": "## 🔍 Asset Trail",
}

metadata = [
    "- assets-dir: .readme-notebooklm/assets",
    "- manifest-path: .readme-notebooklm/assets/manifest.json",
    "- source-reference: manifest.json",
    f"- source-count: {len(sources)}",
    f"- source-note: {source_names}",
    f"- generated-at: {datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S%z')}",
    f"- notebook-id: {manifest.get('notebook', {}).get('id', 'unknown')}",
    "- generation-command: python3 /Users/sheshnarayaniyer/.craft-agent/workspaces/my-workspace/skills/mvp-roadmap-orchestrator/run_mvp_pipeline.py --project-dir . --project-name '" + PROJECT_NAME + "' --owner '" + OWNER + "' --asset report --asset mind-map --asset data-table --output-root .readme-notebooklm",
    "- continuity-mode: merge-queue refresh workflow",
    "- follow-up-target: readme-continuity-refresh",
    "- workflow-reference: .github/workflows/readme-auto-refresh.yml",
    f"- notebooklm-owner: {OWNER}",
]

report_block = "## 🚀 Project Intelligence Snapshot\n\n" + snapshot + "\n"
mind_block = (
    "## 🧠 Concept Map\n\n"
    "```mermaid\n"
    f"{mindmap}\n"
    "```\n"
)
if table_block.strip().startswith("```datatable"):
    table_section = "## 📊 Repository Signals Table\n\n" + table_block + "\n"
else:
    table_section = "## 📊 Repository Signals Table\n\n" + table_block + "\n"

metadata_block = "## 🔍 Asset Trail\n\n" + "\n".join(metadata) + "\n"

text = README_PATH.read_text(encoding="utf-8")

def replace_block(text: str, marker: str, replacement: str) -> str:
    start_marker = f"<!-- readme-gen:start:{marker} -->"
    end_marker = f"<!-- readme-gen:end:{marker} -->"

    start_idx = text.find(start_marker)
    if start_idx == -1:
        heading = marker_headings.get(marker)
        if heading:
            pattern = re.compile(rf"^{re.escape(heading)}\n(?:.|\n)*?(?=^## [^\n]*$|\Z)", re.M)
            match = pattern.search(text)
            if match:
                block = match.group(0).rstrip("\n")
                return (
                    text[: match.start()] +
                    f"{start_marker}\n{block}\n{end_marker}\n" +
                    text[match.end():]
                )
        return text

    end_idx = text.find(end_marker, start_idx)
    if end_idx == -1:
        return text

    before = text[: start_idx + len(start_marker)]
    after = text[end_idx:]
    return before + "\n" + replacement + "\n" + after

text = replace_block(text, "notebooklm-report", report_block)
text = replace_block(text, "notebooklm-mindmap", mind_block)
text = replace_block(text, "notebooklm-table", table_section)
text = replace_block(text, "notebooklm-metadata", metadata_block)

README_PATH.write_text(text, encoding="utf-8")
PY

echo "Rebuilt README NotebookLM blocks from assets."

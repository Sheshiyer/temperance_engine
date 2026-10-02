#!/usr/bin/env bash
# scripts/build-migration-kit.sh
# Commit-bound portable release-closure builder (Task 7).
#
# Builds a bounded, checksum-bound tar.gz migration kit from the BLOBS of an
# explicitly approved immutable git commit (never from working-tree bytes), with
# an inner per-member checksum manifest and an external artifact digest.
#
# Design (foundational repairs, not a grep facade):
#   1. Explicit approved immutable source commit is REQUIRED. The committish is
#      resolved to a 40-hex commit id and every staged source byte comes from
#      that commit via `git archive` (blobs), so untracked/dirty bytes can never
#      enter silently. No-git / unresolved commit / incomplete closure REFUSE.
#   2. Pin/lock/manifest consistency: exact Bun 1.3.5, OpenTUI 0.5.11, AJV
#      8.20.0, TypeScript 5.9.3. The committed bun.lock is parsed (JSON) under
#      those exact pins; placeholder/dummy/mismatched locks are rejected.
#   3. Portable closure = verified Bun arm64 binary + built install-surface CLI
#      + runtime production deps / native asset, OR an explicit missing-closure
#      REFUSE. Build happens in isolated mktemp staging from committed source and
#      frozen (never-mutated) vendored deps; the shared cache is read-only.
#   6. Output ownership: safe version grammar, refuse malformed args/env, fresh
#      mktemp staging, no arbitrary --out/stage deletion, pre-existing
#      archive/metadata/sibling/sentinel untouched, exclusive publish, dry-run
#      writes ZERO files.
#   7. Full staged payload is privacy-scanned (text + names) for prohibited
#      private roots / accounts / endpoints / secrets / session ids.
#
# Usage:
#   bash scripts/build-migration-kit.sh --commit <committish> \
#        [--out DIR] [--expected-source-digest git-tree:<40hex>] \
#        [--arch arm64] [--vendor-dir DIR] [--dry-run]
#
# Environment inputs (cache and vendor digest required; arguments win):
#   KIT_OUT, KIT_VERSION, KIT_COMMIT, KIT_ARCH, KIT_VENDOR_DIR,
#   KIT_EXPECTED_SOURCE_DIGEST, KIT_EXPECTED_VENDOR_DIGEST, TOOLCHAIN_CACHE_DIR
#
# To change a pin you must edit this file AND package.json / bun.lock together
# under owner review. Prefix matches are never accepted.

set -euo pipefail

ROOT=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)

# ── Immutable source pins (exact, no prefix matching) ────────────────────────
BUN_REQUIRED="1.3.5"
OPENTUI_REQUIRED="0.5.11"
AJV_REQUIRED="8.20.0"
TS_REQUIRED="5.9.3"
EXPECTED_BUN_SHA256="66262f09134f780b1563bd1ae3dad13ea7d2ac669f8a5754f924b3c82abcc8f3"
EXPECTED_BUN_ZIP_SHA256="db17588a4aea8804856825d4bead3f05e1f37276ca606f37e369b4f72f35d3fb"

# ── Bounds (foundational; a kit is a small bounded closure) ───────────────────
MAX_MEMBER_COUNT=20000
MAX_MEMBER_BYTES=$((200 * 1024 * 1024))     # 200 MiB per member
MAX_TOTAL_BYTES=$((400 * 1024 * 1024))      # 400 MiB staged total

# ── Defaults / env ────────────────────────────────────────────────────────────
DRY_RUN=0
KIT_OUT="${KIT_OUT:-$ROOT/dist/migration-kit}"
KIT_VERSION="${KIT_VERSION:-}"
KIT_COMMIT="${KIT_COMMIT:-}"
KIT_ARCH="${KIT_ARCH:-arm64}"
KIT_VENDOR_DIR="${KIT_VENDOR_DIR:-}"
EXPECTED_SOURCE_DIGEST="${KIT_EXPECTED_SOURCE_DIGEST:-}"
EXPECTED_VENDOR_DIGEST="${KIT_EXPECTED_VENDOR_DIGEST:-}"

TOOLCHAIN_CACHE_DIR="${TOOLCHAIN_CACHE_DIR:-}"

say()  { printf '%s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*" >&2; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
refuse() { printf 'REFUSE: %s\n' "$*" >&2; exit 1; }

# ── Argument parsing (strict) ─────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --expected-vendor-digest) shift; [ $# -gt 0 ] || refuse "--expected-vendor-digest requires a value"; EXPECTED_VENDOR_DIGEST="$1" ;;
    --toolchain-cache) shift; [ $# -gt 0 ] || refuse "--toolchain-cache requires a value"; TOOLCHAIN_CACHE_DIR="$1" ;;
    --out)     shift; [ $# -gt 0 ] || refuse "--out requires a value"; KIT_OUT="$1" ;;
    --out=*)   KIT_OUT="${1#--out=}" ;;
    --commit)  shift; [ $# -gt 0 ] || refuse "--commit requires a value"; KIT_COMMIT="$1" ;;
    --commit=*) KIT_COMMIT="${1#--commit=}" ;;
    --arch)    shift; [ $# -gt 0 ] || refuse "--arch requires a value"; KIT_ARCH="$1" ;;
    --arch=*)  KIT_ARCH="${1#--arch=}" ;;
    --vendor-dir) shift; [ $# -gt 0 ] || refuse "--vendor-dir requires a value"; KIT_VENDOR_DIR="$1" ;;
    --vendor-dir=*) KIT_VENDOR_DIR="${1#--vendor-dir=}" ;;
    --expected-source-digest) shift; [ $# -gt 0 ] || refuse "--expected-source-digest requires a value"; EXPECTED_SOURCE_DIGEST="$1" ;;
    --expected-source-digest=*) EXPECTED_SOURCE_DIGEST="${1#--expected-source-digest=}" ;;
    -h|--help)
      sed -n '8,33p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *) refuse "unknown argument: $1" ;;
  esac
  shift
done

dry() { [ "$DRY_RUN" -eq 1 ]; }

# ── sha256 helper ─────────────────────────────────────────────────────────────
sha256_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    fail "neither shasum nor sha256sum found; cannot compute checksums"
  fi
}

# ── Target architecture (explicit; hold unavailable before effects) ──────────
case "$KIT_ARCH" in
  arm64) ;;
  x64)
    # Source tooling supports exact verified x64 later; it is NOT verified now.
    refuse "ARCH_HOLD: arch x64 is declared supported in source but not independently verified in this cache; only arm64 is verified now"
    ;;
  *) refuse "ARCH_HOLD: unsupported --arch '$KIT_ARCH' (verified: arm64)" ;;
esac

# ── Resolve and validate the approved immutable commit ───────────────────────
if ! git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  refuse "NO_GIT: a git repository is required; kits are built from committed blobs, not working-tree bytes"
fi
[ -n "$KIT_COMMIT" ] || refuse "MISSING_COMMIT: --commit <committish> is required (explicit approved immutable source commit)"

RESOLVED_COMMIT=$(git -C "$ROOT" rev-parse --verify --quiet "${KIT_COMMIT}^{commit}" 2>/dev/null || true)
if [ -z "$RESOLVED_COMMIT" ]; then
  refuse "UNRESOLVED_COMMIT: could not resolve '$KIT_COMMIT' to a commit"
fi
case "$RESOLVED_COMMIT" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
  *) refuse "BAD_COMMIT_ID: resolved commit is not 40 hex chars: $RESOLVED_COMMIT" ;;
esac
GIT_COMMIT="$RESOLVED_COMMIT"
say "ok: approved source commit resolved: $GIT_COMMIT"

# ── Safe version grammar (prevents --out/stage traversal & sibling overwrite) ─
if [ -z "$KIT_VERSION" ]; then
  KIT_VERSION=$(git -C "$ROOT" show "$GIT_COMMIT:VERSION" 2>/dev/null | head -1 | tr -d ' \t\r\n' || true)
fi
[ -n "$KIT_VERSION" ] || refuse "MISSING_VERSION: no VERSION in commit and no KIT_VERSION provided"
case "$KIT_VERSION" in
  *[!A-Za-z0-9._-]*|''|.|..|-*|*/*|*..*)
    refuse "BAD_VERSION: version '$KIT_VERSION' violates safe grammar [A-Za-z0-9._-], no leading '-', '/', or '..'"
    ;;
esac
say "ok: version=$KIT_VERSION"

ARCHIVE_NAME="temperance-engine-${KIT_VERSION}-${KIT_ARCH}.tar.gz"
case "$ARCHIVE_NAME" in
  */*|*..*) refuse "BAD_VERSION: derived archive name unsafe: $ARCHIVE_NAME" ;;
esac

# ── Optional independent expected source digest (tree of the commit) ─────────
SOURCE_TREE_DIGEST=$(git -C "$ROOT" rev-parse "${GIT_COMMIT}^{tree}")
if [ -n "$EXPECTED_SOURCE_DIGEST" ]; then
  _want="${EXPECTED_SOURCE_DIGEST#git-tree:}"
  if [ "$_want" != "$SOURCE_TREE_DIGEST" ] && [ "$EXPECTED_SOURCE_DIGEST" != "$SOURCE_TREE_DIGEST" ]; then
    refuse "SOURCE_DIGEST_MISMATCH: expected $EXPECTED_SOURCE_DIGEST but commit tree is git-tree:$SOURCE_TREE_DIGEST"
  fi
  say "ok: expected source digest matches commit tree"
fi

# ── Pin / lock / manifest consistency against COMMITTED files ────────────────
# All reads are from the commit, never the working tree.
blob() { git -C "$ROOT" show "$GIT_COMMIT:$1" 2>/dev/null; }
has_blob() { git -C "$ROOT" cat-file -e "$GIT_COMMIT:$1" 2>/dev/null; }

PKG_JSON_PATH="package/install-surface/package.json"
LOCK_PATH="package/install-surface/bun.lock"
MANIFEST_LOCK_PATH="package/install-surface/install-surface-manifest.lock.json"

has_blob "$PKG_JSON_PATH" || refuse "MISSING_CLOSURE: $PKG_JSON_PATH not in commit"
has_blob "$LOCK_PATH"     || refuse "MISSING_CLOSURE: $LOCK_PATH not in commit (frozen lock required)"

has_blob "$MANIFEST_LOCK_PATH" || refuse "MISSING_CLOSURE: committed install-surface manifest lock required"

# ── Toolchain cache Bun binary (verified arm64; DIRECTORY plus /bun) ──────────
BUN_CACHE_BINARY=""
BUN_CACHE_VERIFIED=0
if [ -n "$TOOLCHAIN_CACHE_DIR" ] && [ -d "$TOOLCHAIN_CACHE_DIR" ]; then
  _cache_bin="$TOOLCHAIN_CACHE_DIR/bun-${BUN_REQUIRED}-${KIT_ARCH}/bun"
  if [ -f "$_cache_bin" ] && [ ! -L "$_cache_bin" ]; then
    _observed_sha=$(sha256_file "$_cache_bin")
    if [ "$_observed_sha" = "$EXPECTED_BUN_SHA256" ]; then
      BUN_CACHE_BINARY="$_cache_bin"
      BUN_CACHE_VERIFIED=1
      say "ok: toolchain-cache bun-${BUN_REQUIRED}-${KIT_ARCH}/bun sha256 verified"
    else
      refuse "BUN_BINARY_MISMATCH: cache bun sha256 $_observed_sha != expected $EXPECTED_BUN_SHA256"
    fi
  else
    refuse "MISSING_CLOSURE: verified bun binary not found at $_cache_bin"
  fi
else
  refuse "MISSING_CLOSURE: supply explicit TOOLCHAIN_CACHE_DIR / --toolchain-cache; no host cache search is performed"
fi

# ── Frozen vendored deps (copied, never symlinked; never mutate shared cache) ─
if [ -z "$KIT_VENDOR_DIR" ]; then
  refuse "MISSING_CLOSURE: --vendor-dir (frozen node_modules copy) is required for runtime closure"
fi
[ -d "$KIT_VENDOR_DIR" ] || refuse "MISSING_CLOSURE: vendor dir not found: $KIT_VENDOR_DIR"
[ ! -L "$KIT_VENDOR_DIR" ] || refuse "UNSAFE_VENDOR: vendor dir is a symlink: $KIT_VENDOR_DIR"
[ "$("$BUN_CACHE_BINARY" --version)" = "$BUN_REQUIRED" ] || refuse 'PIN_MISMATCH: cached Bun version'
[ -f "$TOOLCHAIN_CACHE_DIR/bun-darwin-aarch64.zip" ] && [ ! -L "$TOOLCHAIN_CACHE_DIR/bun-darwin-aarch64.zip" ] || refuse 'MISSING_CLOSURE: official Bun ZIP required'
[ "$(sha256_file "$TOOLCHAIN_CACHE_DIR/bun-darwin-aarch64.zip")" = "$EXPECTED_BUN_ZIP_SHA256" ] || refuse 'BUN_ZIP_MISMATCH'
[[ "$EXPECTED_VENDOR_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || refuse 'MISSING_VENDOR_DIGEST: supply independently reviewed --expected-vendor-digest sha256:HEX'

# Structural reconciliation runs with the checksum-verified runtime, never PATH
# Bun. SRI describes registry tarballs; the independently supplied tree digest
# is what authenticates these already-unpacked vendor bytes.
verify_closure() {
CLOSURE_RESULT=$("$BUN_CACHE_BINARY" - "$ROOT" "$GIT_COMMIT" "$1" "$EXPECTED_VENDOR_DIGEST" <<'JS'
try {
const [root, commit, vendorInput, expectedTree] = process.argv.slice(2);
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const {execFileSync} = require("node:child_process");
const fail = s => { console.error("REFUSE: " + s); process.exit(1); };
const hash = b => crypto.createHash("sha256").update(b).digest("hex");
const blob = p => { try { return execFileSync("git", ["-C",root,"show",commit+":"+p],{maxBuffer:16*1024*1024,stdio:["ignore","pipe","pipe"]}); } catch { fail("MISSING_CLOSURE: "+p); } };
const parse = (b,label) => { try { return JSON.parse(b.toString()); } catch { fail("DUMMY_LOCK: invalid JSON "+label); } };
// Strip JSONC comments/trailing commas only outside quoted strings. No eval.
function jsonc(s) {
  let out="";
  for(let i=0;i<s.length;) {
    if(s[i]==='"') { let j=i+1; for(;j<s.length;j++){if(s[j]==="\\"){j++;continue;} if(s[j]==='"'){j++;break;}} out+=s.slice(i,j); i=j; }
    else if(s.slice(i,i+2)==="//"){while(i<s.length && s[i]!=="\n")i++;}
    else if(s.slice(i,i+2)==="/*"){const j=s.indexOf("*/",i+2); if(j<0)fail("DUMMY_LOCK: unterminated comment");out+=" ";i=j+2;}
    else {out+=s[i++];}
  }
  let clean="";
  for(let i=0;i<out.length;i++) {
    if(out[i]==='"'){let j=i+1;for(;j<out.length;j++){if(out[j]==="\\"){j++;continue;}if(out[j]==='"'){j++;break;}}clean+=out.slice(i,j);i=j-1;}
    else if(out[i]==="," && /^\s*[}\]]/.test(out.slice(i+1)))continue;
    else clean+=out[i];
  }
  return parse(clean,"bun.lock");
}
const pkg=parse(blob("package/install-surface/package.json"),"package.json");
const lockBytes=blob("package/install-surface/bun.lock"), lock=jsonc(lockBytes.toString());
if(pkg.packageManager!=="bun@1.3.5" || pkg.dependencies?.["@opentui/core"]!=="0.5.11" || pkg.dependencies?.ajv!=="8.20.0" || pkg.devDependencies?.typescript!=="5.9.3") fail("PIN_MISMATCH");
const canon=v=>JSON.stringify(v && typeof v==="object" ? Array.isArray(v)?v.map(x=>JSON.parse(canon(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canon(v[k]))])):v);
if(lock.lockfileVersion!==1 || lock.configVersion!==1 || !lock.packages || canon(lock.workspaces?.[""]?.dependencies)!==canon(pkg.dependencies) || canon(lock.workspaces?.[""]?.devDependencies)!==canon(pkg.devDependencies))fail("LOCK_MISMATCH: workspace");
for(const [name,entry] of Object.entries(lock.packages)) {
  if(!Array.isArray(entry)||entry.length!==4||typeof entry[0]!=="string"||!entry[0].startsWith(name+"@")||!/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry[3])||Buffer.from(entry[3].slice(7),"base64").length!==64)fail("LOCK_MISMATCH: package integrity");
}
// Reviewed source lock pin binds ALL registry integrity strings, including
// transitive/native entries. Changing it requires a separately reviewed pin.
if(hash(lockBytes)!=="65083b07d3b402c932dee70b01ac4495a462de73a0a525484da9591a57371387")fail("LOCK_MISMATCH: exact reviewed registry lock digest");
const native=lock.packages["@opentui/core-darwin-arm64"];
if(native?.[0]!=="@opentui/core-darwin-arm64@0.5.11" || native[2].os!=="darwin" || native[2].cpu!=="arm64")fail("LOCK_MISMATCH: native architecture");
const vendor=fs.realpathSync(vendorInput), rows=[]; let count=0,total=0;
const safe=p=>p.split("/").every(x=>/^[A-Za-z0-9@+_.-]+$/.test(x)&&x!=="."&&x!=="..");
function walk(rel="") {
  for(const n of fs.readdirSync(path.join(vendor,rel)).sort()) {
    const p=rel?rel+"/"+n:n; if(!safe(p))fail("UNSAFE_VENDOR: member name");
    const fp=path.join(vendor,p), st=fs.lstatSync(fp);
    if(++count>20000)fail("BOUNDS: vendor count");
    if(st.isSymbolicLink()) {
      const target=fs.readlinkSync(fp); let resolved; try{resolved=fs.realpathSync(fp);}catch{fail("UNSAFE_VENDOR: dangling link");}
      if(!/^\.bin\/[A-Za-z0-9._-]+$/.test(p)||path.isAbsolute(target)||!resolved.startsWith(vendor+path.sep)||!fs.statSync(resolved).isFile())fail("UNSAFE_VENDOR: only contained .bin links allowed");
      rows.push("link  "+target+"  "+p+"\n");
    } else if(st.isDirectory())walk(p);
    else if(st.isFile()) {total+=st.size;if(st.size>200*1024*1024||total>400*1024*1024)fail("BOUNDS: vendor bytes");rows.push(hash(fs.readFileSync(fp))+"  "+((st.mode&0o111)?"0755":"0644")+"  "+p+"\n");}
    else fail("UNSAFE_VENDOR: special file");
  }
}
walk(); rows.sort(); const tree="sha256:"+hash(rows.join(""));
if(tree!==expectedTree)fail("VENDOR_DIGEST_MISMATCH: observed "+tree);
// Authenticate before interpreting vendor package metadata or importing AJV.
const installed=[];
for(const n of fs.readdirSync(vendor).filter(n=>n!==".bin")) {
  if(n.startsWith("@"))for(const child of fs.readdirSync(path.join(vendor,n)))installed.push(n+"/"+child);
  else installed.push(n);
}
const needed=new Set(), queue=Object.keys({...pkg.dependencies,...pkg.devDependencies});
while(queue.length){const n=queue.pop();if(needed.has(n))continue; const e=lock.packages[n];if(!e)fail("MISSING_CLOSURE: dependency "+n); const meta=e[2];
  if(meta.os && meta.os!=="darwin" || meta.cpu && meta.cpu!=="arm64")continue;
  needed.add(n);queue.push(...Object.keys(meta.dependencies||{}),...Object.keys(meta.optionalDependencies||{}),...Object.keys(meta.peerDependencies||{}).filter(p=>!(meta.optionalPeers||[]).includes(p)));
}
if(installed.length!==needed.size || installed.some(n=>!needed.has(n)))fail("MISSING_CLOSURE: exact dependency set");
for(const n of needed){const p=parse(fs.readFileSync(path.join(vendor,n,"package.json")),n);if(lock.packages[n][0]!==n+"@"+p.version || p.name!==n)fail("LOCK_MISMATCH: installed "+n);}
const asset=path.join(vendor,"@opentui/core-darwin-arm64/libopentui.dylib");
if(!fs.existsSync(asset)||!fs.lstatSync(asset).isFile()||fs.statSync(asset).size<4096)fail("MISSING_CLOSURE: native dylib");
const binary=fs.readFileSync(asset);
if(binary.readUInt32LE(0)!==0xfeedfacf||binary.readUInt32LE(4)!==0x0100000c||binary.readUInt32LE(12)!==6)fail("NATIVE_ARCH_MISMATCH: arm64 Mach-O dylib required");
const manifest=parse(blob("package/install-surface/install-surface-manifest.lock.json"),"manifest lock");
const Ajv=require(path.join(vendor,"ajv/dist/2020.js")).default;
const ajv=new Ajv({allErrors:true,strict:false});
if(!ajv.validate(parse(blob("package/install-surface/schemas/lock.v1.schema.json"),"lock schema"),manifest))fail("MANIFEST_LOCK_MISMATCH: schema");
const fragments=execFileSync("git",["-C",root,"ls-tree","-r","--name-only",commit,"--","package/install-surface/fragments"],{encoding:"utf8"}).trim().split("\n").filter(p=>p.endsWith(".json"));
const records=fragments.flatMap(p=>parse(blob(p),p).records).map(r=>({...r,authority:{...r.authority,requirement_ids:[...r.authority.requirement_ids].sort()},eligibility:{...r.eligibility,platforms:[...r.eligibility.platforms].sort(),profiles:[...r.eligibility.profiles].sort()},...(r.depends_on?{depends_on:[...r.depends_on].sort()}:{} )})).sort((a,b)=>a.id.localeCompare(b.id,"en"));
// Sort with byte order, matching the production compiler.
records.sort((a,b)=>Buffer.compare(Buffer.from(a.id),Buffer.from(b.id)));
if(!records.length || new Set(records.map(r=>r.id)).size!==records.length || canon(records)!==canon(manifest.records))fail("MANIFEST_LOCK_MISMATCH: fragments");
for(const r of manifest.records.filter(r=>r.class==="COPY")) {
 const e=r.verification.expected;
 const paths=e.kind==="tree"?Object.keys(e.files).map(p=>[r.source+"/"+p,e.files[p],e.modes[p]]):[[r.source,e.sha256,e.mode]];
 for(const [p,digest,mode] of paths){if(p==="package/enrich/stages/atlasRecall.ts")fail("PRIVATE_SOURCE_HOLD: enrichment overlay requires separate classification");if(!safe(p))fail("MANIFEST_LOCK_MISMATCH: source path");if("sha256:"+hash(blob(p))!==digest)fail("MANIFEST_LOCK_MISMATCH: source digest "+r.id);const row=execFileSync("git",["-C",root,"ls-tree",commit,"--",p],{encoding:"utf8"});if(!row.startsWith(mode==="0755"?"100755 ":"100644 "))fail("MANIFEST_LOCK_MISMATCH: source mode");}
 if(e.kind==="tree"){const names=execFileSync("git",["-C",root,"ls-tree","-r","--name-only",commit,"--",r.source],{encoding:"utf8"}).trim().split("\n");if(names.length!==paths.length)fail("MANIFEST_LOCK_MISMATCH: source inventory");}
}
console.log("ok: structural locks, manifest/source expectations, "+needed.size+" frozen dependencies and arm64 Mach-O verified");
console.log("ok: reviewed vendor tree "+tree+"; local native observation sha256:"+hash(binary));
console.log("CLOSURE_VERIFIED");
} catch(error) { console.error("REFUSE: closure validation: "+error.message); process.exit(1); }
JS
) || refuse "CLOSURE_VALIDATION_FAILED"
printf '%s\n' "$CLOSURE_RESULT" | grep -qx CLOSURE_VERIFIED || refuse "CLOSURE_VALIDATION_INCOMPLETE"
printf '%s\n' "$CLOSURE_RESULT"
}
verify_closure "$KIT_VENDOR_DIR"

# ── Source closure: full tracked public distribution minus private exclusions ─
# Exclusions: private ledgers, WIP/planning scratch, backups, native sessions,
# vendored node_modules (vendored separately), dist outputs.
EXCLUDE_RE='^(package/enrich/stages/atlasRecall\.ts$|\.agents/|\.planning/|\.temperance/|\.superset/|\.omniroute-backups/|backups/|dist/|coverage/|\.codegraph/|\.worktrees/|package/install-surface/node_modules/|.*/node_modules/)'
# Required anchors that must survive the filter (fail closed if installer refs vanish).
REQUIRED_SOURCES=(
  "install.sh" "uninstall.sh" "verify.sh"
  "scripts/verify-install.sh" "scripts/build-migration-kit.sh" "scripts/verify-migration-kit.sh"
  "scripts/lib.sh"
  "scripts/install-pai.sh" "scripts/install-skill-clusters.sh" "scripts/install-peon-ping.sh"
  "scripts/install-codegraph.sh" "scripts/install-gsd.sh" "scripts/install-spine.sh"
  "scripts/configure-opencode.sh" "scripts/wire-multi-backend.sh"
  "scripts/temperance-proxy-launchd.sh" "scripts/configure-opencode-relay.sh"
  "package/install-surface/package.json" "package/install-surface/bun.lock"
  "package/install-surface/install-surface-manifest.lock.json" "package/install-surface/src/cli.ts"
  "docs/modular-mac-lifecycle.md"
)

# Build the commit's full tracked file list, apply exclusions.
ALL_TRACKED=()
while IFS= read -r tracked; do ALL_TRACKED+=("$tracked"); done < <(git -C "$ROOT" ls-tree -r --name-only "$GIT_COMMIT")
SOURCE_LIST=()
for f in "${ALL_TRACKED[@]}"; do
  # These public authority documents are runtime inputs to compile/verify.
  # Admit exactly this list; planning scratch and receipts remain excluded.
  case "$f" in
    .planning/PROJECT.md|.planning/ROADMAP.md|.planning/STATE.md|.planning/REQUIREMENTS.md|.planning/config.json)
      SOURCE_LIST+=("$f"); continue ;;
  esac
  if printf '%s\n' "$f" | grep -Eq "$EXCLUDE_RE"; then
    continue
  fi
  SOURCE_LIST+=("$f")
done

# Never silently omit installer-referenced scripts.
installer_blob=$(blob "install.sh")
for ref in $(printf '%s\n' "$installer_blob" | grep -oE 'scripts/[A-Za-z0-9._/-]+\.sh' | sort -u); do
  present=0
  for s in "${SOURCE_LIST[@]}"; do [ "$s" = "$ref" ] && present=1 && break; done
  if [ "$present" -eq 0 ]; then
    refuse "CLOSURE_OMISSION: installer references $ref but it is excluded from the source closure"
  fi
done
# The legacy post-install verifier names required files beyond shell scripts.
# Any explicit checked path filtered from the kit is a closure error.
verifier_blob=$(blob "scripts/verify-install.sh")
while IFS= read -r checked; do
  [ -n "$checked" ] || continue
  present=0
  for s in "${SOURCE_LIST[@]}"; do [ "$s" = "$checked" ] && present=1 && break; done
  [ "$present" -eq 1 ] || refuse "CLOSURE_OMISSION: verifier requires $checked"
done < <(printf '%s\n' "$verifier_blob" | sed -n 's/^check_file "\$ROOT\/\([A-Za-z0-9._/-]*\)"$/\1/p')

# Required anchors must be present.
for req in "${REQUIRED_SOURCES[@]}"; do
  has_blob "$req" || refuse "MISSING_CLOSURE: required source not in commit: $req"
  present=0
  for s in "${SOURCE_LIST[@]}"; do [ "$s" = "$req" ] && present=1 && break; done
  [ "$present" -eq 1 ] || refuse "CLOSURE_OMISSION: required source filtered out: $req"
done
say "ok: source closure = ${#SOURCE_LIST[@]} committed files (installer transitive scripts included)"

# ── Dry-run: ZERO files, no writes, print the plan then exit ─────────────────
if dry; then
  say ""
  say "DRY_RUN: commit=$GIT_COMMIT tree=git-tree:$SOURCE_TREE_DIGEST"
  say "DRY_RUN: archive=$ARCHIVE_NAME out=$KIT_OUT"
  say "DRY_RUN: source closure members=${#SOURCE_LIST[@]}"
  say "DRY_RUN: include verified bun-${BUN_REQUIRED}-${KIT_ARCH} (sha256 $EXPECTED_BUN_SHA256)"
  say "DRY_RUN: include frozen vendor runtime closure from $KIT_VENDOR_DIR"
  say "DRY_RUN: write INNER-MANIFEST.sha256, archive, ARTIFACT-DIGEST.sha256, kit-meta.json"
  say "DRY_RUN: no files written."
  exit 0
fi

# ── Output ownership policy (no arbitrary deletion; leaf must not be a symlink) ──
# We never follow a symlinked --out itself, and never delete --out contents. We
# only refuse to clobber our own output names. Pre-existing OS-level symlinks on
# the canonical temp path (e.g. /var -> /private/var) are not our concern; we
# only guard the leaf directory we will write into.
if [ -L "$KIT_OUT" ]; then
  refuse "UNSAFE_OUTPUT: --out is a symlink: $KIT_OUT"
fi
if [ -e "$KIT_OUT" ]; then
  [ -d "$KIT_OUT" ] || refuse "UNSAFE_OUTPUT: --out exists and is not a directory: $KIT_OUT"
  # Existing dir allowed, but we NEVER delete its contents. We only refuse to
  # clobber our own output names if they already exist.
  for existing in "$ARCHIVE_NAME" "ARTIFACT-DIGEST.sha256" "kit-meta.json"; do
    if [ -e "$KIT_OUT/$existing" ] || [ -L "$KIT_OUT/$existing" ]; then
      refuse "OUTPUT_OCCUPIED: $KIT_OUT/$existing already exists; refusing to overwrite (use a fresh --out)"
    fi
  done
fi

# Fresh private mktemp staging (never inside --out, so --out/stage is never rm'd)
STAGE=$(mktemp -d "${TMPDIR:-/tmp}/te-kit-build.XXXXXX")
PUBLISH_TMP=$(mktemp -d "${TMPDIR:-/tmp}/te-kit-pub.XXXXXX")
cleanup() { rm -rf "$STAGE" "$PUBLISH_TMP"; }
trap cleanup EXIT INT TERM

PAYLOAD="$STAGE/payload"
mkdir -p "$PAYLOAD"

# ── Stage committed source via git archive (BLOBS, never working tree) ───────
say "staging committed source from $GIT_COMMIT via git archive..."
git -C "$ROOT" archive --format=tar "$GIT_COMMIT" -- "${SOURCE_LIST[@]}" \
  | tar -xf - -C "$PAYLOAD"

# ── Stage verified bun runtime ───────────────────────────────────────────────
mkdir -p "$PAYLOAD/toolchain"
cp "$BUN_CACHE_BINARY" "$PAYLOAD/toolchain/bun-${BUN_REQUIRED}-${KIT_ARCH}"
chmod 0755 "$PAYLOAD/toolchain/bun-${BUN_REQUIRED}-${KIT_ARCH}"
printf 'sha256:%s  bun-%s-%s\n' "$EXPECTED_BUN_SHA256" "$BUN_REQUIRED" "$KIT_ARCH" \
  > "$PAYLOAD/toolchain/BUN-DIGEST.sha256"

# ── Stage frozen vendor runtime closure (copied, never symlinked) ────────────
mkdir -p "$PAYLOAD/package/install-surface"
# Contained .bin symlinks were authenticated above. They are build-tool aliases,
# unnecessary to the direct Bun build/runtime, and omitted from the archive.
cp -R "$KIT_VENDOR_DIR" "$PAYLOAD/package/install-surface/node_modules"
verify_closure "$PAYLOAD/package/install-surface/node_modules"
find "$PAYLOAD/package/install-surface/node_modules/.bin" -type l -delete 2>/dev/null || true
if find "$PAYLOAD" -type l | grep -q .; then refuse 'UNSAFE_ENTRY: remaining staged symlink'; fi

# ── Build install-surface CLI from committed source in isolated staging ──────
# We build with the verified bun binary against the frozen vendor tree; we never
# execute working-tree source and never mutate the shared dependency cache.
# Preserve dynamic import boundaries; identifier minification avoids duplicate
# exported binding names in Bun 1.3.5 split chunks. All chunks enter the manifest.
BUILT_CLI=0
if [ -x "$PAYLOAD/toolchain/bun-${BUN_REQUIRED}-${KIT_ARCH}" ]; then
  _bunbin="$PAYLOAD/toolchain/bun-${BUN_REQUIRED}-${KIT_ARCH}"
  if "$_bunbin" --version 2>/dev/null | grep -qx "$BUN_REQUIRED"; then
    if ( cd "$PAYLOAD/package/install-surface" \
         && "$_bunbin" build ./src/cli.ts --target bun --packages=external --splitting --minify-identifiers --outdir ./dist >/dev/null 2>&1 ); then
      BUILT_CLI=1
      say "ok: built install-surface CLI (dist/cli.js) with verified bun"
    fi
  fi
fi
if [ "$BUILT_CLI" -ne 1 ]; then
  refuse "MISSING_CLOSURE: install-surface CLI build did not produce dist/cli.js; refusing to claim portable closure"
fi

# ── Bounds enforcement on the staged payload ─────────────────────────────────
MEMBER_COUNT=$(find "$PAYLOAD" -type f | wc -l | tr -d ' ')
[ "$MEMBER_COUNT" -le "$MAX_MEMBER_COUNT" ] || refuse "BOUNDS: member count $MEMBER_COUNT exceeds $MAX_MEMBER_COUNT"
TOTAL_BYTES=$(find "$PAYLOAD" -type f -print0 | xargs -0 stat -f '%z' 2>/dev/null | awk '{s+=$1} END{print s+0}')
[ "$TOTAL_BYTES" -le "$MAX_TOTAL_BYTES" ] || refuse "BOUNDS: total bytes $TOTAL_BYTES exceeds $MAX_TOTAL_BYTES"
while IFS= read -r f; do
  sz=$(stat -f '%z' "$f" 2>/dev/null || echo 0)
  [ "$sz" -le "$MAX_MEMBER_BYTES" ] || refuse "BOUNDS: member $f size $sz exceeds $MAX_MEMBER_BYTES"
done < <(find "$PAYLOAD" -type f)
say "ok: bounds satisfied (members=$MEMBER_COUNT total_bytes=$TOTAL_BYTES)"

# ── Privacy scan: every payload file, including frozen dependencies ────────
# Generic private roots/session/account checks cover all text. Documented
# upstream examples are normalized only for an exact path AND observed file
# SHA-256 AND exact fragment. Neighboring content still receives every check.
/usr/bin/perl - "$PAYLOAD" <<'PRIVACY'
use strict; use warnings; use File::Find; use Digest::SHA;
my $root=shift; my $users='U'.'sers'; my $volumes='Vol'.'umes';
my $pem='-----'.'BEGIN '.'[A-Z ]*'.'PRIVATE'.' KEY'.'-----';
# Observed upstream examples in the reviewed frozen @types/node 22.20.3 and
# bun-types 1.3.5 packages. These hashes narrow normalization, not release trust;
# the independent tree digest and exact registry lock remain mandatory.
my $vendor_prefix='package/install-surface/node_modules/';
my %examples=(
 '@types/node/process.d.ts'=>['bceb58df66ab8fb00170df20cd813978c5ab84be1d285710c4eb005d8e9d8efb',
   "/$users/mjr/work/node/process-args.js", "/$volumes/code/external/node/out/Release/node", "/$users/maciej"],
 'bun-types/docs/guides/ecosystem/gel.mdx'=>['f56f93b8216af956b8d975b2d3e936d4a81259896e93516e046086f243ea9093',
   "/$users/colinmcd94/Documents/bun/fun/examples/my-gel-app"],
 'bun-types/docs/runtime/file-system-router.mdx'=>['a07b73857c53d24ad17b819dd7233c0692063c341b0189ec89306478638fdf56',
   "/$users/colinmcd94/Documents/bun/fun/pages/settings.tsx", "/$users/colinmcd94/Documents/bun/fun/pages/blog/[slug].tsx"],
 'bun-types/globals.d.ts'=>['6e215dac8b234548d91b718f9c07d5b09473cd5cabb29053fcd8be0af190acb6',
   "/$users/me/projects/my-app/src/my-app.ts", 'AK'.'IAIOSFODNN7EXAMPLE'],
 'bun-types/sql.d.ts'=>['9e98bd421e71f70c75dae7029e316745c89fa7b8bc8b43a91adf9b82c206099c',
   "/$users/bun/projects/my-app/database.db"],
 'bun-types/bun.d.ts'=>['a1fdda024d346cd1906d4a1f66c2804217ef88b554946ac7d9b7bcbadcc75f11',
   'sk-'.'proj-'.('x'x20)],
);
my $secret=qr/(?:AKIA[0-9A-Z]{16}|$pem|xox[baprs]-[0-9A-Za-z-]{16,}|sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|(?:access_token|refresh_token|api_key)["']?\s*[:=]\s*["'][A-Za-z0-9_.-]{24,}|Bearer\s+[A-Za-z0-9_.-]{32,})/;
my $bad=0;
find({no_chdir=>1,wanted=>sub {
 my $p=$File::Find::name; return unless -f $p;
 my $rel=substr($p,length($root)+1); my $base=$rel; $base=~s{.*/}{};
 if($base=~/\A(?:\.env(?:\..*)?|auth\.json|credentials(?:\.json)?|sessions?\.(?:jsonl?|db)|id_(?:rsa|ed25519).*|.*\.(?:pem|key|session))\z/ && $base ne '.env.example') {warn "PRIVACY: private filename $rel\n";$bad=1;return;}
 open my $in,'<',$p or die "PRIVACY: unreadable member\n"; binmode $in;
 my @normalized_examples;
 if(index($rel,$vendor_prefix)==0){
   my $entry=$examples{substr($rel,length($vendor_prefix))};
   if($entry){
     my $observed=Digest::SHA->new(256)->addfile($in)->hexdigest;
     seek($in,0,0) or die "PRIVACY: cannot rewind member\n";
     @normalized_examples=@{$entry}[1..$#$entry] if $observed eq $entry->[0];
   }
 }
 while(my $line=<$in>){
   for my $fragment (@normalized_examples){$line=~s/\Q$fragment\E/<DOCUMENTED_EXAMPLE>/g;}
   # Known credentials are checked even on binary lines; generic host paths
   # and account/session fields are meaningful only in text lines.
   if($line=~$secret){warn "PRIVACY: credential pattern in $rel\n";$bad=1;last;}
   next if $line=~/\0/;
   # Exact existing synthetic negative case; adjacent real paths still scan.
   if($rel eq 'package/install-surface/test/lifecycle.test.ts' && $line=~/PRIVATE_PATH_GUARD_FIXTURE: synthetic redaction rejection/){$line=~s{/$users/testuser/\.config/test/file\.txt}{<SYNTHETIC>};}
   if($rel eq 'docs/superpowers/plans/2026-08-05-vault-session-map.md' && $line!~m{/$volumes/fixture/[^\s"']*/\.\.(?:/|["'])}){$line=~s{/$volumes/fixture/[A-Za-z0-9._/-]+}{<SYNTHETIC>}g;}
   if($rel eq 'package/manifest-zone/src/ProjectActionRail.tsx'){$line=~s{placeholder="/$volumes/[.][.][.]/project"}{placeholder="<DISPLAY_PATH>"}g;}
   if($line=~m{/(?:$users|$volumes)/[A-Za-z0-9_.-]+(?:/|\b)} || $line=~/(?:session_id|account_id)["']?\s*[:=]\s*["'][A-Za-z0-9_-]{20,}/ || $line=~m{https?://[^/\s]+/(?:accounts|tenants)/[a-f0-9]{24,}}){warn "PRIVACY: private root/account/session in $rel\n";$bad=1;last;}
 }
 close $in;
}},$root);
exit($bad?1:0);
PRIVACY
say 'ok: payload privacy scan clean'

# Bind source/locks/vendor/native observations INSIDE the outer archive.
LOCK_SHA256=$(sha256_file "$PAYLOAD/package/install-surface/bun.lock")
MANIFEST_LOCK_SHA256=$(sha256_file "$PAYLOAD/package/install-surface/install-surface-manifest.lock.json")
NATIVE_SHA256=$(sha256_file "$PAYLOAD/package/install-surface/node_modules/@opentui/core-darwin-arm64/libopentui.dylib")
cat > "$PAYLOAD/KIT-PROVENANCE.json" <<PROVENANCE
{"schema":"temperance.kit-provenance.v1","source_commit":"$GIT_COMMIT","source_tree":"git-tree:$SOURCE_TREE_DIGEST","registry_lock_sha256":"$LOCK_SHA256","install_manifest_lock_sha256":"$MANIFEST_LOCK_SHA256","reviewed_vendor_digest":"$EXPECTED_VENDOR_DIGEST","bun":"1.3.5","opentui":"0.5.11","ajv":"8.20.0","typescript":"5.9.3","native":{"path":"package/install-surface/node_modules/@opentui/core-darwin-arm64/libopentui.dylib","format":"Mach-O","arch":"arm64","sha256":"$NATIVE_SHA256","authority":"observation-bound-to-reviewed-vendor-tree"},"pending":["Tasks1-6 integrated source/runtime","Task8 physical acceptance"]}
PROVENANCE

# ── Inner checksum manifest (every regular member exactly once, sorted) ───────
INNER_MANIFEST="$PAYLOAD/INNER-MANIFEST.sha256"
: > "$INNER_MANIFEST"
(
  cd "$PAYLOAD"
  find . -type f ! -name 'INNER-MANIFEST.sha256' | LC_ALL=C sort | while IFS= read -r member; do
    rel="${member#./}"
    if [ -L "$member" ]; then
      printf 'ERROR: symlink in staged payload: %s\n' "$rel" >&2
      exit 1
    fi
    h=$(sha256_file "$member")
    printf '%s  %s\n' "$h" "$rel"
  done
) >> "$INNER_MANIFEST"
MANIFEST_MEMBERS=$(wc -l < "$INNER_MANIFEST" | tr -d ' ')
say "ok: inner manifest written ($MANIFEST_MEMBERS members)"

# ── Build tar archive in publish-tmp (exclusive publish later) ──────────────────
ARCHIVE_TMP="$PUBLISH_TMP/$ARCHIVE_NAME"
( cd "$PAYLOAD" && COPYFILE_DISABLE=1 tar --format=ustar -czf "$ARCHIVE_TMP" . )
ARTIFACT_SHA256=$(sha256_file "$ARCHIVE_TMP")
printf 'sha256:%s  %s\n' "$ARTIFACT_SHA256" "$ARCHIVE_NAME" > "$PUBLISH_TMP/ARTIFACT-DIGEST.sha256"

BUILD_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
LOCK_SHA256=$(sha256_file "$PAYLOAD/package/install-surface/bun.lock")
MANIFEST_LOCK_SHA256=$(sha256_file "$PAYLOAD/package/install-surface/install-surface-manifest.lock.json")
NATIVE_SHA256=$(sha256_file "$PAYLOAD/package/install-surface/node_modules/@opentui/core-darwin-arm64/libopentui.dylib")
cat > "$PUBLISH_TMP/kit-meta.json" <<METAEOF
{
  "schema": "migration-kit-meta.v1",
  "version": "${KIT_VERSION}",
  "arch": "${KIT_ARCH}",
  "build_timestamp": "${BUILD_TS}",
  "source_commit": "${GIT_COMMIT}",
  "source_tree_digest": "git-tree:${SOURCE_TREE_DIGEST}",
  "archive": "${ARCHIVE_NAME}",
  "archive_sha256": "${ARTIFACT_SHA256}",
  "inner_manifest_members": ${MANIFEST_MEMBERS},
  "lock_sha256": "${LOCK_SHA256}",
  "manifest_lock_sha256": "${MANIFEST_LOCK_SHA256}",
  "reviewed_vendor_tree_digest": "${EXPECTED_VENDOR_DIGEST}",
  "native_artifact": {"path": "package/install-surface/node_modules/@opentui/core-darwin-arm64/libopentui.dylib", "format": "Mach-O", "arch": "arm64", "sha256": "${NATIVE_SHA256}", "authority": "observation-bound-to-reviewed-vendor-tree"},
  "pins": {
    "bun": "${BUN_REQUIRED}",
    "bun_binary_sha256": "${EXPECTED_BUN_SHA256}",
    "bun_zip_sha256": "${EXPECTED_BUN_ZIP_SHA256}",
    "opentui": "${OPENTUI_REQUIRED}",
    "ajv": "${AJV_REQUIRED}",
    "typescript": "${TS_REQUIRED}"
  },
  "closure": {
    "source_from_commit_blobs": true,
    "bun_runtime_included": true,
    "frozen_vendor_included": true,
    "cli_built": true
  },
  "pending_gates": [
    "final_release_readiness: parent rebuilds accepted source after Tasks 1-6",
    "physical_device_proof: Task 8 hardware acceptance pending",
    "tui_native_runtime_proof: pending downstream integration"
  ]
}
METAEOF

bash "$ROOT/scripts/verify-migration-kit.sh" --archive "$ARCHIVE_TMP" --expected-digest "sha256:$ARTIFACT_SHA256"

# ── Exclusive publish into owned output directory ───────────────────────────────
/usr/bin/perl - "$PUBLISH_TMP" "$KIT_OUT" "$ARCHIVE_NAME" <<'PUBLISH'
use strict; use warnings; use Fcntl qw(:DEFAULT);
my ($from,$to,$archive)=@ARGV; my @created; my $made=0;
if(!-e $to){mkdir($to,0700) or die "OUTPUT_PARENT: output parent must exist: $!";$made=1;}
-d $to && !-l $to or die "UNSAFE_OUTPUT\n";
my @dirid=lstat $to;
my $success=eval {
 for my $name ($archive,'ARTIFACT-DIGEST.sha256','kit-meta.json') {
  open(my $in,'<',"$from/$name") or die "PUBLISH_READ\n";binmode $in;
  my $dest="$to/$name";
  sysopen(my $out,$dest,O_WRONLY|O_CREAT|O_EXCL,0644) or die "OUTPUT_OCCUPIED: $name\n";
  my @id=stat $out;push @created,[$dest,$id[0],$id[1]];binmode $out;
  while(1){my $n=read($in,my $b,65536);defined($n) or die "PUBLISH_READ\n";last unless $n;print {$out} $b or die "PUBLISH_WRITE\n";}
  close($out) or die "PUBLISH_CLOSE\n";close $in;
 }
 1;
};
if(!$success){my $error=$@;for my $entry (@created){my @now=lstat $entry->[0];if(@now && $now[0]==$entry->[1] && $now[1]==$entry->[2]){unlink $entry->[0];}else{warn "PUBLISH_HOLD: output identity changed\n";}}
 my @now=lstat $to;rmdir $to if $made && @now && $now[0]==$dirid[0] && $now[1]==$dirid[1];die $error;
}
PUBLISH

say ""
say "build-migration-kit COMPLETE (source-foundation closure)"
say "  commit:          $GIT_COMMIT"
say "  archive:         $KIT_OUT/$ARCHIVE_NAME"
say "  artifact digest: sha256:$ARTIFACT_SHA256"
say "  members:         $MANIFEST_MEMBERS"
say "  PENDING (separate gate): final release readiness after Tasks 1-6; physical Task 8 proof"

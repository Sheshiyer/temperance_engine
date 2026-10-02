#!/bin/bash
# Offline behavioral qualification. Commits are only in disposable fixture repos.
# Real registry lock/vendor, synthetic CLI/manifest: not Tasks 1–6 integration.
set -euo pipefail
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BUILD="$ROOT/scripts/build-migration-kit.sh"; VERIFY="$ROOT/scripts/verify-migration-kit.sh"
: "${TOOLCHAIN_CACHE_DIR:?explicit reviewed cache required}"
: "${KIT_VENDOR_DIR:?frozen dependency directory required}"
: "${KIT_EXPECTED_VENDOR_DIGEST:?independently reviewed tree digest required}"
BUN="$TOOLCHAIN_CACHE_DIR/bun-1.3.5-arm64/bun"; VENDOR_DIR=$(cd "$KIT_VENDOR_DIR" && pwd)
SANDBOX=$(mktemp -d "${TMPDIR:-/tmp}/te-kit-test.XXXXXX"); trap 'rm -rf "$SANDBOX"' EXIT
SANDBOX=$(cd "$SANDBOX" && pwd -P)
PASS=0
ok(){ PASS=$((PASS+1)); printf 'PASS: %s\n' "$*"; }
fail(){ printf 'FAIL: %s\n%s\n' "$*" "${OUTPUT:-}" >&2; exit 1; }
sha(){ shasum -a 256 "$1" | awk '{print $1}'; }
run(){ set +e; OUTPUT=$("$@" 2>&1); RC=$?; set -e; }
refused(){ [ "$RC" -ne 0 ] && printf '%s\n' "$OUTPUT" | grep -q "$1" || fail "expected refusal $1 (rc=$RC)"; ok "$1"; }
# Actual source installer, not the synthetic archive fixture below. Child-only
# uname values are compatibility inputs, not physical-platform acceptance.
BOOT="$SANDBOX/actual-bootstrap"; mkdir "$BOOT"
git -C "$ROOT" archive HEAD | tar -xf - -C "$BOOT"
cp "$ROOT/install.sh" "$BOOT/install.sh"; cp "$ROOT/scripts/lib.sh" "$BOOT/scripts/lib.sh"
mkdir "$SANDBOX/bootstrap-bin"
cat > "$SANDBOX/bootstrap-bin/uname" <<'SH'
#!/bin/sh
case "$1" in -s) printf '%s\n' "$FIXTURE_OS";; -m) printf '%s\n' "$FIXTURE_ARCH";; *) exit 1;; esac
SH
chmod +x "$SANDBOX/bootstrap-bin/uname"
ln -s /bin/sh "$SANDBOX/bootstrap-bin/sh"
ln -s /usr/bin/dirname "$SANDBOX/bootstrap-bin/dirname"
run env -i PATH="$SANDBOX/bootstrap-bin" /bin/sh -c 'for tool in bun git brew node codegraph; do if command -v "$tool" >/dev/null 2>&1; then exit 1; fi; done'
[ "$RC" = 0 ] || fail 'ambient developer tool visible in minimal child PATH'
ok 'minimal child PATH excludes ambient Bun, Git, Homebrew, Node and CodeGraph'

cat > "$SANDBOX/provenance.json" <<'JSON'
{"schema":"temperance.kit-provenance.v1","source_commit":"1111111111111111111111111111111111111111","source_tree":"git-tree:2222222222222222222222222222222222222222","registry_lock_sha256":"3333333333333333333333333333333333333333333333333333333333333333","install_manifest_lock_sha256":"4444444444444444444444444444444444444444444444444444444444444444","reviewed_vendor_digest":"sha256:5555555555555555555555555555555555555555555555555555555555555555","bun":"1.3.5","opentui":"0.5.11","ajv":"8.20.0","typescript":"5.9.3","native":{"path":"package/install-surface/node_modules/@opentui/core-darwin-arm64/libopentui.dylib","format":"Mach-O","arch":"arm64","sha256":"6666666666666666666666666666666666666666666666666666666666666666","authority":"observation-bound-to-reviewed-vendor-tree"},"pending":["Task8 physical acceptance"]}
JSON
# Deliberately fictional metadata: compatibility assertions, never release trust.
cp "$SANDBOX/provenance.json" "$BOOT/KIT-PROVENANCE.json"
bootstrap(){
 local dest="$1" os="$2" arch="$3"; shift 3
 run env -i PATH="$SANDBOX/bootstrap-bin" HOME="$dest/home" TMPDIR="$SANDBOX" \
  PAI_HOME="$dest/pai" CLAUDE_CONFIG_DIR="$dest/pai" CODEX_HOME="$dest/codex" \
  OPENCODE_HOME="$dest/opencode" CURSOR_HOME="$dest/cursor" AGENTS_HOME="$dest/agents" \
  XDG_CONFIG_HOME="$dest/config" TEMPERANCE_STATE="$dest/state" TEMPERANCE_STATE_DIR="$dest/state" \
  TEMPERANCE_BACKUP_DIR="$dest/backups" TEMPERANCE_ALLOW_LIVE_INSPECTION=0 \
  FIXTURE_OS="$os" FIXTURE_ARCH="$arch" /bin/sh "$BOOT/install.sh" "$@"
}
D="$SANDBOX/bootstrap-incompatible"
bootstrap "$D" Darwin x86_64; refused KIT_PLATFORM_HOLD
[ ! -e "$D" ] || fail 'kit architecture hold wrote destination'
bootstrap "$D" Linux arm64; refused KIT_PLATFORM_HOLD
[ ! -e "$D" ] || fail 'kit OS hold wrote destination'
for variant in malformed unknown boolean duplicate native pin escaped oversized link hardlink directory missing manifest; do
 cp "$SANDBOX/provenance.json" "$BOOT/KIT-PROVENANCE.json"
 case "$variant" in
 malformed) printf '{' > "$BOOT/KIT-PROVENANCE.json" ;;
 unknown) perl -pi -e 's/"schema":/"unknown":true,"schema":/' "$BOOT/KIT-PROVENANCE.json" ;;
 boolean) perl -pi -e 's/"bun":"1.3.5"/"bun":true/' "$BOOT/KIT-PROVENANCE.json" ;;
 duplicate) perl -pi -e 's/"schema":/"bun":"1.3.5","schema":/' "$BOOT/KIT-PROVENANCE.json" ;;
 native) perl -pi -e 's/"arch":"arm64"/"arch":"x64"/' "$BOOT/KIT-PROVENANCE.json" ;;
 pin) perl -pi -e 's/"bun":"1.3.5"/"bun":"1.3.50"/' "$BOOT/KIT-PROVENANCE.json" ;;
 escaped) perl -pi -e 's/1\.3\.5/1\\u002e3.5/' "$BOOT/KIT-PROVENANCE.json" ;;
 oversized) /usr/bin/perl -e 'print " " x 8193' > "$BOOT/KIT-PROVENANCE.json" ;;
 link) rm "$BOOT/KIT-PROVENANCE.json"; ln -s "$SANDBOX/provenance.json" "$BOOT/KIT-PROVENANCE.json" ;;
 hardlink) rm "$BOOT/KIT-PROVENANCE.json"; ln "$SANDBOX/provenance.json" "$BOOT/KIT-PROVENANCE.json" ;;
 directory) rm "$BOOT/KIT-PROVENANCE.json"; mkdir "$BOOT/KIT-PROVENANCE.json" ;;
 missing) rm "$BOOT/KIT-PROVENANCE.json"; mkdir "$BOOT/toolchain" ;;
 manifest) rm "$BOOT/KIT-PROVENANCE.json"; touch "$BOOT/INNER-MANIFEST.sha256" ;;
 esac
 bootstrap "$D" Darwin arm64; refused KIT_METADATA_HOLD
 [ ! -e "$D" ] || fail 'metadata hold wrote destination'
 [ ! -d "$BOOT/KIT-PROVENANCE.json" ] || rmdir "$BOOT/KIT-PROVENANCE.json"
 rm -f "$BOOT/KIT-PROVENANCE.json" "$BOOT/INNER-MANIFEST.sha256"; [ ! -d "$BOOT/toolchain" ] || rmdir "$BOOT/toolchain"
done
cp "$SANDBOX/provenance.json" "$BOOT/KIT-PROVENANCE.json"
for flag in --with-spine --with-relay --with-voice --with-claude --with-codex --with-opencode --with-cursor --with-gsd --with-manifest --force; do
 bootstrap "$D" Darwin arm64 "$flag"; refused BOOTSTRAP_OPTION_HOLD
 [ ! -e "$D" ] || fail 'optional activation hold wrote destination'
done
bootstrap "$D" Darwin arm64 --dry-run
[ "$RC" = 0 ] && [ ! -e "$D" ] || fail 'minimal kit dry-run wrote state'
printf '%s\n' "$OUTPUT" | grep -q 'dry-run complete: no files created' || fail 'dry-run completion overclaims installed files'
ok 'minimal kit dry-run is zero-write'
D="$SANDBOX/bootstrap-preservation"; mkdir -p "$D/home" "$D/codex/hooks" "$D/config"
printf 'arbitrary changed instructions\n' > "$D/home/AGENTS.md"; chmod 0600 "$D/home/AGENTS.md"
printf 'user resolver config\n' > "$D/codex/hooks/skill_cluster_resolver.mjs"; chmod 0640 "$D/codex/hooks/skill_cluster_resolver.mjs"
printf 'UNRELATED\n' > "$D/config/sentinel"
BEFORE=$(/usr/bin/perl -MDigest::SHA=sha256_hex -e 'for(@ARGV){open my $f,"<",$_ or die;local $/;my $b=<$f>;print sha256_hex($b)," ",(stat($_))[2]&0777,"\n";}' "$D/home/AGENTS.md" "$D/codex/hooks/skill_cluster_resolver.mjs" "$D/config/sentinel")
bootstrap "$D" Darwin arm64
[ "$RC" = 0 ] || fail 'actual minimal kit installer'
bootstrap "$D" Darwin arm64 --skip-voice --skip-claude --skip-codex --skip-opencode --skip-cursor --skip-gsd --skip-manifest --skip-relay
[ "$RC" = 0 ] || fail 'repeat actual minimal kit installer'
AFTER=$(/usr/bin/perl -MDigest::SHA=sha256_hex -e 'for(@ARGV){open my $f,"<",$_ or die;local $/;my $b=<$f>;print sha256_hex($b)," ",(stat($_))[2]&0777,"\n";}' "$D/home/AGENTS.md" "$D/codex/hooks/skill_cluster_resolver.mjs" "$D/config/sentinel")
[ "$BEFORE" = "$AFTER" ] && [ ! -e "$D/backups" ] || fail 'changed user bytes/modes/sentinel or backups'
ok 'actual minimal kit repeats preserve arbitrary user bytes, modes, sentinel; no backups'
D="$SANDBOX/bootstrap-fresh"; bootstrap "$D" Darwin arm64
[ "$RC" = 0 ] && cmp -s "$D/home/AGENTS.md" "$BOOT/templates/AGENTS.md" && cmp -s "$D/codex/hooks/skill_cluster_resolver.mjs" "$BOOT/package/skill-resolvers/skill_cluster_resolver.mjs" || fail 'fresh generic bootstrap files'
[ "$(stat -f %Lp "$D/home/AGENTS.md")" = "$(stat -f %Lp "$BOOT/templates/AGENTS.md")" ] && [ "$(stat -f %Lp "$D/codex/hooks/skill_cluster_resolver.mjs")" = "$(stat -f %Lp "$BOOT/package/skill-resolvers/skill_cluster_resolver.mjs")" ] || fail 'new generic file modes differ from owned sources'
chmod 0600 "$D/home/AGENTS.md"
bootstrap "$D" Darwin arm64
[ "$RC" = 0 ] && [ "$(stat -f %Lp "$D/home/AGENTS.md")" = 600 ] && [ ! -e "$D/backups" ] || fail 'identical existing file mode/backups changed'
ok 'fresh actual bootstrap and identical repeat preserve mode without duplicate backups'
for absent in pai opencode cursor config state backups; do [ ! -e "$D/$absent" ] || fail "minimal bootstrap entered optional $absent surface"; done
ok 'minimal kit default creates only generic surfaces with no optional activation'
rm "$D/home/AGENTS.md"; ln -s missing-target "$D/home/AGENTS.md"
bootstrap "$D" Darwin arm64
[ "$RC" = 0 ] && [ "$(readlink "$D/home/AGENTS.md")" = missing-target ] && [ ! -e "$D/home/missing-target" ] || fail 'dangling destination link followed/replaced'
ok 'existing destination link preserved without following it'
printf 'linked user bytes\n' > "$D/home/target"; chmod 0640 "$D/home/target"
rm "$D/home/AGENTS.md"; ln -s target "$D/home/AGENTS.md"
bootstrap "$D" Darwin arm64
[ "$RC" = 0 ] && [ "$(readlink "$D/home/AGENTS.md")" = target ] && [ "$(cat "$D/home/target")" = 'linked user bytes' ] && [ "$(stat -f %Lp "$D/home/target")" = 640 ] || fail 'linked existing file mutated'
ok 'existing symlink and target bytes/mode remain unchanged'
rm "$D/home/AGENTS.md"; ln "$D/home/target" "$D/home/AGENTS.md"
bootstrap "$D" Darwin arm64
[ "$RC" = 0 ] && [ "$(stat -f %l "$D/home/target")" = 2 ] && [ "$(cat "$D/home/target")" = 'linked user bytes' ] || fail 'hardlinked existing file mutated'
ok 'existing hardlinked configuration preserved without adoption'
D="$SANDBOX/bootstrap-linked-parent"; mkdir -p "$D/elsewhere" "$D/codex"; ln -s "$D/elsewhere" "$D/codex/hooks"
bootstrap "$D" Darwin arm64; refused BOOTSTRAP_PATH_HOLD
[ ! -e "$D/home" ] && [ -z "$(ls -A "$D/elsewhere")" ] || fail 'linked parent refusal had effects'
for parent in home codex/hooks agents; do
 D="$SANDBOX/bootstrap-file-parent-${parent//\//-}"; mkdir -p "$D/codex"
 printf 'FOREIGN_PARENT\n' > "$D/$parent"; chmod 0640 "$D/$parent"
 bootstrap "$D" Darwin arm64; refused BOOTSTRAP_PATH_HOLD
 [ "$(cat "$D/$parent")" = FOREIGN_PARENT ] && [ "$(stat -f %Lp "$D/$parent")" = 640 ] && [ ! -e "$D/home/AGENTS.md" ] || fail 'non-directory parent refusal had effects'
done
# Check both owned sources before a first output; this fixture never modifies
# the real checkout or dereferences its substitute source link.
mv "$BOOT/package/skill-resolvers/skill_cluster_resolver.mjs" "$SANDBOX/resolver-source"
ln -s "$SANDBOX/resolver-source" "$BOOT/package/skill-resolvers/skill_cluster_resolver.mjs"
D="$SANDBOX/bootstrap-linked-source"; bootstrap "$D" Darwin arm64; refused BOOTSTRAP_PATH_HOLD
[ ! -e "$D" ] || fail 'unsafe source hold wrote destination'
rm "$BOOT/package/skill-resolvers/skill_cluster_resolver.mjs"
mv "$SANDBOX/resolver-source" "$BOOT/package/skill-resolvers/skill_cluster_resolver.mjs"
# Both generic sources must have exactly one link, at preflight and again at
# copy time. Link changes below are deterministic disposable fixture steps,
# not a claim to exhaustively reproduce adversarial filesystem races.
source_snapshot(){ /usr/bin/perl -MDigest::SHA -e 'for(@ARGV){my @s=lstat $_;open my $f,"<",$_ or die;print join(" ",$s[0],$s[1],$s[2],$s[3],Digest::SHA->new(256)->addfile($f)->hexdigest),"\n";}' "$@"; }
bootstrap_library(){
 local dest="$1"; shift
 run env -i PATH="$SANDBOX/bootstrap-bin" HOME="$dest/home" TMPDIR="$SANDBOX" \
  PAI_HOME="$dest/pai" CLAUDE_CONFIG_DIR="$dest/pai" CODEX_HOME="$dest/codex" \
  OPENCODE_HOME="$dest/opencode" CURSOR_HOME="$dest/cursor" AGENTS_HOME="$dest/agents" \
  XDG_CONFIG_HOME="$dest/config" TEMPERANCE_STATE="$dest/state" TEMPERANCE_STATE_DIR="$dest/state" \
  TEMPERANCE_BACKUP_DIR="$dest/backups" TEMPERANCE_ALLOW_LIVE_INSPECTION=0 TEMPERANCE_DRY_RUN=0 \
  /bin/sh -c '. "$1/scripts/lib.sh"; shift; preserve_bootstrap "$@"' sh "$BOOT" "$@"
}
for source in templates/AGENTS.md package/skill-resolvers/skill_cluster_resolver.mjs; do
 source_name="${source##*/}"
 mv "$BOOT/$source" "$SANDBOX/source-saved"
 printf 'FOREIGN_SOURCE_BYTES\n' > "$SANDBOX/foreign-source"; chmod 0640 "$SANDBOX/foreign-source"
 ln "$SANDBOX/foreign-source" "$BOOT/$source"
 BEFORE=$(source_snapshot "$BOOT/$source" "$SANDBOX/foreign-source")
 D="$SANDBOX/bootstrap-source-hardlink-$source_name"; bootstrap "$D" Darwin arm64
 refused BOOTSTRAP_PATH_HOLD
 [ ! -e "$D" ] && [ "$BEFORE" = "$(source_snapshot "$BOOT/$source" "$SANDBOX/foreign-source")" ] || fail 'source hardlink preflight changed output or foreign fixture'
 ok "hardlinked $source_name refused before bootstrap effects with foreign bytes/mode/links intact"
 rm "$BOOT/$source" "$SANDBOX/foreign-source"; mv "$SANDBOX/source-saved" "$BOOT/$source"
 for transition in same_inode_link foreign_link_swap; do
  D="$SANDBOX/bootstrap-source-transition-$source_name-$transition"
  bootstrap_library "$D" sources "$BOOT/$source"
  [ "$RC" = 0 ] || fail 'single-link source preflight unexpectedly refused'
  if [ "$transition" = same_inode_link ]; then
   ln "$BOOT/$source" "$SANDBOX/foreign-source"
  else
   mv "$BOOT/$source" "$SANDBOX/source-saved"
   printf 'SWAPPED_FOREIGN_SOURCE\n' > "$SANDBOX/foreign-source"; chmod 0600 "$SANDBOX/foreign-source"
   ln "$SANDBOX/foreign-source" "$BOOT/$source"
  fi
  BEFORE=$(source_snapshot "$BOOT/$source" "$SANDBOX/foreign-source")
  bootstrap_library "$D" copy "$BOOT/$source" "$D/new/target"
  refused BOOTSTRAP_PATH_HOLD
  [ ! -e "$D" ] && [ "$BEFORE" = "$(source_snapshot "$BOOT/$source" "$SANDBOX/foreign-source")" ] || fail 'copy-time source hardlink hold changed destination or foreign fixture'
  ok "$source_name $transition after preflight refused at copy time without effects"
  rm "$SANDBOX/foreign-source"
  if [ "$transition" = foreign_link_swap ]; then rm "$BOOT/$source"; mv "$SANDBOX/source-saved" "$BOOT/$source"; fi
 done
done
# Instrumented absolute-tool absence: only the disposable script copy changes.
# PATH alone cannot simulate absence of the stock absolute Perl prerequisite.
cp "$BOOT/install.sh" "$SANDBOX/install-before-missing-tool"
/usr/bin/perl -pi -e 's{/usr/bin/perl}{/nonexistent-bootstrap-fixture/perl}g' "$BOOT/install.sh"
D="$SANDBOX/bootstrap-no-perl"; bootstrap "$D" Darwin arm64; refused KIT_METADATA_HOLD
[ ! -e "$D" ] || fail 'instrumented missing kit Perl wrote state'
cp "$SANDBOX/install-before-missing-tool" "$BOOT/install.sh"
ok 'instrumented absolute Perl absence holds; no host tool renamed or removed'
mv "$SANDBOX/bootstrap-bin/uname" "$SANDBOX/fixture-uname"
D="$SANDBOX/bootstrap-no-uname"; bootstrap "$D" Darwin arm64; refused KIT_PLATFORM_HOLD
[ ! -e "$D" ] || fail 'missing PATH uname wrote state'
mv "$SANDBOX/fixture-uname" "$SANDBOX/bootstrap-bin/uname"
# Explicit source-checkout safe mode, versus unchanged legacy dry-run platform support.
rm "$BOOT/KIT-PROVENANCE.json"
D="$SANDBOX/bootstrap-source"; bootstrap "$D" Linux x86_64 --preserve-existing
[ "$RC" = 0 ] && [ -f "$D/home/AGENTS.md" ] || fail 'explicit source preservation mode'
ok 'source checkout explicitly opts into minimal preservation mode'
bootstrap "$SANDBOX/bootstrap-source-option" Linux x86_64 --preserve-existing --with-voice --skip-voice
refused BOOTSTRAP_OPTION_HOLD
[ ! -e "$SANDBOX/bootstrap-source-option" ] || fail 'later skip bypassed optional activation hold'
cp "$BOOT/scripts/lib.sh" "$SANDBOX/lib-before-missing-tool"
/usr/bin/perl -pi -e 's{/usr/bin/perl}{/nonexistent-bootstrap-fixture/perl}g' "$BOOT/scripts/lib.sh"
D="$SANDBOX/bootstrap-source-no-perl"; bootstrap "$D" Linux x86_64 --preserve-existing; refused BOOTSTRAP_PREREQ_HOLD
[ ! -e "$D" ] || fail 'instrumented missing source-mode Perl wrote state'
cp "$SANDBOX/lib-before-missing-tool" "$BOOT/scripts/lib.sh"
bootstrap "$SANDBOX/bootstrap-source-plan" Linux x86_64 --dry-run --skip-voice --skip-claude --skip-codex --skip-opencode --skip-cursor --skip-gsd --skip-manifest --skip-relay
# Legacy verifier requires Node, intentionally absent from stock PATH; reaching
# legacy mode output is sufficient here, never a successful install claim.
printf '%s\n' "$OUTPUT" | grep -q 'Temperance Engine installer' || fail 'legacy source platform compatibility changed'
ok 'legacy source platform support retained (dry-run only)'

commit_fixture(){ git -C "$1" add -A; git -C "$1" -c user.name=Fixture -c user.email=test@fixture.local commit -qm fixture; }
make_fixture(){
 local fx="$1"
 mkdir -p "$fx/scripts" "$fx/docs" "$fx/package/install-surface/src" "$fx/package/install-surface/fragments" "$fx/package/install-surface/schemas"
 git -C "$fx" init -q
 cp "$BUILD" "$fx/scripts/build-migration-kit.sh"; cp "$VERIFY" "$fx/scripts/verify-migration-kit.sh"
 printf '0.9.9\n' > "$fx/VERSION"
 printf '#!/bin/sh\nsh "$ROOT_DIR/scripts/install-pai.sh"\n' > "$fx/install.sh"
 for p in uninstall.sh verify.sh scripts/verify-install.sh scripts/lib.sh scripts/install-pai.sh scripts/install-skill-clusters.sh scripts/install-peon-ping.sh scripts/install-codegraph.sh scripts/install-gsd.sh scripts/install-spine.sh scripts/configure-opencode.sh scripts/wire-multi-backend.sh scripts/temperance-proxy-launchd.sh scripts/configure-opencode-relay.sh; do printf '#!/bin/sh\nexit 0\n' > "$fx/$p"; done
 printf '# Synthetic lifecycle fixture\n' > "$fx/docs/modular-mac-lifecycle.md"
 cp "$ROOT/package/install-surface/package.json" "$ROOT/package/install-surface/bun.lock" "$fx/package/install-surface/"
 cp "$ROOT/package/install-surface/schemas/lock.v1.schema.json" "$fx/package/install-surface/schemas/"
 "$BUN" - "$ROOT" "$fx" <<'JS'
const fs=require('node:fs');const [root,fx]=process.argv.slice(2);
const lock=JSON.parse(fs.readFileSync(root+'/package/install-surface/install-surface-manifest.lock.json','utf8'));
lock.records=[lock.records.find(r=>r.class==='NEVER-SHIP')];
fs.writeFileSync(fx+'/package/install-surface/install-surface-manifest.lock.json',JSON.stringify(lock));
fs.writeFileSync(fx+'/package/install-surface/fragments/boundary.json',JSON.stringify({records:lock.records}));
JS
 printf 'export const synthetic = true; console.log("SYNTHETIC_ONLY"); if (process.argv.includes("--lazy-fixture")) console.log((await import("./lazy-fixture.ts")).value);\n' > "$fx/package/install-surface/src/cli.ts"
 printf 'export const value = "SYNTHETIC_LAZY_CHUNK";\n' > "$fx/package/install-surface/src/lazy-fixture.ts"
 commit_fixture "$fx"
}
build(){ local fx="$1"; shift; run /bin/bash "$fx/scripts/build-migration-kit.sh" --vendor-dir "$VENDOR_DIR" "$@"; }
FX="$SANDBOX/fixture"; make_fixture "$FX"
build "$FX" --dry-run; refused MISSING_COMMIT
build "$FX" --commit badbadbad --dry-run; refused UNRESOLVED_COMMIT
mkdir -p "$SANDBOX/nongit/scripts"; cp "$BUILD" "$SANDBOX/nongit/scripts/"
build "$SANDBOX/nongit" --commit HEAD --dry-run; refused NO_GIT
build "$FX" --commit HEAD --arch x64 --dry-run; refused ARCH_HOLD
run env KIT_VERSION='x/../../escape' /bin/bash "$FX/scripts/build-migration-kit.sh" --commit HEAD; refused BAD_VERSION
run env TOOLCHAIN_CACHE_DIR= /bin/bash "$FX/scripts/build-migration-kit.sh" --commit HEAD --vendor-dir "$VENDOR_DIR"; refused MISSING_CLOSURE
run env KIT_EXPECTED_VENDOR_DIGEST= /bin/bash "$FX/scripts/build-migration-kit.sh" --commit HEAD --vendor-dir "$VENDOR_DIR"; refused MISSING_VENDOR_DIGEST
build "$FX" --commit HEAD --expected-vendor-digest "sha256:$(printf '%064d' 0)" --dry-run; refused VENDOR_DIGEST_MISMATCH
for variant in malformed fake_integrity forged_integrity missing_manifest malformed_manifest manifest_fragments missing_source required_check; do
 BAD="$SANDBOX/$variant"; make_fixture "$BAD"
 case "$variant" in
 malformed) printf '{ "lockfileVersion": 1 invalid' > "$BAD/package/install-surface/bun.lock"; expected=DUMMY_LOCK ;;
 fake_integrity) perl -pi -e 's/sha512-[A-Za-z0-9+\/=]+/sha512-x/' "$BAD/package/install-surface/bun.lock"; expected=LOCK_MISMATCH ;;
 forged_integrity) perl -pi -e 's/sha512-pImM/sha512-aImM/' "$BAD/package/install-surface/bun.lock"; expected=LOCK_MISMATCH ;;
 missing_manifest) rm "$BAD/package/install-surface/install-surface-manifest.lock.json"; expected=MISSING_CLOSURE ;;
 malformed_manifest) printf '{}' > "$BAD/package/install-surface/install-surface-manifest.lock.json"; expected=MANIFEST_LOCK_MISMATCH ;;
 manifest_fragments) perl -pi -e 's/boundary.native-sessions/boundary.different/' "$BAD/package/install-surface/install-surface-manifest.lock.json"; expected=MANIFEST_LOCK_MISMATCH ;;
 required_check) printf 'check_file "$ROOT/private-required.txt"\n' >> "$BAD/scripts/verify-install.sh"; expected=CLOSURE_OMISSION ;;
 missing_source) rm "$BAD/scripts/install-pai.sh"; expected=CLOSURE_OMISSION ;;
 esac
 commit_fixture "$BAD"; build "$BAD" --commit HEAD --dry-run --out "$SANDBOX/out-$variant"; refused "$expected"
 [ ! -e "$SANDBOX/out-$variant" ] || fail 'failed builder created output'
done
build "$FX" --commit HEAD --dry-run --out "$SANDBOX/dry"
[ "$RC" = 0 ] && [ ! -e "$SANDBOX/dry" ] || fail 'stock Bash dry-run'
printf '%s\n' "$OUTPUT" | grep -q '21 frozen dependencies' || fail 'real 21-dependency closure'
ok 'stock Bash dry-run: real lock, manifest, 21 frozen dependencies, safe .bin links, no output'
# Independent inventory of intentionally mutated test trees; no release authority.
vendor_digest(){ /usr/bin/perl - "$1" <<'PERL'
use strict;use warnings;use File::Find;use Digest::SHA qw(sha256_hex);
my $root=shift;my @rows;
find({no_chdir=>1,wanted=>sub{my $p=$File::Find::name;return if $p eq $root;my $rel=substr($p,length($root)+1);my @s=lstat $p;
if(-l _){push @rows,'link  '.readlink($p).'  '.$rel."\n";}
elsif(-f _){open my $f,'<',$p or die;binmode $f;my $sha=Digest::SHA->new(256)->addfile($f)->hexdigest;push @rows,$sha.'  '.(($s[2]&0111)?'0755':'0644').'  '.$rel."\n";close $f;}
}},$root);print 'sha256:'.sha256_hex(join('',sort @rows));
PERL
}
[ "$(vendor_digest "$VENDOR_DIR")" = "$KIT_EXPECTED_VENDOR_DIGEST" ] || fail 'independent vendor inventory digest'
ok 'independent Perl inventory agrees with reviewed input'
for variant in missing_native wrong_native empty_native escaped_bin; do
 V="$SANDBOX/vendor-$variant"; cp -R "$VENDOR_DIR" "$V"
 case "$variant" in
 missing_native) rm "$V/@opentui/core-darwin-arm64/libopentui.dylib"; expected=MISSING_CLOSURE ;;
 wrong_native) perl -e 'open my $f,"+<",$ARGV[0] or die;binmode $f;seek $f,4,0;print $f pack("V",0x01000007);' "$V/@opentui/core-darwin-arm64/libopentui.dylib"; expected=NATIVE_ARCH_MISMATCH ;;
 empty_native) : > "$V/@opentui/core-darwin-arm64/libopentui.dylib"; expected=MISSING_CLOSURE ;;
 escaped_bin) ln -s /bin/sh "$V/.bin/escape"; expected=UNSAFE_VENDOR ;;
 esac
 DIGEST=$(vendor_digest "$V")
 build "$FX" --commit HEAD --vendor-dir "$V" --expected-vendor-digest "$DIGEST" --dry-run; refused "$expected"
 rm -rf "$V"
done
# Vendor privacy is separate from byte authentication. Authenticate intentional
# synthetic mutations to prove the privacy scan itself refuses them.
for variant in vendor_volume vendor_home vendor_session vendor_account vendor_endpoint vendor_binary_credentials upstream_neighbor; do
 V="$SANDBOX/privacy-$variant"; cp -R "$VENDOR_DIR" "$V"
 target="$V/ajv/README.md"
 case "$variant" in
 vendor_volume) printf '\n/Vol%s/PersonalSSD/private\n' umes >> "$target" ;;
 vendor_home) printf '\n/U%s/private/work\n' sers >> "$target" ;;
 vendor_session) printf '\n{"session_id":"%s-%040d"}\n' synthetic-session 0 >> "$target" ;;
 vendor_account) printf '\n{"account_id":"%s-%040d"}\n' synthetic-account 0 >> "$target" ;;
 vendor_endpoint) printf '\nhttps://api.fixture.invalid/accounts/%032d\n' 0 >> "$target" ;;
 vendor_binary_credentials) printf '\0sk-%s-%040d\0\n' proj 0 >> "$target" ;;
 upstream_neighbor)
   target="$V/bun-types/globals.d.ts"
   # Add a private-looking neighbor to the existing upstream example line.
   perl -pi -e 'my $u="U"."sers";my $v="Vol"."umes";if(m{file:///$u/me/}){s{\n$}{ // "/$v/PersonalSSD/private"\n};}' "$target"
   ;;
 esac
 DIGEST=$(vendor_digest "$V")
 build "$FX" --commit HEAD --vendor-dir "$V" --expected-vendor-digest "$DIGEST" --out "$SANDBOX/out-$variant"
 refused PRIVACY
 printf '%s\n' "$OUTPUT" | grep -q "node_modules/${target#"$V/"}" || fail 'vendor privacy refusal did not identify mutated file'
 [ ! -e "$SANDBOX/out-$variant" ] || fail 'vendor privacy failure published output'
 rm -rf "$V"
done
for variant in private_volume private_home token_ant token_proj credentials; do
 BAD="$SANDBOX/privacy-$variant"; make_fixture "$BAD"
 case "$variant" in
 private_volume) printf '/Vol%s/PersonalSSD/private\n' umes > "$BAD/leak.txt" ;;
 private_home) printf '/U%s/private/secret\n' sers > "$BAD/leak.txt" ;;
 token_ant) printf 'sk-%s-%040d\n' ant 0 > "$BAD/leak.txt" ;;
 token_proj) printf 'sk-%s-%040d\n' proj 0 > "$BAD/leak.txt" ;;
 credentials) printf '{}\n' > "$BAD/credentials.json" ;;
 esac
 commit_fixture "$BAD"; build "$BAD" --commit HEAD --out "$SANDBOX/out-$variant"; refused PRIVACY
 [ ! -e "$SANDBOX/out-$variant" ] || fail 'privacy failure published output'
done
printf 'UNTRACKED\n' > "$FX/untracked.txt"; printf 'DIRTY\n' >> "$FX/package/install-surface/src/cli.ts"
build "$FX" --commit HEAD --out "$SANDBOX/green"
[ "$RC" = 0 ] || fail 'synthetic closure build'
ARCH="$SANDBOX/green/temperance-engine-0.9.9-arm64.tar.gz"; DIGEST=$(sha "$ARCH")
run /bin/bash "$VERIFY" --archive "$ARCH" --expected-digest "sha256:$DIGEST" --extract-to "$SANDBOX/verified"
[ "$RC" = 0 ] || fail 'genuine closed archive'
[ ! -e "$SANDBOX/verified/untracked.txt" ] || fail 'untracked byte leaked'
! grep -q DIRTY "$SANDBOX/verified/package/install-surface/src/cli.ts" || fail 'dirty byte leaked'
[ -s "$SANDBOX/verified/package/install-surface/node_modules/@opentui/core-darwin-arm64/libopentui.dylib" ] || fail 'native payload missing'
[ -z "$(find "$SANDBOX/verified" -type l -print)" ] || fail 'archive contains links'
ok 'closed synthetic kit verifies/extracts committed bytes, native asset, no links'
# Generated lazy chunks are part of the same authenticated kit closure.
DIST="$SANDBOX/verified/package/install-surface/dist"
CHUNK=$(find "$DIST" -type f -name '*.js' ! -name 'cli.js' | LC_ALL=C sort | head -n 1)
[ -n "$CHUNK" ] && [ -s "$CHUNK" ] || fail 'shipping build erased the lazy chunk boundary'
CHUNK_REL=${CHUNK#"$SANDBOX/verified/"}
grep -Fqx "$(sha "$CHUNK")  $CHUNK_REL" "$SANDBOX/verified/INNER-MANIFEST.sha256" || fail 'generated chunk absent from authenticated manifest'
run "$BUN" --no-env-file --config=/dev/null "$DIST/cli.js" --lazy-fixture
[ "$RC" = 0 ] && printf '%s\n' "$OUTPUT" | grep -qx SYNTHETIC_LAZY_CHUNK || fail 'authenticated lazy chunk could not load'
ok 'shipping build emits authenticated loadable lazy chunks'
for mutation in omitted tampered; do
 CHANGED="$SANDBOX/chunk-$mutation"; mkdir "$CHANGED"; cp -R "$SANDBOX/verified/." "$CHANGED/"
 if [ "$mutation" = omitted ]; then rm "$CHANGED/$CHUNK_REL"; else printf '\nCHANGED\n' >> "$CHANGED/$CHUNK_REL"; fi
 MUTATED_ARCH="$SANDBOX/temperance-engine-chunk-$mutation-arm64.tar.gz"
 (cd "$CHANGED" && COPYFILE_DISABLE=1 tar --format=ustar -czf "$MUTATED_ARCH" .)
 run /bin/bash "$VERIFY" --archive "$MUTATED_ARCH" --expected-digest "sha256:$(sha "$MUTATED_ARCH")" --extract-to "$SANDBOX/chunk-$mutation-out"
 [ "$RC" -ne 0 ] && [ ! -e "$SANDBOX/chunk-$mutation-out" ] || fail 'changed chunk extracted despite inner authentication'
 case "$mutation" in omitted) printf '%s\n' "$OUTPUT" | grep -q 'MISSING' || fail 'missing chunk refusal';; tampered) printf '%s\n' "$OUTPUT" | grep -q 'INNER checksum mismatch' || fail 'tampered chunk refusal';; esac
 ok "authenticated generated chunk $mutation refused before extraction"
done

printf 'KEEP\n' > "$SANDBOX/green/sentinel"
build "$FX" --commit HEAD --out "$SANDBOX/green"; refused OUTPUT_OCCUPIED
[ "$(cat "$SANDBOX/green/sentinel")" = KEEP ] || fail 'existing output changed'
run /bin/bash "$VERIFY" --archive "$ARCH" --expected-digest "sha256:$(printf '%064d' 0)" --extract-to "$SANDBOX/bad-checksum"
refused OUTER_DIGEST_MISMATCH; [ ! -e "$SANDBOX/bad-checksum" ] || fail 'bad checksum left output'
run /bin/bash "$VERIFY" --archive "$ARCH"; refused MISSING_DIGEST
mkdir "$SANDBOX/existing-empty"
run /bin/bash "$VERIFY" --archive "$ARCH" --expected-digest "sha256:$DIGEST" --extract-to "$SANDBOX/existing-empty"; refused UNSAFE_OUTPUT
# Independent raw ustar generator for bounded malicious fixtures.
craft(){ /usr/bin/perl - "$1" <<'PERL'
use strict;use warnings;use Digest::SHA qw(sha256_hex);
my $kind=shift;open my $gz,'|-','/usr/bin/gzip','-c' or die;
sub member {my($name,$body,$type,$size)=@_;$type//='0';$size//=length $body;
my $h=pack('a100 a8 a8 a8 a12 a12 a8 a1 a100 a6 a2 a32 a32 a8 a8 a155 a12',$name,sprintf('%07o',0644),sprintf('%07o',0),sprintf('%07o',0),sprintf('%011o',$size),sprintf('%011o',0),' 'x8,$type,'',"ustar\0",'00','','',sprintf('%07o',0),sprintf('%07o',0),'','');
substr($h,148,8)=sprintf('%06o',unpack('%32C*',$h))."\0 ";substr($h,0,1)='z' if $kind eq 'header_checksum';
print $gz $h,$body,"\0"x((512-length($body)%512)%512);}
my $body="hello\n";my $manifest=sha256_hex($body)."  payload.txt\n";
if($kind eq 'oversize'){member('large','',0,201*1024*1024);}
elsif($kind eq 'traversal'){member('../outside','x');}
elsif($kind eq 'alias'){member('a/./b','x');}
elsif($kind eq 'dotdot_dir'){member('././','','5');}
elsif($kind eq 'unsafe_ext'){member('payload.command','x');}
elsif($kind eq 'newline'){member("bad\nname",'x');}
elsif($kind eq 'symlink'){member('link','','2');}
elsif($kind eq 'hardlink'){member('link','','1');}
elsif($kind eq 'fifo'){member('pipe','','6');}
elsif($kind eq 'pax'){member('pax','11 path=x\n','x');}
elsif($kind eq 'gnu'){member('long','x','L');}
else {member('payload.txt',$kind eq 'inner_tamper'?"tamper\n":$body);
 member('payload.txt',$body) if $kind eq 'duplicate'; member('UNLISTED.txt','x') if $kind eq 'unlisted';
 $manifest.=sha256_hex($body)."  ./payload.txt\n" if $kind eq 'manifest_alias';
 $manifest.=sha256_hex($body)."  payload.txt\n" if $kind eq 'manifest_duplicate';member('INNER-MANIFEST.sha256',$manifest);}
print $gz "\0"x1024;print $gz 'x' if $kind eq 'trailing';close $gz or die;
PERL
}
for kind in good oversize traversal alias dotdot_dir unsafe_ext newline symlink hardlink fifo pax gnu header_checksum inner_tamper duplicate unlisted manifest_alias manifest_duplicate trailing; do
 A="$SANDBOX/temperance-engine-$kind-arm64.tar.gz"; craft "$kind" > "$A"
 run /bin/bash "$VERIFY" --archive "$A" --expected-digest "sha256:$(sha "$A")" --extract-to "$SANDBOX/extract-$kind"
 if [ "$kind" = good ]; then [ "$RC" = 0 ] || fail 'small canonical archive'; ok 'small canonical ustar archive';
 else
   case "$kind" in
     oversize) expected=BOUNDS;; traversal|alias|dotdot_dir|newline) expected=UNSAFE_PATH;;
     unsafe_ext) expected=UNSAFE_EXT;; symlink|hardlink|fifo|pax|gnu) expected=UNSAFE_ENTRY;;
     header_checksum|trailing) expected=MALFORMED_TAR;; inner_tamper) expected='INNER checksum mismatch';;
     duplicate) expected=DUPLICATE_ENTRY;; unlisted) expected=UNLISTED;;
     manifest_alias) expected=BAD_MANIFEST;; manifest_duplicate) expected=DUPLICATE_MANIFEST_ENTRY;;
   esac
   [ "$RC" -ne 0 ] && printf '%s\n' "$OUTPUT" | grep -q "$expected" && [ ! -e "$SANDBOX/extract-$kind" ] || fail "archive $kind escaped/wrong refusal/leftovers"
   ok "archive $kind refused with no output"
 fi
done
mkdir "$SANDBOX/bsd"
perl -e 'open my $f,">",$ARGV[0] or die;seek($f,201*1024*1024-1,0)or die;print $f "x";' "$SANDBOX/bsd/large"
BSD="$SANDBOX/temperance-engine-bsd-arm64.tar.gz"
COPYFILE_DISABLE=1 tar --format=ustar -czf "$BSD" -C "$SANDBOX/bsd" large
run /bin/bash "$VERIFY" --archive "$BSD" --expected-digest "sha256:$(sha "$BSD")" --extract-to "$SANDBOX/bsd-out"
refused BOUNDS; [ ! -e "$SANDBOX/bsd-out" ] || fail 'BSD bound left output'
# Existing installer plans only, in clean explicit homes; no actual install.
mkdir -p "$SANDBOX/home" "$SANDBOX/state" "$SANDBOX/config"; printf 'KEEP\n' > "$SANDBOX/config/user.txt"
for flags in '--with-spine --skip-relay --skip-voice' '--with-relay --skip-voice --skip-claude --skip-codex --skip-cursor --skip-opencode'; do
 run env -i PATH="$PATH" HOME="$SANDBOX/home" TEMPERANCE_STATE_DIR="$SANDBOX/state" TEMPERANCE_BACKUP_DIR="$SANDBOX/backups" /bin/sh "$ROOT/install.sh" --dry-run $flags
 [ "$RC" = 0 ] || fail 'legacy installer plan'
 ! printf '%s\n' "$OUTPUT" | grep -qi 'snow.gloves' || fail 'unexpected external product dependency'
 ok "legacy flag plan: $flags"
done
for ov in '{"schema":"temperance.overlay.v1"}' '{"schema":"temperance.overlay.v2"}' '{"host":"x"}'; do
 printf '%s\n' "$ov" > "$SANDBOX/overlay.json"
 run env -i PATH="$PATH" HOME="$SANDBOX/home" TEMPERANCE_STATE_DIR="$SANDBOX/state" TEMPERANCE_PRIVATE_OVERLAY="$SANDBOX/overlay.json" /bin/sh "$ROOT/install.sh"
 refused OVERLAY_HOLD
 [ "$(cat "$SANDBOX/config/user.txt")" = KEEP ] && [ -z "$(find "$SANDBOX/home" "$SANDBOX/state" -type f -print)" ] || fail 'overlay/config state changed'
done
for f in install.sh scripts/build-migration-kit.sh scripts/verify-migration-kit.sh scripts/verify-install.sh tests/migration-kit.sh scripts/lib.sh; do /bin/bash -n "$ROOT/$f"; done
ok 'stock Bash syntax'
! grep -n 'bun.sh/install' "$ROOT/package/install-surface/docs/guided-onboarding.md" "$ROOT/docs/modular-mac-lifecycle.md" || fail 'unpinned bootstrap'
ok 'manual bootstrap avoids unpinned installer'
printf '\n%d checks passed. Synthetic archive closure plus actual-source minimal bootstrap. Tasks 1–6 profile/CLI integration and Task 8 physical acceptance pending.\n' "$PASS"

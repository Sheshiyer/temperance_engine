#!/usr/bin/env sh

say() {
  printf '%s\n' "$*"
}

is_dry_run() {
  test "${TEMPERANCE_DRY_RUN:-0}" = "1"
}

run_cmd() {
  if is_dry_run; then
    printf 'DRY_RUN: %s\n' "$*"
  else
    "$@"
  fi
}

# Safe bootstrap only: path-based parent guards and exclusive file creation.
# Existing leaves (including links) are never read, changed, adopted or backed up.
# Parent directories must remain under caller control; this is not a hostile
# same-user ancestor-race boundary or a lifecycle rollback implementation.
preserve_bootstrap() {
  [ -x /usr/bin/perl ] || { say 'BOOTSTRAP_PREREQ_HOLD: stock Perl unavailable' >&2; return 1; }
  /usr/bin/perl - "${TEMPERANCE_DRY_RUN:-0}" "$@" <<'PRESERVE_BOOTSTRAP'
use strict; use warnings; use Fcntl qw(:DEFAULT); use Errno qw(ENOENT EEXIST); use Digest::SHA;
my($dry,$action,@args)=@ARGV;
sub hold {die "BOOTSTRAP_PATH_HOLD: unsafe or unavailable generic destination; no overwrite\n"}
sub normalized {
 my $p=shift; $p=~m{\A/} && $p!~/[\x00-\x1f\x7f]/ or hold();
 # Stock macOS aliases only; arbitrary parent symlinks remain forbidden.
 for my $alias ('tmp','var') {if($p=~m{\A/$alias(?:/|$)} && -l "/$alias"){readlink("/$alias") eq "private/$alias" || readlink("/$alias") eq "/private/$alias" or hold();$p=~s{\A/$alias}{/private/$alias};}}
 my @parts=grep {length}split m{/},$p;for(@parts){$_ ne '.' && $_ ne '..' or hold();}
 return '/'.join('/',@parts);
}
sub parents {
 my($path,$create,$include_leaf)=@_;my @parts=grep {length}split m{/},$path;pop @parts unless $include_leaf;my $p='';
 for(@parts){$p.='/'.$_;my @s=lstat $p;
  if(@s){-d _ && !-l _ or hold();}
  elsif($! != ENOENT){hold();}
  elsif($create){mkdir($p,0700) or hold();}
 }
}
sub source_current {
 my($path,$in,$device,$inode)=@_;my @opened=stat $in;my @now=lstat $path;
 @opened && @now && -f _ && !-l _ && $opened[3]==1 && $now[3]==1
  && $opened[0]==$device && $opened[1]==$inode
  && $now[0]==$device && $now[1]==$inode or hold();
}
if($action eq 'check'){for(@args){parents(normalized($_),0,0);}exit 0;}
if($action eq 'sources'){
 for my $source(@args){
  parents(normalized($source),0,0);
  my @src=lstat $source;@src && -f _ && !-l _ && $src[3]==1 or hold();
  sysopen(my $in,$source,O_RDONLY|O_NOFOLLOW) or hold();
  source_current($source,$in,$src[0],$src[1]);
  Digest::SHA->new(256)->addfile($in);
  source_current($source,$in,$src[0],$src[1]);close($in) or hold();
 }
 exit 0;
}
if($action eq 'directory'){my $p=normalized($args[0]);parents($p,!$dry,1);exit 0;}
$action eq 'copy' or hold();my($source,$destination)=@args;my $p=normalized($destination);
parents($p,0,0);my @existing=lstat $p;
if(@existing){print "PRESERVED_EXISTING: $destination\n";exit 0;} $! == ENOENT or hold();
parents(normalized($source),0,0);
my @src=lstat $source;@src && -f _ && !-l _ && $src[3]==1 or hold();
sysopen(my $in,$source,O_RDONLY|O_NOFOLLOW) or hold();
source_current($source,$in,$src[0],$src[1]);my $mode=$src[2]&0777;
if($dry){print "DRY_RUN: create absent generic file $destination\n";exit 0;}
parents($p,1,0);
source_current($source,$in,$src[0],$src[1]);
if(!sysopen(my $unused,$p,O_RDWR|O_CREAT|O_EXCL,$mode)){
 $! == EEXIST or hold();print "PRESERVED_EXISTING: $destination\n";exit 0;
} else {
 my $out=$unused;my @owned=stat $out;
 my $ok=eval {
  chmod($mode,$out)==1 or die;my $expected=Digest::SHA->new(256);
  while(1){
   source_current($source,$in,$src[0],$src[1]);
   my $n=read($in,my $bytes,65536);defined($n) or die;
   source_current($source,$in,$src[0],$src[1]);
   last unless $n;$expected->add($bytes);print {$out} $bytes or die;
  }
  seek($out,0,0) or die;Digest::SHA->new(256)->addfile($out)->hexdigest eq $expected->hexdigest or die;
  ((stat($out))[2]&0777)==$mode or die;
  source_current($source,$in,$src[0],$src[1]);close($out) or die;close($in) or die;1;
 };
 if(!$ok){my @now=lstat $p;unlink($p) if @now && $now[0]==$owned[0] && $now[1]==$owned[1];hold();}
 print "CREATED_GENERIC: $destination\n";
}
PRESERVE_BOOTSTRAP
}

ensure_dir() {
  if [ "${TEMPERANCE_PRESERVE_EXISTING:-0}" = 1 ]; then preserve_bootstrap directory "$1"; return; fi
  if is_dry_run; then
    printf 'DRY_RUN: mkdir -p %s\n' "$1"
  else
    mkdir -p "$1"
  fi
}

backup_file() {
  backup_src="$1"
  if test ! -e "$backup_src"; then
    return 0
  fi
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  backup_slug=$(printf '%s' "$backup_src" | sed 's#^/##; s#/#__#g')
  backup_dest="${TEMPERANCE_BACKUP_DIR:-$HOME/.temperance_engine/backups}/$stamp/$backup_slug"
  ensure_dir "$(dirname "$backup_dest")"
  if is_dry_run; then
    printf 'DRY_RUN: cp %s %s\n' "$backup_src" "$backup_dest"
  else
    cp "$backup_src" "$backup_dest"
  fi
}

install_file() {
  if [ "${TEMPERANCE_PRESERVE_EXISTING:-0}" = 1 ]; then preserve_bootstrap copy "$1" "$2"; return; fi
  install_src="$1"
  install_dest="$2"
  ensure_dir "$(dirname "$install_dest")"
  backup_file "$install_dest"
  if is_dry_run; then
    printf 'DRY_RUN: cp %s %s\n' "$install_src" "$install_dest"
  else
    cp "$install_src" "$install_dest"
  fi
}

# is_live_operator_surface: true if $1 already exists, looks like a real,
# in-use operator instruction file (a temperance identity block, or PAI
# doctrine content), AND is not simply what we ourselves would install at
# $2 (our own template). That last check keeps a plain re-install of our
# own generic template (which itself references PAI vocabulary such as
# NOESIS) from being mistaken for a user's live operator surface -- it
# only guards content that differs from our template, i.e. content we did
# not just produce.
is_live_operator_surface() {
  live_target="$1"
  live_src="$2"
  test -f "$live_target" || return 1
  if test -f "$live_src" && cmp -s "$live_target" "$live_src"; then
    return 1
  fi
  grep -qF 'temperance:identity' "$live_target" 2>/dev/null && return 0
  grep -qF 'PAI 4.0.3' "$live_target" 2>/dev/null && return 0
  grep -qF 'Personal AI Infrastructure' "$live_target" 2>/dev/null && return 0
  grep -qF 'NOESIS' "$live_target" 2>/dev/null && return 0
  return 1
}

# install_operator_file: like install_file, but skips (with a warning)
# writing over an existing live operator surface unless TEMPERANCE_FORCE=1.
install_operator_file() {
  if [ "${TEMPERANCE_PRESERVE_EXISTING:-0}" = 1 ]; then install_file "$1" "$2"; return; fi
  op_src="$1"
  op_dest="$2"
  if test "${TEMPERANCE_FORCE:-0}" != "1" && is_live_operator_surface "$op_dest" "$op_src"; then
    say "WARNING: skipping $op_dest (looks like a live operator file; pass --force to overwrite)"
    return 0
  fi
  install_file "$op_src" "$op_dest"
}

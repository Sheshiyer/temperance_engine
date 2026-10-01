#!/bin/bash
# Trusted bootstrap verifier. Requires stock macOS Perl (Digest::SHA,
# File::Path, Fcntl), gzip and shasum; no Git, Bun, Node or Python.
# Only bounded POSIX ustar is admitted. PAX/GNU extension headers are refused.
set -euo pipefail
ARCHIVE= EXPECTED_DIGEST= EXTRACT_TO=
refuse() { printf 'VERIFY_REFUSE: %s\n' "$*" >&2; exit 1; }
while [ $# -gt 0 ]; do
  case "$1" in
    --archive|--expected-digest|--extract-to)
      key="$1"; shift; [ $# -gt 0 ] || refuse "missing value for $key"
      case "$key" in --archive) ARCHIVE="$1";; --expected-digest) EXPECTED_DIGEST="$1";; --extract-to) EXTRACT_TO="$1";; esac ;;
    *) refuse "Usage: $0 --archive FILE --expected-digest sha256:HEX [--extract-to ABSENT_DIR]" ;;
  esac
  shift
done
for tool in /usr/bin/perl /usr/bin/gzip /usr/bin/shasum; do
  [ -x "$tool" ] || refuse "MISSING_PREREQ: $tool unavailable; bootstrap HOLD"
done
/usr/bin/perl -MDigest::SHA -MFile::Path -MFcntl -e 1 || refuse 'MISSING_PREREQ: Perl core modules unavailable; bootstrap HOLD'
[ -n "$EXPECTED_DIGEST" ] || refuse 'MISSING_DIGEST: supply an independent operator/channel digest'
[[ "$EXPECTED_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || refuse 'BAD_DIGEST_GRAMMAR'
[ -f "$ARCHIVE" ] && [ ! -L "$ARCHIVE" ] || refuse 'ARCHIVE_NOT_FOUND: regular non-link archive required'
BASE=${ARCHIVE##*/}
[[ "$BASE" =~ ^temperance-engine-[A-Za-z0-9][A-Za-z0-9._-]*-arm64.tar.gz$ ]] && [[ "$BASE" != *..* ]] || refuse 'BAD_ARCHIVE_NAME'
if [ -n "$EXTRACT_TO" ]; then
  [ ! -e "$EXTRACT_TO" ] && [ ! -L "$EXTRACT_TO" ] || refuse 'UNSAFE_OUTPUT: exact destination must be absent (even an empty directory is refused)'
  [ -d "$(dirname -- "$EXTRACT_TO")" ] || refuse 'UNSAFE_OUTPUT: destination parent must already exist'
fi
# Snapshot before hashing avoids subsequent archive replacement changing parsing.
# The copy and all extracted bytes live in a newly owned mode-0700 directory.
umask 077
STAGE=$(mktemp -d "${TMPDIR:-/tmp}/te-kit-verify.XXXXXX")
PUBLISHED=0
PUBLISHED_ID=
cleanup() {
  rm -rf "$STAGE"
  if [ "$PUBLISHED" = 1 ]; then
    current_id=$(/usr/bin/perl -e 'my @s=lstat $ARGV[0]; @s && -d _ && !-l _ or exit 1; print "$s[0]:$s[1]"' "$EXTRACT_TO" 2>/dev/null || true)
    if [ -n "$PUBLISHED_ID" ] && [ "$current_id" = "$PUBLISHED_ID" ]; then rm -rf "$EXTRACT_TO";
    else printf 'VERIFY_HOLD: publication directory changed; preserved for owner review\n' >&2; fi
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
/usr/bin/perl -e 'my $n=-s $ARGV[0]; defined($n) && $n>0 && $n<=500*1024*1024 or die "BOUNDS: compressed archive size\n"' "$ARCHIVE" || refuse 'BOUNDS'
cp "$ARCHIVE" "$STAGE/archive.gz"
ACTUAL_SHA=$(/usr/bin/shasum -a 256 "$STAGE/archive.gz"); ACTUAL_SHA=${ACTUAL_SHA%% *}
[ "$EXPECTED_DIGEST" = "sha256:$ACTUAL_SHA" ] || refuse 'OUTER_DIGEST_MISMATCH: no payload extracted'
# The first streaming pass validates every raw header and hashes members before
# any extraction. The second pass uses the SAME parser over the private copy.
/usr/bin/perl - "$STAGE/archive.gz" "$STAGE/payload" <<'PERL'
use strict; use warnings;
use Digest::SHA qw(sha256_hex); use File::Path qw(make_path); use Fcntl qw(:DEFAULT);
my ($archive,$root)=@ARGV;
sub refuse { die "VERIFY_REFUSE: $_[0]\n" }
sub textfield {
  my ($v)=@_; $v =~ /\A([^\0]*)(\0*)\z/s or refuse('MALFORMED_TAR: nonzero string padding'); return $1;
}
sub octal {
  my ($v)=@_; $v =~ /\A[ ]*([0-7]+)[\0 ]*\z/ or refuse('MALFORMED_TAR: non-octal number'); return oct($1);
}
sub path {
  my ($n,$dir)=@_;
  $n =~ s{\A\./}{}; $n =~ s{/$}{} if $dir;
  return '' if $dir && $n eq '';
  length($n)<=255 && $n =~ m{\A[A-Za-z0-9@+_.-]+(?:/[A-Za-z0-9@+_.-]+)*\z}
    or refuse('UNSAFE_PATH: member grammar');
  for (split m{/},$n) { $_ ne '.' && $_ ne '..' or refuse('UNSAFE_PATH: traversal or alias') }
  $n !~ /\.command$/ or refuse('UNSAFE_EXT: command');
  if ($n =~ /\.(?:dylib|node|so)(?:\.[0-9]+)*$/) {
    $n =~ m{\Apackage/install-surface/node_modules/} or refuse('UNSAFE_EXT: native outside vendor');
  }
  return $n;
}
my (%hashes,$manifest,$count,$total);
for my $extract (0,1) {
  open my $in,'-|','/usr/bin/gzip','-dc','--',$archive or refuse('MALFORMED_TAR: gzip'); binmode $in;
  my ($wire,$members,$bytes)=(0,0,0); my %seen;
  my $read = sub {
    my ($n)=@_; my $buf='';
    while (length($buf)<$n) {
      my $r=read($in,my $part,$n-length($buf));
      defined($r) && $r>0 or refuse('MALFORMED_TAR: truncated block'); $buf.=$part;
    }
    $wire+=$n; $wire<=440*1024*1024 or refuse('BOUNDS: decompressed wire bytes'); return $buf;
  };
  while (1) {
    my $h=$read->(512);
    if ($h eq "\0"x512) {
      $read->(512) eq "\0"x512 or refuse('MALFORMED_TAR: missing second end block');
      # Permit bounded zero record padding only; reject concatenated archives.
      my $tail=0;
      while (1) { my $n=read($in,my $b,512); defined($n) or refuse('MALFORMED_TAR: read'); last unless $n;
        $tail+=$n; $tail<=65536 && $b eq "\0"x$n or refuse('MALFORMED_TAR: trailing data/padding bounds'); }
      close($in) or refuse('MALFORMED_TAR: gzip checksum/truncation'); last;
    }
    ++$members<=20000 or refuse('BOUNDS: member count');
    substr($h,257,8) eq "ustar\00000" or refuse('MALFORMED_TAR: POSIX ustar required; no GNU/PAX');
    my $sum=octal(substr($h,148,8)); my $hc=$h; substr($hc,148,8)=' 'x8;
    unpack('%32C*',$hc)==$sum or refuse('MALFORMED_TAR: header checksum');
    my $type=substr($h,156,1); ($type eq '0'||$type eq "\0"||$type eq '5') or refuse('UNSAFE_ENTRY: links/extensions/special type');
    textfield(substr($h,157,100)) eq '' or refuse('UNSAFE_ENTRY: linkname');
    substr($h,500,12) eq "\0"x12 or refuse('MALFORMED_TAR: header padding');
    my $mode=octal(substr($h,100,8)); octal(substr($h,108,8)); octal(substr($h,116,8)); octal(substr($h,136,12));
    # Device fields in regular ustar headers may be empty or octal zero.
    for my $off (329,337) { my $d=substr($h,$off,8); $d =~ /\A[\0 ]*\z/ || octal($d)==0 or refuse('UNSAFE_ENTRY: device'); }
    textfield(substr($h,265,32)); textfield(substr($h,297,32));
    my $sz=octal(substr($h,124,12)); $sz<=200*1024*1024 or refuse('BOUNDS: member size');
    $bytes+=$sz; $bytes<=400*1024*1024 or refuse('BOUNDS: aggregate size');
    my $dir=$type eq '5'; !$dir || $sz==0 or refuse('MALFORMED_TAR: directory data');
    my $n=textfield(substr($h,0,100)); my $p=textfield(substr($h,345,155)); $n="$p/$n" if length $p;
    $n=path($n,$dir); exists($seen{$n}) and refuse('DUPLICATE_ENTRY'); $seen{$n}=$dir?'d':'f';
    if ($n eq 'INNER-MANIFEST.sha256') { !$dir && $sz<=4*1024*1024 or refuse('BAD_MANIFEST: bounds/type') }
    if ($extract && $dir) { make_path("$root/$n",{mode=>0755}) }
    my ($fh,$sha,$body); $sha=Digest::SHA->new(256); $body='';
    if ($extract && !$dir) {
      my $parent="$root/$n"; $parent =~ s{/[^/]+$}{}; make_path($parent,{mode=>0755});
      sysopen($fh,"$root/$n",O_WRONLY|O_CREAT|O_EXCL,($mode&0111)?0755:0644) or refuse('UNSAFE_ENTRY: extraction conflict'); binmode $fh;
    }
    my $remaining=$sz;
    while ($remaining) { my $buf=$read->($remaining>65536?65536:$remaining); $remaining-=length($buf);
      $sha->add($buf); $body.=$buf if !$extract && $n eq 'INNER-MANIFEST.sha256';
      print {$fh} $buf or refuse('EXTRACT_WRITE') if $extract && !$dir;
    }
    close($fh) or refuse('EXTRACT_WRITE') if $extract && !$dir;
    if (!$extract && !$dir) { $hashes{$n}=$sha->hexdigest; $manifest=$body if $n eq 'INNER-MANIFEST.sha256' }
    my $pad=(512-$sz%512)%512; !$pad || $read->($pad) eq "\0"x$pad or refuse('MALFORMED_TAR: nonzero member padding');
  }
  # Refuse regular ancestors regardless of member ordering before extraction.
  for my $n (keys %seen) { my $p=$n; while ($p =~ s{/[^/]+$}{}) { (!exists($seen{$p})||$seen{$p} eq 'd') or refuse('UNSAFE_PATH: file ancestor') } }
  if (!$extract) {
    defined($manifest) or refuse('MISSING_MANIFEST'); my %listed;
    my @lines=split /\n/,$manifest,-1; pop @lines if @lines && $lines[-1] eq '';
    for my $line (@lines) {
      $line =~ /\A([0-9a-f]{64})  (.+)\z/ or refuse('BAD_MANIFEST'); my ($sha,$raw)=($1,$2); my $n=path($raw,0);
      $raw eq $n && $n ne 'INNER-MANIFEST.sha256' or refuse('BAD_MANIFEST: noncanonical/self path');
      !$listed{$n}++ or refuse('DUPLICATE_MANIFEST_ENTRY'); exists($hashes{$n}) or refuse('MISSING_MEMBER');
      $hashes{$n} eq $sha or refuse('INNER checksum mismatch');
    }
    $manifest !~ /\n\n/ && $manifest =~ /\n\z/ or refuse('BAD_MANIFEST: canonical lines required');
    for my $n (keys %hashes) { $n eq 'INNER-MANIFEST.sha256' || $listed{$n} or refuse('UNLISTED member') }
    ($count,$total)=($members,$bytes); make_path($root,{mode=>0700});
    print "ok: raw ustar and inner manifest verified ($count members, $total uncompressed bytes)\n";
  }
}
print "ok: private staging complete\n";
PERL
# Publish only verified contents. mkdir reserves the ABSENT exact destination
# atomically; failure removes only the directory this invocation created.
if [ -n "$EXTRACT_TO" ]; then
  mkdir -m 0700 -- "$EXTRACT_TO" || refuse 'UNSAFE_OUTPUT: destination became occupied'
  PUBLISHED_ID=$(/usr/bin/perl -e 'my @s=lstat $ARGV[0]; @s && -d _ && !-l _ or die "publish directory lost"; print "$s[0]:$s[1]"' "$EXTRACT_TO")
  PUBLISHED=1
  /usr/bin/perl - "$STAGE/payload" "$EXTRACT_TO" <<'PUBLISH'
use strict; use warnings; use Fcntl qw(:DEFAULT);
my ($from,$to)=@ARGV;
sub copy_tree {
  my ($src,$dst)=@_; opendir(my $dh,$src) or die "read stage: $!";
  for my $name (grep {$_ ne '.' && $_ ne '..'} readdir $dh) {
    my ($s,$d)=("$src/$name","$dst/$name"); my @st=lstat $s;
    if(-d _) {mkdir($d,0755) or die "publish directory occupied: $!"; copy_tree($s,$d);}
    elsif(-f _) {
      open(my $in,'<',$s) or die "read: $!"; binmode $in;
      sysopen(my $out,$d,O_WRONLY|O_CREAT|O_EXCL,($st[2]&0111)?0755:0644) or die "publish member occupied: $!"; binmode $out;
      while(1){my $n=read($in,my $b,65536);defined($n) or die "read: $!";last unless $n;print {$out} $b or die "write: $!";}
      close $out or die "close: $!"; close $in;
    } else {die "stage type changed";}
  }
  closedir $dh;
}
copy_tree($from,$to);
PUBLISH
  PUBLISHED=0
  printf 'Verified payload published: %s\n' "$EXTRACT_TO"
fi

printf 'verify-migration-kit: PASSED\n'

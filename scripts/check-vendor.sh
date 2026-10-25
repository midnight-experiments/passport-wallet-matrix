#!/usr/bin/env bash
# Check vendor/passport against the per-file SHA-256 list in vendor/passport/PROVENANCE.md.
#
# Every listed file must exist with its recorded hash, and every file under vendor/passport must be
# listed, apart from PROVENANCE.md itself and generated or installed trees (contracts/managed/,
# node_modules/, dist/). A changed, missing or unlisted file fails the check.
#
# The list is the fenced block that follows the line `<!-- sha256sum -->` in PROVENANCE.md, in
# `sha256sum` format with paths relative to vendor/passport.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
V="$ROOT/vendor/passport"
P="$V/PROVENANCE.md"
[[ -f "$P" ]] || {
  echo "check-vendor: $P is missing" >&2
  exit 66
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
awk '/^<!-- sha256sum -->$/ {armed=1; next}
     armed && /^```/ {if (inblock) exit; inblock=1; next}
     inblock {print}' "$P" >"$tmp/list"
[[ -s "$tmp/list" ]] || {
  echo "check-vendor: no sha256sum block in $P" >&2
  exit 65
}
if grep -vqE '^[0-9a-f]{64}  [^ ].*$' "$tmp/list"; then
  echo "check-vendor: malformed lines in the sha256sum block:" >&2
  grep -vE '^[0-9a-f]{64}  [^ ].*$' "$tmp/list" >&2
  exit 65
fi

if command -v sha256sum >/dev/null; then
  (cd "$V" && sha256sum --quiet -c "$tmp/list")
else
  (cd "$V" && shasum -a 256 --quiet -c "$tmp/list")
fi

cut -c67- "$tmp/list" | LC_ALL=C sort >"$tmp/listed"
(cd "$V" && find . -type f \
  -not -path './PROVENANCE.md' \
  -not -path '*/contracts/managed/*' \
  -not -path '*/node_modules/*' \
  -not -path '*/dist/*' \
  -not -name '.DS_Store' | sed 's#^\./##' | LC_ALL=C sort) >"$tmp/present"
if ! diff -u "$tmp/listed" "$tmp/present" >"$tmp/diff"; then
  echo "check-vendor: the files under vendor/passport differ from the list ('-' listed only, '+' present only):" >&2
  tail -n +3 "$tmp/diff" | grep -E '^[-+]' >&2
  exit 65
fi
echo "check-vendor: $(wc -l <"$tmp/listed" | tr -d ' ') files match PROVENANCE.md" >&2

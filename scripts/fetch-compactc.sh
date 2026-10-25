#!/usr/bin/env bash
# Install the pinned Compact compiler, compactc 0.35.0, into .tools/compactc-0.35.0/.
#
# The Passport account needs 0.35.0: its Ed25519 arm uses that release's standard library
# (`ed25519Verify`, `sha512`, the Curve25519 types), and every circuit is compiled to ZKIR v3
# (`--feature-zkir-v3`). The release archive also carries `zkir-v3`, used for `mock-compile`.
#
# The archive is downloaded from the official release (LFDT-Minokawa/compact, tag compactc-v0.35.0,
# commit debb05f9414b9d1e176741c2be289bb32233f0fc, published 2026-09-29) and checked against the
# SHA-256 pinned below before it is unpacked. The release publishes no checksum file: the pins are
# GitHub's per-asset sha256 digests, each re-checked against a download. The unpacked compiler's
# `--version` line must then be the pinned one.
#
# Environment:
#   COMPACTC_ZIP=<path>   use an archive already on disk (checked the same way) instead of downloading
#   COMPACTC_DIR=<dir>    install somewhere other than .tools/compactc-0.35.0
#
# Prints the compactc path on stdout; everything else goes to stderr.
set -euo pipefail

VERSION="0.35.0"
VERSION_LINE="0.35.0 (debb05f94 2026-09-29)"
BASE_URL="https://github.com/LFDT-Minokawa/compact/releases/download/compactc-v${VERSION}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${COMPACTC_DIR:-$ROOT/.tools/compactc-$VERSION}"
PLATFORM="$(uname -s)-$(uname -m)"

case "$PLATFORM" in
  Linux-x86_64) ASSET="compactc_v${VERSION}_x86_64-unknown-linux-musl.zip"
    SHA=70f22fb8209cc5a8504b2b3d91796cfdab2d71d88807ceef12fab87fed03bae2 ;;
  Linux-aarch64 | Linux-arm64) ASSET="compactc_v${VERSION}_aarch64-unknown-linux-musl.zip"
    SHA=3f74ec6fc98ccca7365c5c915f6015d8893db4527faafe04a90bc36effc40a3a ;;
  Darwin-arm64) ASSET="compactc_v${VERSION}_aarch64-darwin.zip"
    SHA=5898b3d916b2b26f2c110b55a4a4121c22c88eefbd076994e8c3dd3e56c571fc ;;
  Darwin-x86_64) ASSET="compactc_v${VERSION}_x86_64-darwin.zip"
    SHA=adfd3738965d758897d8038b86a5c32e5bd20fb437fc0f1cbc01c8d816b0e212 ;;
  *)
    echo "fetch-compactc: no pinned compactc $VERSION archive for $PLATFORM" >&2
    exit 64 ;;
esac

if [[ -x "$DEST/compactc" ]] && [[ "$("$DEST/compactc" --version 2>/dev/null)" == "$VERSION_LINE" ]] &&
  [[ "$(cat "$DEST/.archive-sha256" 2>/dev/null)" == "$SHA" ]]; then
  echo "$DEST/compactc"
  exit 0
fi

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
zip="$tmp/$ASSET"
if [[ -n "${COMPACTC_ZIP:-}" ]]; then
  cp "$COMPACTC_ZIP" "$zip"
else
  echo "fetch-compactc: downloading $ASSET" >&2
  curl -fsSL --retry 3 -o "$zip" "$BASE_URL/$ASSET"
fi
got="$(sha256 "$zip")"
if [[ "$got" != "$SHA" ]]; then
  echo "fetch-compactc: SHA-256 mismatch for $ASSET: expected $SHA, got $got" >&2
  exit 65
fi

# Unpack beside the destination and move into place only once the version line checks out, so an
# interrupted install never leaves a half-unpacked compiler that a later run would accept.
stage="$tmp/unpacked"
mkdir -p "$stage"
if command -v unzip >/dev/null; then
  unzip -o -q "$zip" -d "$stage"
else
  python3 -I -c 'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$zip" "$stage"
fi
chmod +x "$stage"/compactc "$stage"/compactc.bin "$stage"/zkir "$stage"/zkir-v3 2>/dev/null || true
got_line="$("$stage/compactc" --version)"
if [[ "$got_line" != "$VERSION_LINE" ]]; then
  echo "fetch-compactc: compactc --version is '$got_line', expected '$VERSION_LINE'" >&2
  exit 65
fi
[[ -x "$stage/zkir-v3" ]] || {
  echo "fetch-compactc: the archive holds no zkir-v3" >&2
  exit 65
}
echo "$SHA" >"$stage/.archive-sha256"
rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
mv "$stage" "$DEST"
echo "fetch-compactc: compactc $VERSION verified ($SHA) in $DEST" >&2
echo "$DEST/compactc"

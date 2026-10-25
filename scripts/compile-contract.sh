#!/usr/bin/env bash
# Compile the vendored Passport account contract with the pinned compiler (compactc 0.35.0,
# `--feature-zkir-v3`).
#
#   scripts/compile-contract.sh [--keys] [NAME]
#
#   (default)  `--skip-zk`: the contract's JavaScript, type declarations and ZKIR, no keys.
#              Enough for the client (it imports the generated module) and for `zkir-v3
#              mock-compile`, which gives each circuit's rows and k.
#   --keys     the full build: also every circuit's prover and verifier key and binary ZKIR. For
#              all 84 circuits of the account this takes about half an hour and 9 GB of memory on
#              a 16-core Apple M4 Max, and writes about 23 GiB of keys. The key-set manifest
#              (keyset/manifest.json) is made from such a build.
#
# The output goes to vendor/passport/contract/contracts/managed/NAME (NAME defaults to `account`,
# the path the client sources import the generated module from). It is replaced, never merged
# into, so no file of an earlier build survives. Build output and keys stay out of git.
#
# The compiler runs in vendor/passport/contract with relative paths, as the upstream `compile`
# script does: compactc writes the source paths it was given into the generated JavaScript
# (assertion messages, the source map). Relative paths keep the build host's directories out of
# the output and make the output byte-identical to an upstream build of the same sources.
#
# The vendored sources are checked against vendor/passport/PROVENANCE.md first: a build never
# runs on sources that differ from the recorded ones.
#
# Environment: COMPACTC names a compiler already installed (its version line is still checked);
# otherwise scripts/fetch-compactc.sh installs the pinned one.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACT_DIR="$ROOT/vendor/passport/contract"
VERSION_LINE="0.35.0 (debb05f94 2026-09-29)"

MODE="--skip-zk"
if [[ "${1:-}" == "--keys" ]]; then
  MODE=""
  shift
fi
NAME="${1:-account}"
[[ "$NAME" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || {
  echo "compile-contract: NAME must be a plain directory name, got '$NAME'" >&2
  exit 64
}
REL_OUT="contracts/managed/$NAME"
OUT="$CONTRACT_DIR/$REL_OUT"

bash "$ROOT/scripts/check-vendor.sh" >&2

CC="${COMPACTC:-}"
if [[ -z "$CC" ]]; then CC="$(bash "$ROOT/scripts/fetch-compactc.sh")"; fi
# The compiler runs in another directory below, so a relative path must be made absolute first.
case "$CC" in /*) ;; */*) CC="$PWD/$CC" ;; *) CC="$(command -v "$CC")" ;; esac
got_line="$("$CC" --version)"
[[ "$got_line" == "$VERSION_LINE" ]] || {
  echo "compile-contract: compactc '$VERSION_LINE' required, got '$got_line'" >&2
  exit 65
}

rm -rf "$OUT"
mkdir -p "$(dirname "$OUT")"
t0=$SECONDS
# shellcheck disable=SC2086 # MODE is empty for a keyed build
(cd "$CONTRACT_DIR" && "$CC" $MODE --feature-zkir-v3 contracts/account.compact "$REL_OUT")
echo "compile-contract: account ($([[ -n "$MODE" ]] && echo "$MODE" || echo keyed)) in $((SECONDS - t0)) s -> $OUT" >&2

[[ -f "$OUT/contract/index.js" && -f "$OUT/contract/index.d.ts" ]] || {
  echo "compile-contract: $OUT/contract/index.{js,d.ts} missing" >&2
  exit 70
}
if grep -rqF "$ROOT" "$OUT/contract" "$OUT/compiler"; then
  echo "compile-contract: the generated module contains this host's path $ROOT" >&2
  exit 70
fi
n_zkir="$(find "$OUT/zkir" -name '*.zkir' | wc -l | tr -d ' ')"
if [[ -n "$MODE" ]]; then
  if find "$OUT" -name '*.prover' | grep -q .; then
    echo "compile-contract: a --skip-zk build produced prover keys" >&2
    exit 70
  fi
else
  n_prover="$(find "$OUT/keys" -name '*.prover' | wc -l | tr -d ' ')"
  n_verifier="$(find "$OUT/keys" -name '*.verifier' | wc -l | tr -d ' ')"
  [[ "$n_prover" == "$n_zkir" && "$n_verifier" == "$n_zkir" ]] || {
    echo "compile-contract: $n_zkir circuits but $n_prover prover and $n_verifier verifier keys" >&2
    exit 70
  }
fi
echo "compile-contract: $n_zkir circuits" >&2

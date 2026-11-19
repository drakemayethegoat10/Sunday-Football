#!/usr/bin/env bash
# Build the Rust core to WebAssembly and generate JS bindings into web/src/wasm.
# Usage: scripts/build-wasm.sh [--dev]
set -euo pipefail
cd "$(dirname "$0")/.."

PROFILE=release
FLAG=--release
if [[ "${1:-}" == "--dev" ]]; then PROFILE=debug; FLAG=; fi

# The wasm-bindgen CLI must match the crate version in Cargo.lock exactly.
WANT=$(awk '/^name = "wasm-bindgen"$/{getline; gsub(/version = |"/,""); print; exit}' Cargo.lock 2>/dev/null || true)
HAVE=$(wasm-bindgen --version 2>/dev/null | awk '{print $2}' || true)
if [[ -n "$WANT" && "$WANT" != "$HAVE" ]]; then
  echo "wasm-bindgen CLI is '${HAVE:-missing}' but Cargo.lock wants '$WANT'."
  echo "Install it with: cargo install wasm-bindgen-cli --version $WANT --locked"
  exit 1
fi

cargo build -p sf-wasm --target wasm32-unknown-unknown $FLAG
wasm-bindgen "target/wasm32-unknown-unknown/$PROFILE/sf_wasm.wasm" --out-dir web/src/wasm --target web
ls -la web/src/wasm/*.wasm

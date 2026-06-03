#!/usr/bin/env bash
# build-sidecars.sh — Build sidecar binaries before `tauri build`.
#
# On macOS: builds 2 Rust sidecars + 2 Swift sidecars.
# On Linux: builds only the 2 Rust sidecars (no Swift).
#
# Run from the repository root.
# Usage:
#   bash scripts/build-sidecars.sh
#
# The compiled binaries are placed in src-tauri/target/release/ which is
# where tauri.conf.json `bundle.resources` expects to find them.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[build-sidecars] Building Rust sidecars (mdopen + mdopener-mcp)..."
cargo build --release \
  --manifest-path "$REPO_ROOT/src-tauri/Cargo.toml" \
  -p mdopen \
  -p mdopener-mcp

if [[ "$(uname -s)" == "Darwin" ]]; then
  echo "[build-sidecars] macOS detected — building Swift sidecars..."

  echo "[build-sidecars] Building mdopener-afm..."
  bash "$REPO_ROOT/src-tauri/bins/mdopener-afm/build.sh"

  echo "[build-sidecars] Building mdopener-setdefault..."
  bash "$REPO_ROOT/src-tauri/bins/mdopener-setdefault/build.sh"

  echo "[build-sidecars] All 4 sidecars built successfully."
else
  echo "[build-sidecars] Non-macOS detected — skipping Swift sidecars."
  echo "[build-sidecars] 2 Rust sidecars built successfully."
fi

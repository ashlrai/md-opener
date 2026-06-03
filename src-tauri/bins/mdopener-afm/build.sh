#!/usr/bin/env bash
# build.sh — build the mdopener-afm Swift sidecar and copy it into place.
#
# Run this from the repo root OR from src-tauri/bins/mdopener-afm/.
# Must be built with Xcode 26 / Swift 6.2+ (macOS 26 SDK).
#
# Usage:
#   cd src-tauri/bins/mdopener-afm
#   ./build.sh
#
# The compiled binary is placed at:
#   src-tauri/target/release/mdopener-afm
# which is where afm.rs looks for it in dev mode.
#
# For tauri build (production), bundle the binary as an externalBin or sidecar
# resource — see integration notes in afm.rs and the INTEGRATION section in
# the project readme.

set -euo pipefail

# Resolve paths regardless of where the script is called from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TARGET_DIR="$REPO_ROOT/src-tauri/target/release"

echo "[mdopener-afm] Building Swift sidecar..."
echo "  Package: $SCRIPT_DIR"
echo "  Output:  $TARGET_DIR/mdopener-afm"

cd "$SCRIPT_DIR"
swift build -c release 2>&1

BUILT_BIN="$SCRIPT_DIR/.build/release/mdopener-afm"
if [ ! -f "$BUILT_BIN" ]; then
    echo "[mdopener-afm] ERROR: expected binary not found at $BUILT_BIN" >&2
    exit 1
fi

mkdir -p "$TARGET_DIR"
cp "$BUILT_BIN" "$TARGET_DIR/mdopener-afm"
echo "[mdopener-afm] Done -> $TARGET_DIR/mdopener-afm"

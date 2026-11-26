#!/bin/sh
set -eu
cd "$(dirname "$0")"
test "${FOX_PUBLIC_PREVIEW:-}" = render-public-v1
: "${FOX_PUBLIC_GODOT_BIN:?Set verified Godot 4.7.2 Linux executable}"
export FOX_PUBLIC_AUTHORITY_PACK="$PWD/public-authority.pck" FOX_WEB_EXPORT="$PWD/public-export"
runtime="$(mktemp -d)"
export FOX_PUBLIC_RUNTIME_DATA="$runtime"
pid=""
cleanup() { if [ -n "$pid" ]; then kill -TERM "$pid" 2>/dev/null || :; wait "$pid" || :; fi; rm -rf -- "$runtime"; }
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
node service/server/main.mjs &
pid=$!
wait "$pid"

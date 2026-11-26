#!/bin/sh
set -eu
cd "$(dirname "$0")"
: "${FOX_PUBLIC_GODOT_BIN:?Set verified Godot 4.7.2 Linux executable}"
test "$(node --version)" = v24.22.3
test "$(sha256sum "$FOX_PUBLIC_GODOT_BIN" |cut -d ' ' -f1)" = 8d106cbe6144c2dc7e881d61d2429c1a8a76e6b22ef48bd5e48dcf934953f71e
case "$FOX_PUBLIC_GODOT_BIN" in /*) ;; *) exit 78;; esac
sha256sum --quiet -c RELEASE-FILES.sha256
test ! -e service/node_modules/ws
mkdir -p service/node_modules/ws
tar -xz --strip-components=1 -f vendor/ws-8.21.0.tgz -C service/node_modules/ws
sha256sum --quiet -c ws-pins.sha256
cmp service/node_modules/ws/LICENSE vendor/ws-LICENSE.txt
for f in service/server/*.mjs service/web/classroom.mjs; do node --check "$f"; done
node --input-type=module -e "import {loadPublicRelease} from './service/server/public-preview.mjs';import {resolve} from 'node:path';await loadPublicRelease('public-export',resolve('public-authority.pck'),process.env.FOX_PUBLIC_GODOT_BIN);"

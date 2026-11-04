# Historical woodland-v3 authoring record

This document describes the recoverable woodland-v3 checkpoint only. References below to current models, editable sources, manifests and previews refer to that historical checkpoint. The present files use the animated woodland-v4 source described in [WOODLAND-V4-ANIMATED.md](WOODLAND-V4-ANIMATED.md).

Original project-authored geometry and materials, based on native source `1a6eeeed9c6134a0421a7536b53a12e4153bbd9a`. The refinement is integrated into development source and has not been deployed. It is not a browser/device acceptance result. Authoring used no third-party geometry, images, textures, add-ons, software installs or new dependencies.

## What changed

- Fox: rebuilt tapered athletic torso; connected angular cream cheek mask instead of bead-like tufts; fuller tapered snout; inset larger eyes with cream expression spots; small swept crown tufts; bent hind hocks and broader paws; lower, laterally curved brush tail and sculpted tip; warmer woodland fur.
- Rabbit: more substantial haunches/chest, longer rear paws and articulated hock profile; a curled asymmetric right ear; rounder split muzzle, smaller rose nose, repositioned eyes, expression spots and crown tufts. Topology was reallocated from haunch/ear rings to the face instead of increasing the existing triangle ceiling.
- Angel: longer ascending rounded flight-feather fan, narrower coverts and slender curved shoulder. Warm ivory feathers and softly metallic antique-gold trim.
- Rainbow parakeet: longer, narrow pointed outer primaries and stronger tropical fan, green coverts and saturated six-colour flight feathers. Its silhouette differs from the fuller angel fan. All eight per-hinge material regions remain compatible with existing runtime batching.
- Devil: rebuilt high-shoulder swept outline and deep crescent web scallops, with matching finger/arm geometry. Compact dark-cherry membranes and dark bones differ from the broader dragon.
- Dragon: broader swept shoulder and outer web, raised finger tips, re-curved claws/crests and warmer metallic gold spars against matte green membranes.
- Elephant: full rounded lobes, matching spline-smoothed inner-ear insets and a rolled rim; softer matte response. Original generic ear-shaped cosmetic, no character likeness.
- Glow: reshaped detached crystal blades, wider middle shards, separated outer beacons and emissive surface response. This remains standard PBR emission, not bloom, particles or trails.

## Stable interface and matched source

`revision: woodland-v2` is deliberately retained as the rigid-batching interface tag. New `refinement: woodland-v3` and Blender scene `authoring_revision: woodland-v3-20261104` identify the new artwork. Root/pivot/socket local transforms and all named clip tracks, times and values are exactly equal after installed Three r180 loading to the shipping v2 baseline. No runtime code changes are needed.

The eight editable `.blend` files now match the current generator and shipping GLBs. Previously checked-in `.blend` files and contact sheets depicted original v1, while shipping files were v2. This candidate repairs that mismatch. The original `generate_assets.py` and `hash-manifest.json` remain historical provenance for v1. The current generator is `generate_refined_assets.py`; current model hashes/costs are `refined-manifest.json`; `delivery-manifest.json` covers current editable files and contact sheets too.

## Reproduce and validate

Run from the repository root with the existing installed tools:

    blender -b -noaudio --python assets/appearance-source/generate_refined_assets.py -- /tmp/woodland-a
    blender -b -noaudio --python assets/appearance-source/generate_refined_assets.py -- /tmp/woodland-b
    node assets/appearance-source/validate_loader.mjs /tmp/woodland-a
    blender -b -noaudio --python assets/appearance-source/render_previews.py -- /tmp/woodland-a
    blender -b -noaudio --python assets/appearance-source/render_attached_previews.py -- /tmp/woodland-a
    node --experimental-strip-types --test tests/*.test.mjs
    node --test server/test/*.test.mjs
    npm run build:static

Two final isolated exports were byte-identical across all eight GLBs; Blender containers are not asserted byte-deterministic. Actual Blender Cycles CPU 24-sample renders were inspected for all eight assets, all three wing phases, both animal sides, and all 12 attached animal/style combinations open and folded. The preview scripts produce individual renders. The separately assembled inspected contact sheets are `avatars-contact-sheet.png`, `wings-contact-sheet.png`, and `attached-contact-sheet.png`; assembling those sheets is not automated by the commands above. Render grain is preview sampling, not a texture defect. These are standalone asset renders, not game screenshots.

## Cost and verification boundaries

Raw draw calls and material counts are unchanged. Existing cache-time batching still preserves the surface/animation and yields 13 fox or 9 rabbit body draws; 2 parakeet or 6 other wing draws. The worst active avatar still uses 20 draws including its team marker; eight worst-draw avatars still use 160. Maximum measured triangle cost including a team marker drops from 4,670 to 4,662, within the unchanged 4,670 cap. The cost test now correctly distinguishes a cap from the exact measured value. Across all eight raw models: 377,020 → 380,520 bytes (+0.93%), 12,034 → 11,950 triangles (-0.70%), and 7,501 → 7,643 decoded indexed vertices (+1.89%). Material counts are unchanged (six each animal, three most wings, eight parakeet). These separate metrics do not establish a GPU-memory or FPS improvement. No school-laptop FPS improvement is claimed.

At the isolated authoring stage, all 293 game tests and 74 server tests passed. This includes actual installed GLTFLoader import, finite geometry/materials, exact source hashes, self-contained dependencies, named clips, socket/crouch/resource ownership, raw/derived surface equality, every style's first-person near plane and central landing sightline over six aspect ratios, steering/deploy/fold, and identical real ramp/glide simulation traces. Game TypeScript, static Vite build and the relevant same-origin Render build pass. All 16 Render adapter/entrypoint tests pass.

Full hosted Worker build reached a successful game Vite build but cannot finish: the baseline and candidate both lack server/node_modules/vinext/dist/cli.js. Server TypeScript also could not run without the absent server dependencies. No installation was attempted. Ordinary browser menu/play journey, first-person rendered lighting, reduced-motion screenshots, live multiplayer and school-device performance remain untested. 

## Independent integration review

The integrated source passed all 322 game/client tests, 74 server tests, 16 Render adapter/entrypoint tests and the same-origin Render build. These checks include the newer membership lifecycle; the 293-test result above is the earlier isolated authoring run.

Independent review reproduced all eight GLBs both from the generator and saved Blender files, loaded all clips through the installed renderer and inspected attached open/folded and true glide poses. No blocking defect found. Small inherited cosmetic gait ground penetration remains: rabbit approximately 2.79 cm versus 2.41 cm in v2, fox approximately 0.41 cm versus 0.35 cm. These are model-pose measurements, not collision failures. Ordinary in-game, browser and school-device acceptance remain outstanding.

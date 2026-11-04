# Future ordinary-browser graphics and FPS acceptance

NOT EXECUTED. No rendered FPS, visual quality gain, GPU memory number, graphics bottleneck diagnosis or school-device acceptance exists for this new candidate. CPU sampler timings are not FPS. This task does not retry unavailable WebGL using flags, drivers, settings or a restricted alternate route.

Use a permitted ordinary browser on a target school device with working default WebGL2. Record exact tested source commit/dirty state, OS/browser/GPU, viewport, DPR, power state and network conditions. Keep the prior source baseline and this candidate available for identical scenarios. Do not alter graphics quality between comparison runs. Warm up each scenario 30 seconds, then record 60 seconds at least 3 times.

1. Load solo and multiplayer by ordinary navigation, inspect real 3D output. Start/resume with normal pointer capture, move/look/jump/fall/respawn, enter a slide shortcut and perform a glide. Check first-person wing deployment, near-plane and landing sightline for every style.
2. In the character menu preview all five motions for both species, swap rapidly, close/cancel/reopen during loading, and repeat with reduced-motion enabled. Inspect fox trot versus rabbit bound, jumps and landing, paws, body proportions and readability from player distance. Existing v4b art is recovered previous work, not a quality upgrade; skinned-model research/adoption remains open.
3. Join eight real seats with mixed appearances, exercise ready lobby/start, server capture, contested progress, pause/resume, reconnect at capacity, teacher removal, end, and a fresh room. Hidden/paused/reduced-motion presentation must not change authority or move players. Separate local renderer timings from network acceptance.
4. Collect browser Performance traces plus actual renderer.info.render.calls/triangles and renderer.info.memory.geometries/textures before/after repeated entry/model-swap/disposal. Include world and 13 labels; mesh/material estimates are potential submissions before visibility/frustum culling, not measured renderer calls.
5. Solo already has development-only ?profile=1 and window.__skyboundProfile.snapshot()/reset(). Its 600-frame window measures animation-callback intervals, update CPU and synchronous render submission, not GPU completion. It is absent from production. Multiplayer has no equivalent opt-in probe: use browser tools without adding a production console hook as part of this recovery slice.

Proposed acceptance budgets, not measurements: median frame interval <=16.7 ms on intended desktop and p95 <=33.3 ms on the agreed minimum school device, no persistent >100 ms presentation stalls, stable resource counts after repeated dispose/reopen, no context errors or obscured landing sightline. Confirm target hardware and quality with the owner before treating these proposals as pass criteria. Report distributions/traces rather than claiming 60FPS from one sample or structural budgets.

Official version-matched guidance consulted4 November 2026:
- https://github.com/mrdoob/three.js/blob/r180/docs/api/en/renderers/WebGLRenderer.html : renderer.info exposes rendering and resource statistics, with reset semantics to respect across passes.
- https://github.com/mrdoob/three.js/blob/r180/docs/api/en/animation/AnimationMixer.html : mixer actions/root resources have explicit stopping/uncaching lifecycle.
- https://github.com/mrdoob/three.js/blob/r180/manual/en/cleanup.html : geometry/material/texture GPU resources need explicit disposal. A removed Object3D alone is not resource disposal.

The installed node_modules/three implementation is the exact r180 behavior reference for the structural and track-evaluation audit. Current unversioned documentation links redirected to a newer index, so the r180 official repository documents above were used instead.

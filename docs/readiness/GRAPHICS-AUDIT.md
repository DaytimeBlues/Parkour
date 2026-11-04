# Three r180 graphics and animation audit

Read-only structural audit of the recovered runtime and actual regenerated v4b GLBs. No renderer/device measurement, visual quality upgrade or FPS gain is established. The exact installed Three 0.180.0 loader, mixers, batching functions and renderer implementation were inspected and exercised in memory. This is the NEW recovery candidate, not missing original16c.

## Actual loaded assets

| Asset | Meshes | Distinct materials | Triangles | Clips × tracks |
|---|---:|---:|---:|---:|
| Fox |17|1|4036|5 × 51|
| Rabbit |17|1|4008|5 × 51|
| Angel |6|3|1124|3 × 6|
| Devil |6|3|772|3 × 6|
| Dragon |6|3|1172|3 × 6|
| Elephant |6|3|1140|3 × 6|
| Glow |6|3|212|3 × 6|
| Parakeet original |16|8|1124|3 × 6|
| Parakeet multiplayer derived |2|1|1124|unchanged|

All eight shipping GLBs total 727,516 bytes. Zero skins/textures. Rigid-node animation, not skin deformation. Materials are opaque FrontSide MeshStandardMaterial, with vertex colours on animals. Avatar batching's woodland-v2 guard correctly declines both v4 animals. Old 13/9 mesh savings do not apply. Parakeet hinge-preserving material batching still succeeds. Shared materials/geometry do not automatically merge distinct mesh draws.

A red team badge adds one mesh/material and six triangles; blue adds one mesh/material and 12 triangles. Largest combination fox+dragon has 5208 triangles before badge,5214 red/5220 blue. Restored existing structural cap remains 5600 per avatar.

## Potential submissions, before frustum rejection

Per remote avatar: ordinary gliding wings 24, batched-parakeet 20, unbatched-parakeet 34, grounded wings-hidden 18, sliding wings-and-badge-hidden 17. Ordinary gliding entries have five distinct materials, batched parakeet three.

buildFortressArt's structural geometryBudget returns 55 draws,8193 triangles,230 instances,26 geometries,38 materials. It counts hidden objects and both ownership alternatives, and excludes sprites. Visibility rules permit 45–50 world submissions, including five possible zero-length arc submissions.13 sprite labels add 13 submissions/26 triangles, for 58–63 world+label submissions. World+label triangle ceiling with one visible ownership symbol per zone is 8214. Label canvases contain 4,259,840 bytes of RGBA pixels before mipmaps, driver allocation and other overhead; this is not measured GPU memory.

| Multiplayer view | Ordinary wings | Batched parakeet |
|---|---:|---:|
| Player, world+labels+seven gliding peers |226–231|198–203|
| Spectator, world+labels+eight gliding seats |250–255|218–223|

Conservative triangle ceilings including world/labels:44,754 for seven peers,49,974 for eight, allowing the larger blue badge on every peer. Balanced four-red/four-blue eight-seat roster ceiling 49,950.

Multiplayer does NOT mount createWingView. Do not add local first-person wings to these totals. Solo src/main.ts does mount first-person wings with batching disabled, adding 6 ordinary/16 parakeet submissions when visible; its separate course world must not be combined with multiplayer totals.

## Animation CPU operation counts, not timings or FPS

Instrumented recovered animators with actual assets:
- Normal remote pose: two mixer updates, three active-action visits,57 track evaluations and 57 binding-apply visits. Body one selected clip 51 tracks; wings normally one weighted six-track action. Partial 0.85–1 deployment blend evaluates both wing actions,12 wing tracks but six bindings.
- Seven peers:399 evaluations/binding visits,14 mixer updates. Eight:456,16 updates. Reduced motion and sliding currently retain this evaluation count.
- Repeated paused frames still evaluate 51 body tracks per peer:357 for seven/408 for eight. Property bindings can avoid actual writes for unchanged values.
- WingFold is shipped, but runtime folding samples WingOpen backward. Bodies have 20–24 constant tracks per clip (rabbit run 21). Blind removal is unsafe because clip-specific constants establish required poses.
- Animation clips and GPU resources are shared; mixers/actions belong to clones. Only one body clip is active. Normal-wing remote entries contain about 50 Object3D nodes. Matrix traversal, including hidden descendants, is separate work.

Implementation basis: installed AnimationMixer.js 670–701, AnimationAction.js 553–623 and Object3D.js 1126–1160. Existing cache bounds 32 remote entries/eight templates and explicit mixer/template disposal are regression tested. Multiplayer caps DPR at 1.5; scene uses hemisphere/directional lights with no enabled shadow-map passes or postprocessing. Antialiasing remains enabled. No arbitrary DPR/shadow/effect change is justified by absent renderer measurements.

## Concrete next slice, after verified recovery backup only

No optimization below was implemented in this recovery slice.

1. Skip redundant unchanged paused body application. remote-avatar.ts calls bodyAnimation.sample before its paused return, repeating 51 track evaluations. Preserve the logical clock/paused bookkeeping; moving the return blindly can lose it. Regression: repeated paused conflicting flags leave all transforms/scale/badge/wings identical, no redundant mixer work, long-pause resume has no catch-up or fake landing, initial-load-paused/reset/disposal remain correct.
2. Skip redundant folded/static wing sampling. appearance-assets.ts and first-person wing-view.ts still evaluate hidden folded wings. Compare effective deployment/blend/relevant glide phase, ignoring time only when glide weight is zero. Regression: initial folded sample retained; opening/partial blend/closing/reopen exact transforms; reduced-motion changes immediate; invalid clocks/reset/style swap/disposal safe; visible full-deployment glide still animates.
3. Hide zero-progress arcs explicitly. scene.ts uses drawRange 0; r180 WebGLRenderer 1147–1149 rejects negative/infinite counts, not zero. Exercising installed WebGLBufferRenderer with mock GL confirmed drawArrays(LINE_STRIP,0,0), a call increment and WebGLInfo line count−1. Synchronize arc.visible with nonzero progress. Regression: zero invisible/range 0, ±progress visible/right colour/bounded range, return-to-zero hidden, ownership/contested changes do not reveal empty arcs. Could remove up to five empty submissions without changing pixels.

These are evidenced work-avoidance opportunities, not measured FPS problems. Do not merge across joints or reduce geometry without a separate quality-preserving rendered comparison. Better fox/rabbit quality and possible skinned references remain open work.

## Official pinned references

- https://github.com/mrdoob/three.js/blob/r180/docs/api/en/animation/AnimationMixer.html
- https://github.com/mrdoob/three.js/blob/r180/docs/api/en/renderers/WebGLRenderer.html
- https://github.com/mrdoob/three.js/blob/r180/src/animation/AnimationMixer.js#L670-L701
- https://github.com/mrdoob/three.js/blob/r180/src/animation/AnimationAction.js#L553-L623
- https://github.com/mrdoob/three.js/blob/r180/src/renderers/WebGLRenderer.js#L1709-L1818
- https://github.com/mrdoob/three.js/blob/r180/src/renderers/webgl/WebGLBufferRenderer.js#L11-L15

See RENDER-PROFILING-ACCEPTANCE.md for proposed future device scenarios/budgets, explicitly not measured results.

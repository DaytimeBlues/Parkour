# NEW recovery qualification

The original document below was recovered as exact public text. In this candidate shipping GLBs reproduce original v4b bytes, but editable .blend files are regenerated equivalents, not original native containers. Original v4 preview GIF/still evidence and original delivery archive are absent. Root contact sheets are older v3 media. Historical rendering, timing and original-delivery statements below are not current candidate acceptance. See the NEW delivery-manifest.json, docs/readiness/ and recovery-evidence/.

## Preserved original document

# Woodland v4 animated asset candidate

Original project-owned authoring, 2026-11-04. Base source: `49a89f82fc9475e58eda19b9a018b8806db53b49`. This is an isolated art candidate, not user visual acceptance, a deployment, a browser screenshot or measured school-device performance. The v3 generator and provenance remain historical; current v4 authoring is `generate_animated_assets.py` and the eight matching `.blend` files. Preserve the recoverable v3 project checkpoint before integration.

## Substantial changes

- Rebuilt fox and rabbit anatomy and head proportions, with continuous voxel-union torso/neck/haunch sculpting and unified sculpted cream muzzle/cheek masses. Applied smooth/decimate operations remove interior overlapping shells rather than adding invisible triangle cost.
- New two-link articulated front and rear legs, independent counter-rotating paws, tapered overlapping and rounded limb ends, broader shins and longer paw-shaped fox feet. No exposed shoulder/knee ball objects. The small rigid overlap is a deliberate mobile/web tradeoff, not skinned deformation.
- Authored head nod, independent ear flicks, tail motion, breathing, grounded fox trot and rabbit bound, airborne jump tuck, looping glide and landing compression. These are complete named clips with real moving joints, not static poses or a turntable.
- One linear vertex-colour opaque PBR material per animal joins only geometry belonging to the same articulated part. No geometry is merged across a joint. Matte eyes lose a separate gloss draw but retain iris, pupil and catchlight geometry. No texture files, URLs, decoders, skins, armature or shader dependencies.
- Angel has a fuller rounded overlapping feather fan and curved primaries. Parakeet has a narrower pointed tropical fan and a faster two-beat glide. Devil, dragon, elephant and glow retain their intentionally different membrane/ear/crystal families, with style-specific multi-axis glide movement. Webbed styles remain rigid membranes, not cloth simulation. Glow is standard emissive PBR, not bloom or particles.

## Runtime contract

Metres, +Y up, -Z forward. `Avatar` and `Wings` have no animation/root motion. `Avatar` children remain `Body` and `WingSocket`; socket is a fixed root child at local `(0,.85,.35)` with identity rotation/scale. Cosmetic only: no collider or gameplay changes.

Avatar `revision` is `woodland-v4`, `refinement` is `woodland-v4-animated`. Legacy rigid avatar batching must safely reject this expanded rig. Descendants: `Head`, `EarLeft`, `EarRight`, `Tail`, and `FrontLeft`, `FrontRight`, `BackLeft`, `BackRight`, each with its own `Lower` and `Paw` child. Seventeen articulated surface draws, one shared material. Every animal clip has 51 renderer tracks, including constant translation/scale tracks emitted by the installed exporter. Keep these joints, do not bake their meshes into `Body`.

- `AvatarIdle`: 2.0 seconds, loop. Breathing, head, ear, tail and compensating grounded legs.
- `AvatarRun`: 0.7 seconds, loop. Fox: diagonal trot with 60% support/40% swing. Rabbit: paired front/hind bound, half-cycle pair offset, 40% front and 32% hind support, airborne intervals, matched body pitch and ear/head motion.
- `AvatarGlide`: 1.6 seconds, loop. Tucked paws, small body/head/ear/tail movement.
- `AvatarJump`: 0.4 seconds, play once and hold final airborne pose.
- `AvatarLand`: 0.25 seconds, play once then transition to idle/run. Compression and paw contact.

Wing roots and `WingLeft`/`WingRight` hinge positions remain compatible. `WingOpen`/`WingFold`: exactly 1/3 second deployment/inverse. `WingGlide`: 1.6-second true open-wing loop, six tracks on the two hinges. Its start and end exactly match the open endpoint. Slow angel/dragon, quicker parakeet, softer elephant and restrained hovering glow movement share the same runtime interface. Freeze motion for reduced motion, and pause time rather than advancing while paused. The runtime controls state transitions, deployment blending and resource lifetime.

## Grounding and source reproduction

Ground contact is solved in authoring with analytic two-link leg geometry and level paw joints. Paw trajectories include 0.2 mm surface clearance to cover linear interpolation between authored samples. There is no model-root translation to hide penetration, runtime IK or physics workaround. Across 121 complete precise-vertex samples for each of all 28 clips, animal minimum surface height is positive. The closest sample is about 0.024 mm during landing; glide leaves the feet visibly airborne. These measurements are cosmetic model poses, not physics collision validation or arbitrary blended-transition guarantees.

Using installed Blender 4.3.2 and Three r180, from project root:

    blender -b -noaudio --python assets/appearance-source/generate_animated_assets.py -- /tmp/woodland-v4-a
    blender -b -noaudio --python assets/appearance-source/generate_animated_assets.py -- /tmp/woodland-v4-b
    blender -b -noaudio --python assets/appearance-source/reexport_animated_native.py -- /tmp/woodland-v4-a /tmp/woodland-v4-native
    node assets/appearance-source/compare_animated_exports.mjs /tmp/woodland-v4-a /tmp/woodland-v4-b /tmp/woodland-v4-native
    node assets/appearance-source/validate_animated_loader.mjs /tmp/woodland-v4-a

All eight shipping GLBs repeat byte-identically from the generator. All six wing `.blend` files re-export byte-identical GLBs. Saved animal `.blend` re-export has exact geometry/timing/materials/animation schema; Blender native-save/evaluation normalizes a few floating-point transforms, with maximum animation-component difference 2.98e-7 and static TRS difference 5.96e-8. The comparison script verifies geometry/timing exactly and those numeric tolerances explicitly. Native `.blend` containers are editable and hashed, not claimed byte-deterministic.

## Evidence and measured cost

`animated-loader-report.json`: actual installed GLTFLoader, finite geometry/materials, every named clip, exact durations, 121 full-pose samples/clip (3,388 total), loop continuity, fixed socket, no root motion, actual precise bounds and geometry costs. `animated-determinism.json`: independent repeat and native-export comparison. `v4-glb-sha256.txt`, `refined-manifest.json`, `delivery-manifest.json`: complete file hashes and source identity.

Fox: 4,036 triangles / 17 draws / 252,236 bytes. Rabbit: 4,008 / 17 / 250,632. Wings: angel 1,124; parakeet 1,124; devil 772; dragon 1,172; elephant 1,140; glow 212 triangles. All wings six raw draws except parakeet 16; existing parakeet material batching can still produce two draws without flattening its hinges. Worst active animal+wing+12-triangle marker: 5,220 triangles, 24 optimized draws. Proposed integration caps: 5,600 triangles and 24 optimized draws; eight worst-draw avatars: 192 calls. Raw active maximum: 34 calls, below the existing raw cap 36. Download size rises to 727,516 bytes for all eight assets, principally the new authored animation data. This does not establish GPU memory, parse speed or frame rate.

`v4-previews/`: labelled like-for-like v3/v4 studio views, all animal sides, five clips as actual frame strips, run/glide GIFs, all six wing-glide styles, and all twelve attached animal/style combinations. These are Blender Cycles CPU renders, not game screenshots. Grain is sampling noise, not a texture. The renderer and contact-sheet assembler are included for reproduction.

Asset-owner checks: existing 12 appearance asset/loader/clearance tests pass with the new exports; static TypeScript/Vite build passes, retaining the existing >500 kB chunk warning. The integrated runtime additionally passed all 18 expanded appearance tests, including an entire WingGlide cycle across six aspect ratios and both steering extremes, with no near-plane or central landing-sightline failure. That is geometric runtime evidence, not ordinary browser or device acceptance. Full combined runtime verification and final publication remain separate integration steps.

## Provenance, tools and remaining limits

All geometry, palettes and animation are originally authored for this project with installed Blender primitives and built-in mesh operations/exporter. No external models, textures, downloads, plugins, installs or licensing obligations were introduced. No glTF Transform installation was made; pruning, material consolidation and decimation were applied in authoring. Target-device FPS, ordinary browser journey, real in-game lighting, live multiplayer and final visual acceptance remain unverified here. Art should be judged in those contexts before calling it accepted.

## Reproduce visual evidence

Render one isolated v3 source pass with the preserved `generate_refined_assets.py` for before views, then the frozen v4 pass for after views. The contact assembler expects these repository-local staging directory names (none is shipped as a recovery archive):

    blender -b -noaudio --python assets/appearance-source/generate_animated_assets.py -- v4-native
    blender -b -noaudio --python assets/appearance-source/generate_refined_assets.py -- baseline-native
    blender -b -noaudio --python assets/appearance-source/render_animated_previews.py -- baseline-native baseline-previews compare
    blender -b -noaudio --python assets/appearance-source/render_animated_previews.py -- v4-native final-previews avatars
    blender -b -noaudio --python assets/appearance-source/render_animated_previews.py -- v4-native wing-motion-previews wings
    blender -b -noaudio --python assets/appearance-source/render_animated_previews.py -- v4-native attached-final-previews attachments
    python assets/appearance-source/assemble_animated_previews.py

The GIFs are resized, labelled and palette-quantized composites of 24 actual rendered frames; no interpolated poses are synthesized. Companion silent H.264 MP4s are encoded from those GIFs with installed FFmpeg for small convenient playback. Their pixel dimensions are 640×270 including one padding row. Full-resolution source frame strips remain PNG.


## Rabbit-bound refinement and playback timing

The final rabbit Run uses a species-specific paired front/hind bound; fox Run retains its diagonal trot. The body/root/socket, clip names and durations are unchanged. The original trot-only candidate is superseded. A renderer test checks paired paw trajectories, support intervals and an airborne interval so the rabbit cannot silently regress to the fox gait.

`preview-timing.json` records all GIF frame delays and independently probed MP4 stream timing. Run is exactly 24 frames / 700 ms (MP4 240/7 fps); glide is exactly 24 frames / 1,600 ms (MP4 15 fps). GIF frame delays are distributed in 10 ms units to match those totals, rather than rounding every frame down. Source tests parse the actual GIF blocks and verify both totals. The compact MP4s use the same actual-duration poses.

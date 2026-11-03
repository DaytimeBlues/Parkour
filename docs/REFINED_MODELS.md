# Refined original models — development candidate, 2026-11-03

Shipping paths now contain the revised original Blender fox, rabbit and all six
wing styles. Their complete editable source is
`assets/appearance-source/generate_refined_assets.py`; its output includes editable
Blender scenes and shipping GLBs. `refined-manifest.json` binds the generator and
eight GLBs to exact hashes. The original generator remains as a historical
baseline; archived .blend scenes and old preview images are not distributed in
the public export. Public commit `8495e8e7f33954e0e55e853ecea9146daebbb27c` retains
all previous shipping GLBs and public source for rollback. No runtime quality toggle was added.

The revision adds smoother purpose-built body contours, paws, muzzles and eye
features; shaped feathers, webbed membranes and fingers, ear rims and crystal
wings. All geometry is original project work. There are no third-party models,
textures, decoder dependencies, new material shaders or changes to physics,
network messages, team authority, character IDs, sockets or animation names.
Closed cosmetic shells are front-sided opaque PBR rather than the old double-sided
meshes. Emissive Glow is a material treatment, not measured bloom.

Validation completed before source integration:
- All eight shipping GLBs match three independent Blender 4.3.2 generator passes.
- 1,155 isolated Three r180 loader/contract assertions and 1,368 first-person
  sightline/pose samples from copies of the actual existing runtime helpers pass.
- An additional 48 actual-loader assemblies cover both characters, six styles,
  both team markers and batched/unbatched paths, with idle/run/glide/slide poses,
  finite transforms, preserved attachment and crouch clearance.
- Twelve Blender GLB round-trip renders show open/folded attachments for both
  characters across all six styles. These are inspected asset renders, not
  browser screenshots, gameplay or school-laptop performance measurements.
- New dependency-free source tests enforce exact bytes, geometry, material and
  rigid-animation interfaces. The full application graphics tests/build remain
  blocked by unavailable locked dependencies; updating their expected counts is
  not a claim that they ran.

Cost is deliberately disclosed, not hidden by a larger test ceiling. Maximum
character+wing+team marker is 4,670 triangles versus 1,468 previously. The active
multiplayer batching path has at most 26 draws versus 20 previously; its existing
parakeet derivation still reduces 16 wing primitives to two. Eight visible avatars
would therefore have a conservative maximum 37,360 triangles and 208 draws,
versus 11,744 triangles and 160 draws previously, excluding the world/HUD.
The unbatched fallback maximum is 36 draws (288 for eight avatars). These are
structural counts, not measured renderer frame calls or performance. Ordinary
rendered testing, school-device timing and hosted eight-session acceptance are
still required before calling this candidate classroom-ready. The smaller GLB
transfer sizes do not establish faster drawing or startup.


## Optional rigid character batching

The multiplayer path now derives color batches within each existing rigid parent
before cloning cached templates. It preserves each joint/socket, all animation
tracks, indexed vertex count, triangle count and every material setting including
roughness. Only equal-shading sibling pieces are combined; their linear base colors
become vertex colors. Solo and preview loaders remain unchanged. The shipping GLBs
and source generator are unchanged.

For the accepted assets, fox character draws fall from 16 to 13 and rabbit draws
from 19 to 9. Including the marker and worst six-draw wings, the active worst case
is 20 rather than 26 draws per avatar: 160 rather than 208 for eight visible avatars,
a 23% structural reduction. The original 36 raw/26 wing-only bounds remain explicit
fallbacks. Unsupported material, geometry, animation or hierarchy changes keep the
original meshes, and callers can disable character batching with `batchAvatars:false`.
The derivation preserves shared resources still used by unmerged meshes and disposes
replaced/derived resources exactly once.

This is fewer submitted mesh draws, not an FPS claim. Vertex-color attributes add
some cached geometry memory; indexed geometry is retained rather than expanded.
Actual target-device rendered timing, full application build and ordinary browser
acceptance remain separate gates.

Measured unique active BufferAttribute payload rises by 8,136 bytes for fox and
20,736 bytes for rabbit (including changed sharing of index accessors). These are
one-time template costs shared by clones, not a per-player geometry allocation.
Each template uses five material objects after derivation, versus six originally.
The loader may retain disposed originals in parser caches, so additional retained
CPU arrays are approximately 31.8 KB for fox and 64.9 KB for rabbit, rather than
only the smaller active-geometry deltas above. This remains bounded per template.

# Authored appearance animation

Characters and wings are cosmetic. Their animation does not change player coordinates, velocity, collision, input, scoring, room state or server authority.

## Character states

The runtime selects AvatarIdle, AvatarRun, AvatarJump, AvatarGlide and AvatarLand from the observed grounded, gliding, sliding and horizontal-speed state. Idle, run and glide repeat. Jump plays once and holds its airborne endpoint until glide or landing. Landing plays once after an observed airborne-to-grounded transition, then returns to idle or run. A new takeoff interrupts landing. Joining an already-grounded runner does not invent a landing event.

Animation uses an independent bounded presentation clock. Paused rooms freeze their sampled pose. Reduced-motion preference uses static authored poses. Sliding uses a static crouch-scaled pose, with wings and the overhead team marker hidden. Invalid, reversed or long-delayed render timestamps cannot fast-forward an unbounded animation step. Older three-clip character models remain usable by falling back to AvatarIdle when jump or landing clips are absent.

Remote characters and the character menu use the same sampler. A labelled menu selector previews all five authored states, repeating jump/landing with a short endpoint hold. The menu animates while open, stops its animation frame when closed and respects reduced motion. Closing, cancelling or changing a pending model discards stale loads through the existing generation and resource lifecycle.

## Wings

WingOpen supplies the exact deployment/folding endpoints. WingGlide supplies a looping authored movement and blends in over the final 15% of deployment, so partially opened wings do not snap to a fully open flap. Reduced motion keeps the exact static deployment pose. The first-person view uses a bounded local clock which freezes on pause and resets between runs; it does not move the camera or change glide physics.

## Articulated geometry and budgets

Articulated meshes remain under their authored joints. The legacy woodland-v2 rigid batching derivation accepts only its original narrow interface and otherwise keeps the original hierarchy. New vertex-coloured articulated models must not be flattened across head, ear, leg or paw joints. The original v2 character GLBs are retained only as regression fixtures for that old derivation.

The current structural limits are 32 cached remote entries, 8 cached asset templates, 36 raw draws, 26 wing-batched draws, 24 active optimized draws and 5,600 triangles per avatar including the team marker. A maximum-cost eight-avatar scene is bounded by 192 active character/wing/marker draws and 44,800 triangles. These limits are structural estimates, not rendered GPU, memory or school-device performance acceptance.

## Verification

Pure-state tests cover repeated transitions, one-shot endpoints, pause, reduced motion, invalid clocks and reset. Actual installed Three mixers verify clip sampling, wing blending, legacy fallback and disposal. Actual exported model tests additionally check all clips, geometry, sockets, first-person near-plane and central landing sightline, and unchanged authoritative movement. Passing those checks does not establish ordinary browser controls, hosted multiplayer latency or target-school-device performance.

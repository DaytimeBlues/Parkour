# Skybound Sprint: deployment-readiness recovery candidate

This branch is a NEW source reconstruction, not the lost original combined checkpoint. It preserves the existing public source history and includes recovered animation-runtime text, byte-identical v4b shipping models and explicitly regenerated editable Blender sources. It has not been deployed.

## Build and verify the Render service

Use the Node version in .node-version.

    npm ci --include=dev --ignore-scripts
    node --test tests/*.test.mjs
    node --test server/test/*.test.mjs
    npm run build:render
    node --test render/test/*.test.mjs

The tested recovery source passes 343 client tests, 74 server tests and 16 Render tests. Both Render and static production builds pass. Check the exact branch commit and final verification receipt before treating a later revision as tested.

For local service startup, follow render/README.md and render/environment.example. Set PUBLIC_ORIGIN to the actual origin and use npm run start:render; health is /healthz. Teacher access fails closed without explicit teacher configuration. Do not put real credentials in source. The separate historical Sites/Worker pipeline is not the Render deployment target.

## Deployment and acceptance gates

Source preparation is not deployment approval. The existing Render service has automatic deploys and previews disabled. Confirm the intended candidate commit and obtain operator approval before deploying or changing service configuration. Existing live commit remains separate from this branch.

A complete approved private source/history checkpoint, exact-object download/restore verification, genuine WebGL ordinary-control checks, teacher sign-in and opposing multi-device classroom acceptance remain required. Local HTTP/SQLite pressure checks do not establish graphics or FPS. Default in-memory rooms and teacher sessions reset on process restart, sleep or redeploy; durable classroom state, SSO and multi-instance correctness are not promised.

## Graphics and model evidence

The current animals use rigid-node articulation, not skinned deformation; recovering this candidate is not a visual-quality upgrade. All eight shipping GLBs match recorded original hashes. Regenerated native sources export semantically equivalently, but their container bytes differ from original native files. There are five body states and three wing clips; animation/import checks cover all 28 clips at 121 poses.

Source-based graphics audit estimates 20-24 submissions per complete avatar, at most 5,220 triangles. These are geometry/submission estimates, not measured GPU calls or FPS. See docs/readiness/GRAPHICS-AUDIT.md and RENDER-PROFILING-ACCEPTANCE.md. Real renderer, target-device frame times and final model-quality acceptance remain open.

The public source deliberately excludes private historical QA reports/screenshots, actual hosting configuration, private source history and audio. Production Render builds intentionally omit music. Existing public licence and safe example configuration are retained.

# Reconnection recovery development checkpoint

This branch preserves the source-tested client recovery repair from revision 5dead718ea8fd0aee5ed7969501a3560ceae7bfe. It is not a deployment or a claim that the hosted classroom issue is fixed.

Transient reconnects keep the map visibly paused, reject new movement while recovering, validate reconnect state and require a live sync before resuming. A fixed ten-second deadline expires to explicit release/manual reconnect; late replies cannot revive an expired lifecycle. Server movement credit, authority and wire format are unchanged.

Prior source-bound acceptance: 265 game tests, 74 server tests, 11 Render adapter tests and production build passed. Eight-client fast HTTP and five-minute slow-network scenarios passed locally, including jitter, lost acknowledgement and a brief stall. The complete private checkpoint was downloaded and restored with tests/build verified. These results are retained evidence, not new tests run during this source-only upload.

Ordinary rendered browser controls, hosted multi-user classroom behaviour and school-device performance remain unverified. Character and island visual overhaul is planned, not implemented.

## Reproduce

Use the committed lockfile and Node version. Run npm ci --include=dev --ignore-scripts; node --experimental-strip-types --test tests/*.test.mjs; node --test server/test/*.test.mjs; npm run build:render; npm run test:render. The separate slow-network harness is node --experimental-strip-types scripts/multiplayer-render-latency.mjs; do not weaken the independent fast-network gate.

No changes to main, the existing Render branch, hosting bindings or deployment settings are included in this checkpoint.

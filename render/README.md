# Parkour: disposable Render test adapter

This is a **new reconstruction from the restored eight-player baseline**, not recovery of the earlier local-only Render candidate. It runs the existing multiplayer and leaderboard SQL handlers on one Node 24 process with local SQLite. It does not update the existing Sites project.

## Run locally

```sh
npm ci --include=dev --ignore-scripts
npm run build:render
PUBLIC_ORIGIN=http://127.0.0.1:3000 PORT=3000 npm run start:render
```

Open `/game/` for solo courses or `/game/multiplayer/` to join a room. `/healthz` is the health check. Teacher access deliberately returns503 until configured. No secrets are generated or configured by this project.

## Render settings — operator action, not an automatic deployment

Use a **Web Service**, not a Static Site, from the reviewed repository branch:
- Node24 (`.node-version` pins the tested version).
- Build: `npm ci --include=dev --ignore-scripts && npm run build:render`
- Start: `npm run start:render`
- Health check: `/healthz`
- Port: Render's supplied `PORT`; listens on `0.0.0.0`.
- Origin: Render's `RENDER_EXTERNAL_URL` is used automatically, or set `PUBLIC_ORIGIN` to the exact HTTPS origin (no trailing slash/path). Incoming Host/Forwarded headers do not establish trust.
- Keep automatic deploys **off**. `render.yaml` sets this for Blueprint creation; if creating a service manually, switch it off separately in Render settings. No accounts, resources, paid services or deployment are created by these files.

The optional Blueprint chooses `plan: free`. Read [Render's free-service limits](https://render.com/docs/free) and [Blueprint specification](https://render.com/docs/blueprint-spec). Free services can sleep and have ephemeral files; this is not a durable classroom service.

## Private named-teacher configuration

The operator sets **`PARKOUR_TEACHERS_JSON` privately in the service environment**, not in GitHub, a shared link, browser storage or a student handout. It is a JSON object mapping a stable teacher ID to that teacher's private secret. Schematic shape: `{"teacher1":"<private secret>"}` — this short placeholder is intentionally invalid.

Use up to16 lowercase IDs matching `[a-z][a-z0-9_-]{0,31}`, each with a distinct32–1024-character high-entropy secret chosen privately by the operator. Keep IDs stable to retain room ownership while the process exists. Missing/empty configuration disables teacher access; malformed or duplicate secrets stop startup. `.env` files are not automatically loaded. Students need only a room code and nickname.

`/teacher` is a local test-service sign-in, **not ChatGPT or institutional SSO**. Each teacher can list/control only their own rooms. Do not share one teacher's secret across unrelated teachers. Teacher sessions are random, hashed in memory, limited to32, expire after6hours, rotate on login, and revoke on logout. HTTPS cookies are Secure/HttpOnly/SameSiteStrict. Login is globally limited to10attempts/minute: abuse can temporarily block all teachers, an explicit prototype tradeoff. No teacher secrets or request bodies are logged.

## State, reliability and known limits

- New rooms admit at most8players; a ninth is rejected. A valid saved seat can reconnect at capacity. Teacher removal revokes the old seat. Legacy rooms with more than8seats are not forcibly evicted.
- Default SQLite is `:memory:`. **All rooms, scores and teacher sessions reset on restart/sleep/redeploy.** One instance only; no clustering or durable classroom data. Optional `PARKOUR_DB_PATH` exists for local development/reopen tests, not a promise of persistence on Render Free. Startup fails rather than silently clearing a corrupt/mismigrated database.
- The multiplayer server remains authoritative for movement. Its existing500ms input-credit/60-frame backlog safety limits remain. Sustained high latency can still freeze/reconnect; this adapter does not fix the separate slow-D1 protocol limitation. A bounded notification-order fix prevents successful internal resynchronization from falsely exiting the map; real outages or revoked seats still freeze safely.
- A local actual-HTTP test is not internet multi-device, browser graphics, school-network or hosted Render acceptance. Do not label this production-ready.
- Solo board milestones are client-reported; the leaderboard is not cheat-proof. The Node adapter reuses the original contract rather than claiming stronger verification.
- Music files are omitted from this distributable build because redistribution clearance is not established. Playback failures are handled; all original third-party notices for included code/assets remain. No Polyfork model is included. Native Blender files and authoring contact sheets are omitted from the public export; the original generator and shipping GLBs remain.

## Test commands

```sh
node --experimental-strip-types --test tests/*.test.mjs
node --test server/test/*.test.mjs
npm run build:render
npm run test:render
node --experimental-strip-types scripts/multiplayer-render-pressure.mjs --players 8 --duration-seconds 300
```

Adapter tests cover cross-teacher denial, spoofed identity headers, CSRF/cookie/session limits, eight-player admission and reconnect/revocation, streamed body limits, static containment, migration idempotence and atomic rollback. The launch test verifies the configured start entrypoint and exact built HTML/model bytes. Tests use synthetic credentials only. No real credentials or access grants are created.

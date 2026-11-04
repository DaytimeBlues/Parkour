# Prediction holds and epoch recovery

The client generates movement at 60 fixed input frames per second, sends at most
30 frames per request and keeps one request in flight. The server caps movement
credit at 500 ms. Those bounds prevent delayed input from becoming extra movement
or a large catch-up burst. They are unchanged by this fix.

At sustained 600–900 ms request latency, the connection can acknowledge only about
33–50 input frames per second. The combined 60-frame prediction bound fills, so
local movement pauses until an acknowledgement arrives. This is visible gameplay
backpressure even though the player remains in the map with mouse capture intact.
It is not evidence of smooth movement or a solved hosted performance problem.

A controlled eight-client HTTP/SQLite fixture with transition instrumentation
confirmed this. An unaffected client had 33 completed holds between 2 and 26 seconds:
median 196 ms, range 89–407 ms, totaling approximately 7.0 seconds. The existing
`predictionHoldSignals` metric counts callbacks while held, not unique episodes,
so its total must not be described as a disconnect count. Injected lost-ACK, stall,
suspension and teacher-control cases are separate from this steady sample.

## Narrow scheduling fix

After a STALE_EPOCH response, a successful delayed state read previously published
its callback before clearing the hold, and restarted the 200 ms request-spacing
clock at response arrival. The callback could therefore show an already-completed
hold, while the scheduler waited another 200 ms unnecessarily.

The client now validates and accepts the baseline without notifying, clears the
hold, restores the state request's send-start time, then notifies once. This matches
the existing timing/reconnect scheduling rule. A failing-first regression used a
state request starting at 1016.67 ms and returning at 1716.67 ms; the next sync is now
eligible immediately rather than waiting until 1916.67 ms. Suspended, disposed,
stale-epoch/version, wrong-player and wrong-acknowledgement responses still cannot
clear the hold or publish a successful baseline.

This change does not remove steady slow-network pauses. Queue limits, batch size,
credit, sequence fencing, teacher control and server authority are unchanged.

## Next performance gate

Measure actual end-to-end sync latency and ordinary browser movement on the approved
hosted route. Sustained request duration must be below 500 ms to drain a 60 Hz stream
with the current 30-frame limit; the separate existing fast-network gate targets
roughly five sends per second with p95 send gaps at most 280 ms. Worker wall time
alone is not browser round-trip time. If latency remains too high, isolate host,
network and database costs before considering a separately tested protocol redesign.
Do not widen prediction or credit limits merely to hide the hold counter.

## Render application timing

Successful `/api/multiplayer/sync` replies include `Server-Timing: app;dur=…`
(milliseconds). The interval starts after the request body has arrived and the
Fetch Request has been constructed, then includes principal lookup, route work,
SQLite operations, snapshot creation and response serialization. It ends before
writing the socket. It does not include upstream proxy queues, request upload,
network transit, browser work or socket delivery. It is elapsed application time,
not CPU time and not a database-only measurement.

Only a constant metric name and numeric duration are exposed. Teacher sign-in,
rejected requests and other routes do not publish timing. No credentials, room
codes, nicknames, query text or player identities are added, no telemetry is sent
to another service, and no cross-origin timing permission is enabled. The metric
uses a separate monotonic clock and cannot alter the simulation clock or credit.

The fast eight-client fixture reports `diagnostics.syncApplicationMs`; the slow
fixture reports `syncApplicationP95Ms` and its sample count per client, alongside
existing request durations. Both require a valid timing sample for successful sync
responses. These loopback samples are not evidence of hosted performance. The
slow fixture intentionally injects network delay, so low application time there
must not be described as eliminating prediction holds.

On an approved deployment, compare the browser request's elapsed time with its
application duration in the Network panel. A large difference identifies time
outside this measured application interval, not necessarily pure network latency.
Collect distributions and hold transitions across eight sessions before choosing
a transport or protocol redesign. The historical 512–955 ms Worker wall-time
sample came from the older Cloudflare deployment, not the Node/SQLite Render host.

Header syntax follows the [W3C Server Timing specification](https://www.w3.org/TR/server-timing/).
This is diagnostic instrumentation, not a fix for sustained network latency.

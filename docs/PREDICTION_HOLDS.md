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

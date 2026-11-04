# Runner membership lifecycle

A delayed connection and a permanently unavailable seat are different outcomes.
Transient HTTP/network failures retain the existing bounded recovery, fixed-frame
prediction limits and authoritative server checks. They do not clear a saved seat.

The server's explicit SEAT_REMOVED, SEAT_NOT_IN_ROOM, ROOM_EXPIRED,
ROOM_NOT_FOUND and ROOM_VERSION_RETIRED responses terminate that client instance.
The legacy SEAT_REVOKED spelling is treated as removed too. A terminal runner:

- Discards pending/submitted movement and the old predicted position.
- Stops both automatic and manual reconnect requests for that instance.
- Rejects a late successful response or baseline that would revive old membership.
- Shows a dedicated message and a Back to multiplayer action instead of an old
  roster, “You're in” instruction, or a misleading reconnect button.
- Removes the saved seat only if room, player and token still match that instance.
  It cannot erase credentials saved by a newer view. Blocked storage is tolerated.
- Stops the polling timer until another explicit view/client wakes the driver,
  including an expired saved-seat restore with no room snapshot and hidden tabs.

Teacher removal remains server-authoritative and irreversible for that seat.
Going back does not join a room, create a new seat, rotate the idempotent join key,
change room permissions or restore removed access. Ask the teacher before joining.
An ordinarily ended match is still a scoreboard, not a removed seat; it retains
its final state unless a later server response explicitly invalidates membership.
Unknown protocol/HTTP errors keep the existing manual-retry boundary instead of
being assumed to revoke access.

Tests cover real SQLite teacher removal, sync/direct-reconnect rejection, nested
state recovery, late replies, exact storage cleanup, the actual terminal UI and
restored-client callback, timer teardown and ordinary recovery regression. A full
TypeScript/Vite build and source tests are not hosted rendered/classroom acceptance.
No production account, credential or room is required by these fixtures.

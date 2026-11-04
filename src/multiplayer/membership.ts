/** Permanent membership failures are distinct from a recoverable connection. */
export type MembershipIssue = 'seat-removed' | 'seat-invalid' | 'room-expired' | 'room-missing' | 'room-retired';
const issues: Record<string, MembershipIssue> = { SEAT_REMOVED: 'seat-removed', SEAT_REVOKED: 'seat-removed', SEAT_NOT_IN_ROOM: 'seat-invalid', ROOM_EXPIRED: 'room-expired', ROOM_NOT_FOUND: 'room-missing', ROOM_VERSION_RETIRED: 'room-retired' };
export function membershipIssueFor(error: unknown): MembershipIssue | null {
  if (!(error instanceof Error) || !('status' in error)) return null;
  const status = (error as Error & {status: number}).status;
  return [403, 404, 409, 410].includes(status) ? issues[error.message] ?? null : null;
}
export function membershipNotice(issue: MembershipIssue): {title: string; message: string} {
  if (issue === 'seat-removed') return {title: 'Your seat was removed', message: 'Your seat was removed, so you are no longer in this room. Ask your teacher before joining again.'};
  if (issue === 'seat-invalid') return {title: 'This saved seat is unavailable', message: 'This seat no longer belongs to the room. Ask your teacher for the current room code.'};
  if (issue === 'room-expired') return {title: 'This room has expired', message: 'Ask your teacher for a new room code. Your old seat cannot reconnect.'};
  if (issue === 'room-missing') return {title: 'This room is unavailable', message: 'The room could not be found. Ask your teacher for the current room code.'};
  return {title: 'This room needs a fresh start', message: 'This room uses an older game version. Ask your teacher to create a new room.'};
}
/** Never delete a newer view's credentials when an obsolete request finishes. */
export function forgetMatchingSeat(storage: Pick<Storage, 'getItem' | 'removeItem'>, key: string, seat: {code: string; playerId: string; seatToken: string}): boolean {
  try {
    const saved = JSON.parse(storage.getItem(key) ?? 'null');
    if (!saved || saved.code !== seat.code || saved.playerId !== seat.playerId || saved.seatToken !== seat.seatToken) return false;
    storage.removeItem(key); return true;
  } catch { return false; }
}

/** Shared browser/fixture driver. Deadlines follow actual send starts, never
 * response completion +200ms or a queue of missed polling slots. */
type PumpClient = {
  lastAttempt: number; busy: boolean; needsReconnect: boolean; membershipIssue?: string | null;
  room: { status: string } | null; pump(): Promise<void>; recover?(): Promise<void>;
};
type Timing = {
  clock?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  onWake?: (now: number) => void;
  onError?: (error: unknown) => void;
};
export function createPumpDriver(getClient: () => PumpClient | null, enabled: () => boolean = () => true, timing: Timing = {}) {
  const clock = timing.clock ?? (() => performance.now());
  const setTimer = timing.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
  const clearTimer = timing.clearTimer ?? (timer => clearTimeout(timer as ReturnType<typeof setTimeout>));
  let timer: unknown, generation = 0, stopped = false;
  const active = new Set<Promise<void>>();
  function arm(delay: number, owner: number) {
    if (stopped || owner !== generation) return;
    if (timer !== undefined) clearTimer(timer);
    timer = setTimer(() => {
      timer = undefined;
      const task = drive(owner); active.add(task);
      void task.then(() => active.delete(task), () => active.delete(task));
    }, Math.max(1, delay));
  }
  async function drive(owner: number) {
    if (stopped || owner !== generation) return;
    const client = getClient(), now = clock();
    timing.onWake?.(now);
    if (client?.membershipIssue) return; // A new client/view must explicitly wake us.
    if (!enabled() || !client || !client.room || client.room.status === 'ended') { arm(200, owner); return; }
    if (client.needsReconnect) {
      try { await client.recover?.(); }
      catch (error) {
        // An unexpected recovery failure must be visible, not silently leave a
        // dead scheduler. Old views cannot stop a newer driver's generation.
        if (!stopped && owner === generation) {
          stop(); (timing.onError ?? (error => console.error('Multiplayer recovery failed', error)))(error);
        }
        return;
      }
      if (client.membershipIssue) return;
      arm(client.needsReconnect ? 200 : client.lastAttempt + 200 - clock(), owner); return;
    }
    // A manual reconnect or another explicit owner may be busy. Do not spin on
    // an expired send deadline or add another request to that client.
    if (client.busy) { arm(50, owner); return; }
    const remaining = client.lastAttempt + 200 - now;
    if (remaining > 0) { arm(remaining, owner); return; }
    try { await client.pump(); }
    catch (error) { stop(); (timing.onError ?? (error => console.error('Multiplayer pump failed', error)))(error); return; }
    // wake()/stop() invalidates an old client's continuation; replacing a view
    // must not wait for an obsolete request or let it re-arm the new driver.
    const current = getClient();
    if (current?.membershipIssue) return;
    arm(current ? current.lastAttempt + 200 - clock() : 200, owner);
  }
  function wake() { if (stopped) return; generation++; arm(1, generation); }
  function stop() { stopped = true; generation++; if (timer !== undefined) clearTimer(timer); timer = undefined; }
  wake();
  return { wake, stop, async whenIdle() { await Promise.allSettled([...active]); } };
}

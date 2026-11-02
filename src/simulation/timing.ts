/** Wall-clock run time accrues only while actively playing; physics caps separately. */
export function activeFrameSeconds(playing: boolean, nowMs: number, previousMs: number): number {
  return playing ? Math.max(0, (nowMs - previousMs) / 1000) : 0;
}
export function physicsFrameSeconds(activeSeconds: number): number {
  return Math.min(activeSeconds, 0.1);
}

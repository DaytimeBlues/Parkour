import type { PublicRoom } from './multiplayer.mjs';
export const WIRE_VERSION: 3;
export function encodeRoom(room: PublicRoom & {snapshotMs: number; controlRevision: number}, viewerPlayerId?: string | null, version?: 2 | 3): unknown;
export function decodeRoom(wire: unknown): PublicRoom & {code: string; version: number; snapshotMs: number; controlRevision: number};

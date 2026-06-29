/**
 * Realtime internal types
 *
 * Kept separate from `./events.ts` (the wire-format event/payload map) so that
 * server-only data — like the JWT payload shape and the per-socket data bag —
 * can evolve without leaking through to the shared client types.
 */

export interface RealtimeJwtPayload {
  /** User id (`sub` claim). */
  sub: string;
  /** Active tenant id the user is connecting as. */
  activeTenantId: string;
  /** Role in the active tenant. */
  role: string;
}

/**
 * Per-socket authenticated context. Set by RealtimeGateway after a successful
 * JWT handshake, consumed by every other gateway / handler that needs to know
 * "who is on this socket" without re-verifying the token.
 */
export interface RealtimeSocketData {
  userId: string;
  tenantId: string;
  role: string;
  rooms: string[];
  /** Map of channelId -> joined (mirrors the channel:<id> rooms the socket is in). */
  channels: string[];
}

export interface AuthenticatedSocketData {
  userId: string;
  tenantId: string;
  role: string;
  rooms: string[];
  channels: string[];
}
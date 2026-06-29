/**
 * Realtime Event Types
 * Shared between server and client for type-safe WebSocket communication
 */

// Client -> Server events
export interface ClientEvents {
  // Authentication
  'auth:token': (token: string) => void;
  'auth:refresh': (token: string) => void;

  // Presence
  'presence:heartbeat': () => void;

  // Chat (passthrough for chat agent)
  'chat:message': (payload: ChatMessagePayload) => void;
  'chat:typing': (payload: TypingPayload) => void;
  'chat:read': (payload: ReadPayload) => void;
}

// Server -> Client events
export interface ServerEvents {
  // Connection
  'connection:established': (payload: ConnectionEstablishedPayload) => void;
  'connection:error': (payload: ConnectionErrorPayload) => void;

  // Auth
  'auth:success': (payload: AuthSuccess: AuthSuccessPayload) => void;
  'auth:failed': (payload: AuthFailedPayload) => void;

  // Notifications
  notification: (payload: NotificationPayload) => void;

  // Presence
  'presence:update': (payload: PresenceUpdatePayload) => void;
  'presence:online': (payload: PresenceOnlinePayload) => void;
  'presence:offline': (payload: PresenceOfflinePayload) => void;

  // Chat (passthrough for chat agent)
  'chat:message': (payload: ChatMessagePayload) => void;
  'chat:typing': (payload: TypingPayload) => void;
  'chat:read': (payload: ReadPayload) => void;
  'chat:message:new': (payload: ChatMessagePayload) => void;
  'chat:message:edited': (payload: ChatMessageEditedPayload) => void;
  'chat:message:deleted': (payload: ChatMessageDeletedPayload) => void;
}

// Payload types
export interface ConnectionEstablishedPayload {
  socketId: string;
  timestamp: string;
}

export interface ConnectionErrorPayload {
  code: string;
  message: string;
}

export interface AuthSuccessPayload {
  userId: string;
  tenantId: string;
  role: string;
  rooms: string[];
}

export interface AuthFailedPayload {
  code: string;
  message: string;
}

export interface NotificationPayload {
  id: string;
  tenantId: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  link?: string;
  readAt?: string;
  createdAt: string;
}

export interface PresenceUpdatePayload {
  userId: string;
  tenantId: string;
  status: 'online' | 'offline' | 'away';
  lastSeen: string;
  metadata?: Record<string, unknown>;
}

export interface PresenceOnlinePayload {
  userId: string;
  tenantId: string;
  timestamp: string;
}

export interface PresenceOfflinePayload {
  userId: string;
  tenantId: string;
  timestamp: string;
  lastSeen: string;
}

export interface ChatMessagePayload {
  id: string;
  tenantId: string;
  channelId: string;
  senderId: string;
  content: string;
  parentId?: string;
  createdAt: string;
}

export interface ChatMessageEditedPayload {
  id: string;
  channelId: string;
  content: string;
  editedAt: string;
}

export interface ChatMessageDeletedPayload {
  id: string;
  channelId: string;
  deletedAt: string;
}

export interface TypingPayload {
  channelId: string;
  userId: string;
  isTyping: boolean;
}

export interface ReadPayload {
  channelId: string;
  userId: string;
  messageId: string;
}

// Room naming conventions
export const RoomNames = {
  user: (userId: string) => `user:${userId}`,
  tenant: (tenantId: string) => `tenant:${tenantId}`,
  channel: (channelId: string) => `channel:${channelId}`,
} as const;

// Event names for internal use
export const ServerEventNames = {
  NOTIFICATION: 'notification',
  PRESENCE_UPDATE: 'presence:update',
  PRESENCE_ONLINE: 'presence:online',
  PRESENCE_OFFLINE: 'presence:offline',
  CHAT_MESSAGE: 'chat:message',
  CHAT_TYPING: 'chat:typing',
  CHAT_READ: 'chat:read',
  CHAT_MESSAGE_NEW: 'chat:message:new',
  CHAT_MESSAGE_EDITED: 'chat:message:edited',
  CHAT_MESSAGE_DELETED: 'chat:message:deleted',
  CONNECTION_ESTABLISHED: 'connection:established',
  CONNECTION_ERROR: 'connection:error',
  AUTH_SUCCESS: 'auth:success',
  AUTH_FAILED: 'auth:failed',
} as const;

export const ClientEventNames = {
  AUTH_TOKEN: 'auth:token',
  AUTH_REFRESH: 'auth:refresh',
  PRESENCE_HEARTBEAT: 'presence:heartbeat',
  CHAT_MESSAGE: 'chat:message',
  CHAT_TYPING: 'chat:typing',
  CHAT_READ: 'chat:read',
} as const;
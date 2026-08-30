// Minimal WebSocket interface — matches ws package without import issues (same pattern as negotiation-ws.ts)
interface WebSocket {
  readonly OPEN: number;
  readonly readyState: number;
  send(data: string): void;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: (err: Error) => void): void;
}

export interface WsNotificationMessage {
  type: "notification.new";
  notification: {
    id: string;
    eventType: string;
    category: string;
    payload: Record<string, unknown>;
    createdAt: string;
  };
}

/** Anything user-addressed that rides the per-user socket (notifications, messaging). */
export type WsUserMessage = WsNotificationMessage | { type: string; [key: string]: unknown };

/**
 * userId → open sockets.
 *
 * A Set, not a single socket: a user with two tabs open holds two sockets, and
 * keeping only the newest silently stopped delivering to the older tab.
 */
const registry = new Map<string, Set<WebSocket>>();

export function registerUserSocket(userId: string, ws: WebSocket): void {
  const sockets = registry.get(userId);
  if (sockets) {
    sockets.add(ws);
    return;
  }
  registry.set(userId, new Set([ws]));
}

export function unregisterUserSocket(userId: string, ws?: WebSocket): void {
  const sockets = registry.get(userId);
  if (!sockets) return;
  // No socket given → drop every socket for the user (legacy call shape).
  if (!ws) {
    registry.delete(userId);
    return;
  }
  sockets.delete(ws);
  if (sockets.size === 0) registry.delete(userId);
}

/** Sockets this process holds for a user. Used by tests and metrics. */
export function countUserSockets(userId: string): number {
  return registry.get(userId)?.size ?? 0;
}

/**
 * Send to the user's sockets **on this instance only**. Cross-instance delivery
 * is the fan-out layer's job — domain code should call publishToUser instead.
 */
export function pushToUser(userId: string, message: WsUserMessage): void {
  const sockets = registry.get(userId);
  if (!sockets || sockets.size === 0) return;

  const data = JSON.stringify(message);
  for (const ws of sockets) {
    if (ws.readyState !== ws.OPEN) {
      sockets.delete(ws);
      continue;
    }
    try {
      ws.send(data);
    } catch {
      // Connection dropped — cleaned up on its close event.
    }
  }
  if (sockets.size === 0) registry.delete(userId);
}

/** Test seam. */
export function __clearUserSocketsForTests(): void {
  registry.clear();
}

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

// userId → WebSocket (1 connection per user — last one wins on reconnect)
const registry = new Map<string, WebSocket>();

export function registerUserSocket(userId: string, ws: WebSocket): void {
  registry.set(userId, ws);
}

export function unregisterUserSocket(userId: string): void {
  registry.delete(userId);
}

export function pushToUser(userId: string, message: WsNotificationMessage): void {
  const ws = registry.get(userId);
  if (!ws || ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(message));
  } catch {
    // Connection dropped — will be cleaned up on close event
  }
}

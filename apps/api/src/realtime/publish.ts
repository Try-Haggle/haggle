import { publishRealtime } from "./fanout.js";

/**
 * Events are typed at their producer (WsNotificationMessage, messaging events,
 * ...). The transport only needs "a JSON object with a type", so the widening
 * cast lives here rather than at every call site.
 */
type PublishableEvent = { type: string };

/** Send a user-addressed event to every instance holding that user's sockets. */
export function publishToUsers<E extends PublishableEvent>(userIds: string[], event: E): void {
  publishRealtime({
    target: { kind: "user", userIds },
    event: event as unknown as Record<string, unknown>,
  });
}

/** Send a negotiation-room event to every instance holding that room's sockets. */
export function publishToSession<E extends PublishableEvent>(sessionId: string, event: E): void {
  publishRealtime({
    target: { kind: "session", sessionId },
    event: event as unknown as Record<string, unknown>,
  });
}

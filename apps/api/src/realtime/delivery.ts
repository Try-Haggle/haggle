/**
 * Local delivery: turns a fan-out envelope into sends on the sockets this
 * process holds. Kept separate from fanout.ts so the transport has no
 * knowledge of WebSocket registries (and there is no import cycle).
 */

import { pushToUser } from "../notification/ws-registry.js";
import { sendToSessionChannel } from "../ws/negotiation-ws.js";
import type { RealtimeEnvelope } from "./fanout.js";

export function deliverRealtimeEnvelope(envelope: RealtimeEnvelope): void {
  if (envelope.target.kind === "user") {
    for (const userId of envelope.target.userIds) {
      pushToUser(userId, envelope.event as { type: string });
    }
    return;
  }
  sendToSessionChannel(envelope.target.sessionId, envelope.event);
}

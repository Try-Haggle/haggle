/**
 * Local delivery routing.
 *
 * This is the seam every realtime event now passes through — notifications and
 * negotiation rounds included, not just messaging. If a target kind stopped
 * reaching its registry, live updates would go quiet with nothing failing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { deliverRealtimeEnvelope } from "../realtime/delivery.js";

const pushToUser = vi.fn();
const sendToSessionChannel = vi.fn();

vi.mock("../notification/ws-registry.js", () => ({
  pushToUser: (...args: unknown[]) => pushToUser(...args),
}));

vi.mock("../ws/negotiation-ws.js", () => ({
  sendToSessionChannel: (...args: unknown[]) => sendToSessionChannel(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deliverRealtimeEnvelope", () => {
  it("sends a user-addressed event to every listed user's sockets", () => {
    deliverRealtimeEnvelope({
      target: { kind: "user", userIds: ["u1", "u2"] },
      event: { type: "message.new" },
    });

    expect(pushToUser).toHaveBeenCalledTimes(2);
    expect(pushToUser).toHaveBeenCalledWith("u1", { type: "message.new" });
    expect(pushToUser).toHaveBeenCalledWith("u2", { type: "message.new" });
    expect(sendToSessionChannel).not.toHaveBeenCalled();
  });

  it("sends a session-addressed event to that negotiation's room", () => {
    deliverRealtimeEnvelope({
      target: { kind: "session", sessionId: "s1" },
      event: { type: "round_update", payload: { round: 3 } },
    });

    expect(sendToSessionChannel).toHaveBeenCalledWith("s1", {
      type: "round_update",
      payload: { round: 3 },
    });
    expect(pushToUser).not.toHaveBeenCalled();
  });

  it("does nothing when no user is listed", () => {
    deliverRealtimeEnvelope({ target: { kind: "user", userIds: [] }, event: { type: "x" } });

    expect(pushToUser).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";
import { agentChatThread, newChatVisitId } from "./agent-chat-thread";

describe("agentChatThread", () => {
  it("gives a saved agent one thread, local and in the database, under the Agents tab's own key", () => {
    expect(agentChatThread("seller", { kind: "saved", id: "agent-1" }, "v1")).toEqual({
      storageId: "agent-studio:seller:saved:agent-1",
      serverThreadKey: "agent-studio:seller:saved:agent-1",
    });
  });

  it("is the same thread whichever visit opens it", () => {
    const a = agentChatThread("buyer", { kind: "saved", id: "agent-1" }, "v1");
    const b = agentChatThread("buyer", { kind: "saved", id: "agent-1" }, "v2");
    expect(a).toEqual(b);
  });

  it("scopes a preset's chat to the visit and keeps it out of the database", () => {
    const thread = agentChatThread("seller", { kind: "preset", id: "hunter" }, "v1");
    expect(thread).toEqual({ storageId: "agent-studio:seller:preset:hunter:v1" });
    expect(agentChatThread("seller", { kind: "preset", id: "hunter" }, "v2").storageId).not.toBe(
      thread.storageId,
    );
  });

  it("keeps buyer and seller conversations apart", () => {
    expect(agentChatThread("buyer", { kind: "saved", id: "a" }, "v").storageId).not.toBe(
      agentChatThread("seller", { kind: "saved", id: "a" }, "v").storageId,
    );
  });

  it("makes a new visit id each time", () => {
    expect(newChatVisitId()).not.toBe(newChatVisitId());
  });
});

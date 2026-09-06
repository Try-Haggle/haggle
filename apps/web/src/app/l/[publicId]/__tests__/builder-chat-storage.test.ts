/**
 * Moving a thread's stored conversation.
 *
 * The Agent Studio re-keys a thread the moment Save turns a preset into a real
 * agent. These cover the part that lives outside React state.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { moveStoredSessions } from "../negotiation-agent-builder-chat";

const PREFIX = "haggle:strategy";
const FROM = "agent-studio:seller:preset:closer";
const TO = "agent-studio:seller:saved:agent-1";

beforeEach(() => {
  localStorage.clear();
});

describe("moveStoredSessions", () => {
  it("carries a thread's conversation to its new key", () => {
    localStorage.setItem(`${PREFIX}:${FROM}:closer`, '{"messages":["hi"]}');
    moveStoredSessions(FROM, TO);
    expect(localStorage.getItem(`${PREFIX}:${TO}:closer`)).toBe('{"messages":["hi"]}');
    expect(localStorage.getItem(`${PREFIX}:${FROM}:closer`)).toBeNull();
  });

  it("moves every agent stored under the namespace, not just one", () => {
    localStorage.setItem(`${PREFIX}:${FROM}:closer`, "a");
    localStorage.setItem(`${PREFIX}:${FROM}:hunter`, "b");
    moveStoredSessions(FROM, TO);
    expect(localStorage.getItem(`${PREFIX}:${TO}:closer`)).toBe("a");
    expect(localStorage.getItem(`${PREFIX}:${TO}:hunter`)).toBe("b");
  });

  it("leaves other threads and other apps' keys alone", () => {
    localStorage.setItem(`${PREFIX}:${FROM}:closer`, "mine");
    localStorage.setItem(`${PREFIX}:agent-studio:buyer:preset:closer:closer`, "other thread");
    localStorage.setItem("unrelated", "keep");
    moveStoredSessions(FROM, TO);
    expect(localStorage.getItem(`${PREFIX}:agent-studio:buyer:preset:closer:closer`)).toBe(
      "other thread",
    );
    expect(localStorage.getItem("unrelated")).toBe("keep");
  });

  it("does nothing when the namespace is unchanged", () => {
    localStorage.setItem(`${PREFIX}:${FROM}:closer`, "kept");
    moveStoredSessions(FROM, FROM);
    expect(localStorage.getItem(`${PREFIX}:${FROM}:closer`)).toBe("kept");
  });

  it("stays quiet when storage throws, since the saved memory already landed", () => {
    localStorage.setItem(`${PREFIX}:${FROM}:closer`, "x");
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => moveStoredSessions(FROM, TO)).not.toThrow();
    setItem.mockRestore();
  });
});

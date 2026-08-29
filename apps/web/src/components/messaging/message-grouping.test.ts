/**
 * Timestamp grouping for the message thread.
 *
 * The Django original computed this twice — server-side from a timezone cookie
 * and again in the browser to correct it. These tests pin the single
 * browser-local implementation that replaced both.
 */

import { describe, expect, it } from "vitest";
import type { Message } from "@/lib/messaging-api";
import {
  formatConversationTime,
  formatDateLabel,
  groupMessages,
  mergeMessages,
} from "./message-grouping";

function message(overrides: Partial<Message> & { createdAt: string }): Message {
  return {
    id: overrides.id ?? overrides.createdAt,
    senderId: overrides.senderId ?? "user-a",
    body: overrides.body ?? "hi",
    clientMessageId: overrides.clientMessageId ?? null,
    createdAt: overrides.createdAt,
  };
}

/** Local-time ISO builder, so the tests do not depend on the runner's zone. */
function at(y: number, mo: number, d: number, h: number, mi: number, s = 0): string {
  return new Date(y, mo - 1, d, h, mi, s).toISOString();
}

describe("groupMessages", () => {
  it("shows one timestamp per minute for a run from the same sender", () => {
    const grouped = groupMessages([
      message({ id: "1", createdAt: at(2026, 8, 29, 10, 0, 5) }),
      message({ id: "2", createdAt: at(2026, 8, 29, 10, 0, 40) }),
      message({ id: "3", createdAt: at(2026, 8, 29, 10, 1, 0) }),
    ]);

    expect(grouped.map((g) => g.showTimestamp)).toEqual([true, false, true]);
  });

  it("shows a timestamp again when the sender changes inside the same minute", () => {
    const grouped = groupMessages([
      message({ id: "1", senderId: "a", createdAt: at(2026, 8, 29, 10, 0, 5) }),
      message({ id: "2", senderId: "b", createdAt: at(2026, 8, 29, 10, 0, 30) }),
    ]);

    expect(grouped.map((g) => g.showTimestamp)).toEqual([true, true]);
    expect(grouped.map((g) => g.startsRun)).toEqual([true, true]);
  });

  it("puts a date divider on the first message of each local day", () => {
    const grouped = groupMessages([
      message({ id: "1", createdAt: at(2026, 8, 28, 23, 50) }),
      message({ id: "2", createdAt: at(2026, 8, 29, 0, 10) }),
      message({ id: "3", createdAt: at(2026, 8, 29, 9, 0) }),
    ]);

    expect(grouped.map((g) => g.showDate)).toEqual([true, true, false]);
  });

  it("breaks a same-sender run across a day boundary", () => {
    const grouped = groupMessages([
      message({ id: "1", senderId: "a", createdAt: at(2026, 8, 28, 23, 59) }),
      message({ id: "2", senderId: "a", createdAt: at(2026, 8, 29, 0, 1) }),
    ]);

    expect(grouped[1].startsRun).toBe(true);
  });

  it("handles an empty thread", () => {
    expect(groupMessages([])).toEqual([]);
  });
});

describe("formatDateLabel", () => {
  const now = new Date(2026, 7, 29, 12, 0);

  it("labels today and yesterday in words", () => {
    expect(formatDateLabel(at(2026, 8, 29, 9, 0), now)).toBe("Today");
    expect(formatDateLabel(at(2026, 8, 28, 9, 0), now)).toBe("Yesterday");
  });

  it("falls back to a full date", () => {
    expect(formatDateLabel(at(2026, 8, 20, 9, 0), now)).toBe("Aug 20, 2026");
  });
});

describe("formatConversationTime", () => {
  const now = new Date(2026, 7, 29, 12, 0);

  it("shows the time today and the date otherwise", () => {
    expect(formatConversationTime(at(2026, 8, 29, 9, 5), now)).toMatch(/9:05/);
    expect(formatConversationTime(at(2026, 8, 20, 9, 5), now)).toBe("8/20/26");
  });
});

describe("mergeMessages", () => {
  it("keeps the thread in chronological order", () => {
    const merged = mergeMessages(
      [message({ id: "b", createdAt: at(2026, 8, 29, 10, 1) })],
      [message({ id: "a", createdAt: at(2026, 8, 29, 10, 0) })],
    );

    expect(merged.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("replaces an optimistic bubble with the stored message", () => {
    const optimistic = message({
      id: "pending-c1",
      clientMessageId: "c1",
      createdAt: at(2026, 8, 29, 10, 0),
    });
    const stored = message({
      id: "real-id",
      clientMessageId: "c1",
      createdAt: at(2026, 8, 29, 10, 0),
    });

    const merged = mergeMessages([optimistic], [stored]);

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("real-id");
  });

  it("does not duplicate a message that arrives by realtime and by refetch", () => {
    const stored = message({ id: "m1", createdAt: at(2026, 8, 29, 10, 0) });
    expect(mergeMessages([stored], [stored])).toHaveLength(1);
  });

  it("breaks ties on id so the order is stable", () => {
    const sameTime = at(2026, 8, 29, 10, 0);
    const merged = mergeMessages(
      [message({ id: "b", createdAt: sameTime })],
      [message({ id: "a", createdAt: sameTime })],
    );

    expect(merged.map((m) => m.id)).toEqual(["a", "b"]);
  });
});

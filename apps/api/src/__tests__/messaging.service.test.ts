/**
 * Messaging service — the pure pieces (cursors, thread identity, previews) and
 * the subject → participant resolution that decides who may open a thread.
 */

import { sql } from "@haggle/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildParticipantKey,
  clampLimit,
  decodeCursor,
  encodeCursor,
  getUserDisplays,
  resolveSubjectParticipants,
  truncatePreview,
} from "../services/messaging.service.js";

const BUYER = "11111111-1111-4111-8111-111111111111";
const SELLER = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";
const SUBJECT_ID = "44444444-4444-4444-8444-444444444444";

function dbReturning(rows: unknown[]) {
  return { execute: vi.fn().mockResolvedValue(rows) } as unknown as Parameters<
    typeof resolveSubjectParticipants
  >[0];
}

describe("buildParticipantKey", () => {
  it("is order-independent so (a,b) and (b,a) are the same thread", () => {
    const subject = { type: "negotiation_session" as const, id: SUBJECT_ID };
    expect(buildParticipantKey([BUYER, SELLER], subject)).toBe(
      buildParticipantKey([SELLER, BUYER], subject),
    );
  });

  it("separates threads by subject", () => {
    const a = buildParticipantKey([BUYER, SELLER], {
      type: "negotiation_session",
      id: SUBJECT_ID,
    });
    const b = buildParticipantKey([BUYER, SELLER], { type: "order", id: SUBJECT_ID });
    expect(a).not.toBe(b);
  });

  it("separates different participant pairs", () => {
    const subject = { type: "negotiation_session" as const, id: SUBJECT_ID };
    expect(buildParticipantKey([BUYER, SELLER], subject)).not.toBe(
      buildParticipantKey([BUYER, STRANGER], subject),
    );
  });

  it("ignores id casing so a mixed-case uuid cannot fork the thread", () => {
    const subject = { type: "negotiation_session" as const, id: SUBJECT_ID };
    expect(buildParticipantKey([BUYER.toUpperCase(), SELLER], subject)).toBe(
      buildParticipantKey([BUYER, SELLER], subject),
    );
  });
});

describe("cursors", () => {
  it("round-trips", () => {
    const cursor = { createdAt: "2026-08-29T01:02:03.456Z", id: SUBJECT_ID };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("keeps the id half, which is what makes same-timestamp paging total", () => {
    const encoded = encodeCursor({ createdAt: "2026-08-29T01:02:03.456Z", id: SUBJECT_ID });
    expect(encoded.endsWith(SUBJECT_ID)).toBe(true);
  });

  it("rejects junk instead of paging from a bogus position", () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("no-separator")).toBeNull();
    expect(decodeCursor(`not-a-date_${SUBJECT_ID}`)).toBeNull();
    expect(decodeCursor("2026-08-29T01:02:03.456Z_not-a-uuid")).toBeNull();
  });
});

describe("clampLimit", () => {
  it("falls back and caps", () => {
    expect(clampLimit(undefined)).toBe(30);
    expect(clampLimit("0")).toBe(30);
    expect(clampLimit("abc")).toBe(30);
    expect(clampLimit("10")).toBe(10);
    expect(clampLimit("9999")).toBe(50);
    expect(clampLimit(undefined, 50)).toBe(50);
  });
});

describe("truncatePreview", () => {
  it("collapses whitespace so the list row stays one line", () => {
    expect(truncatePreview("  hello\n\n  world  ")).toBe("hello world");
  });

  it("truncates long bodies with an ellipsis", () => {
    const preview = truncatePreview("x".repeat(500));
    expect(preview.length).toBe(120);
    expect(preview.endsWith("…")).toBe(true);
  });
});

describe("resolveSubjectParticipants", () => {
  it("returns both sides of a negotiation session", async () => {
    const db = dbReturning([{ buyer_id: BUYER, seller_id: SELLER }]);
    await expect(
      resolveSubjectParticipants(db, { type: "negotiation_session", id: SUBJECT_ID }, BUYER),
    ).resolves.toEqual({ ok: true, participantIds: [BUYER, SELLER] });
  });

  it("works from either side", async () => {
    const db = dbReturning([{ buyer_id: BUYER, seller_id: SELLER }]);
    await expect(
      resolveSubjectParticipants(db, { type: "order", id: SUBJECT_ID }, SELLER),
    ).resolves.toMatchObject({ ok: true });
  });

  it("hides the subject from non-participants (404, not 403)", async () => {
    const db = dbReturning([{ buyer_id: BUYER, seller_id: SELLER }]);
    await expect(
      resolveSubjectParticipants(db, { type: "negotiation_session", id: SUBJECT_ID }, STRANGER),
    ).resolves.toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("refuses listings — messaging starts from a negotiation, not a listing", async () => {
    const db = dbReturning([]);
    await expect(
      resolveSubjectParticipants(db, { type: "listing", id: SUBJECT_ID }, BUYER),
    ).resolves.toEqual({ ok: false, reason: "UNSUPPORTED_SUBJECT" });
    expect((db as unknown as { execute: ReturnType<typeof vi.fn> }).execute).not.toHaveBeenCalled();
  });

  it("reports a missing subject", async () => {
    const db = dbReturning([]);
    await expect(
      resolveSubjectParticipants(db, { type: "negotiation_session", id: SUBJECT_ID }, BUYER),
    ).resolves.toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("refuses a self-conversation when both sides are the same account", async () => {
    const db = dbReturning([{ buyer_id: BUYER, seller_id: BUYER }]);
    await expect(
      resolveSubjectParticipants(db, { type: "negotiation_session", id: SUBJECT_ID }, BUYER),
    ).resolves.toEqual({ ok: false, reason: "UNSUPPORTED_SUBJECT" });
  });
});

describe("getUserDisplays SQL", () => {
  // The query runs against auth.users, so the DB is mocked here; what this pins
  // is the key precedence, which is where the avatar went missing: a photo
  // uploaded in settings is stored as custom_avatar_url, not avatar_url.
  // The shared test setup stubs `sql` to a no-op; make it return the template
  // text so the query itself can be asserted on.
  beforeAll(() => {
    (sql as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (strings: TemplateStringsArray) => strings.join("?"),
    );
  });
  afterAll(() => {
    (sql as unknown as ReturnType<typeof vi.fn>).mockReturnValue("");
  });

  it("reads the same metadata keys the app displays", async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const db = { execute } as unknown as Parameters<typeof getUserDisplays>[0];

    await getUserDisplays(db, [BUYER]);

    const query = JSON.stringify(execute.mock.calls[0][0]);
    expect(query).toContain("custom_avatar_url");
    expect(query).toContain("avatar_url");
    expect(query).toContain("display_name");
    expect(query).toContain("full_name");
  });

  it("skips the query when no id is a uuid", async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const db = { execute } as unknown as Parameters<typeof getUserDisplays>[0];

    await expect(getUserDisplays(db, ["not-a-uuid", ""])).resolves.toEqual(new Map());
    expect(execute).not.toHaveBeenCalled();
  });
});

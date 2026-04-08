/**
 * Unit tests for admin-inbox.service (Step 57).
 *
 * Uses the same fake chainable db pattern as
 * tag-promotion.service.test.ts, extended with orderBy/limit/offset
 * links to cover the listing queries.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock @haggle/db ────────────────────────────────────────────────
vi.mock("@haggle/db", () => {
  const col = (name: string) => ({ name });
  return {
    eq: (c: unknown, v: unknown) => ({ __op: "eq", c, v }),
    and: (...conds: unknown[]) => ({ __op: "and", conds }),
    gte: (c: unknown, v: unknown) => ({ __op: "gte", c, v }),
    inArray: (c: unknown, vs: unknown[]) => ({ __op: "inArray", c, vs }),
    asc: (c: unknown) => ({ __op: "asc", c }),
    desc: (c: unknown) => ({ __op: "desc", c }),
    tagPromotionRules: {
      category: col("category"),
      suggestionAutoPromoteCount: col("suggestion_auto_promote_count"),
    },
    tagSuggestions: {
      id: col("id"),
      status: col("status"),
      occurrenceCount: col("occurrence_count"),
      createdAt: col("created_at"),
    },
    disputeCases: {
      id: col("id"),
      status: col("status"),
      openedAt: col("opened_at"),
    },
    paymentIntents: {
      id: col("id"),
      status: col("status"),
      updatedAt: col("updated_at"),
    },
  };
});

import {
  getInboxDetail,
  getInboxSummary,
  listActiveDisputes,
  listFailedPayments,
  listPendingTags,
} from "../services/admin-inbox.service.js";

// ─── Fake DB ────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

interface FakeDb {
  calls: Array<{ op: string; payload?: unknown }>;
  selectResults: Row[][];
  select: (...a: unknown[]) => unknown;
  insert?: (...a: unknown[]) => unknown;
  update?: (...a: unknown[]) => unknown;
}

function createFakeDb(): FakeDb {
  const db: FakeDb = {
    calls: [],
    selectResults: [],
    select: () => {},
  };

  db.select = () => {
    const result = db.selectResults.shift() ?? [];
    db.calls.push({ op: "select" });
    type Chain = {
      from: (...a: unknown[]) => Chain;
      where: (...a: unknown[]) => Chain;
      orderBy: (...a: unknown[]) => Chain;
      limit: (n: number) => Chain;
      offset: (n: number) => Chain;
      then: (r: (v: Row[]) => unknown) => Promise<unknown>;
    };
    const chain: Chain = {
      from: () => chain,
      where: (cond) => {
        db.calls.push({ op: "select.where", payload: cond });
        return chain;
      },
      orderBy: (...args) => {
        db.calls.push({ op: "select.orderBy", payload: args });
        return chain;
      },
      limit: (n) => {
        db.calls.push({ op: "select.limit", payload: n });
        return chain;
      },
      offset: (n) => {
        db.calls.push({ op: "select.offset", payload: n });
        return chain;
      },
      then: (r) => Promise.resolve(r(result)),
    };
    return chain;
  };

  return db;
}

const asDb = (db: FakeDb) => db as unknown as never;

function defaultRuleRow(overrides: Partial<Row> = {}): Row {
  return {
    category: "default",
    suggestionAutoPromoteCount: 20,
    ...overrides,
  };
}

function tagRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "sug-1",
    label: "mint",
    normalizedLabel: "mint",
    occurrenceCount: 5,
    firstSeenListingId: null,
    createdAt: new Date("2026-04-01T00:00:00Z"),
    ...overrides,
  };
}

function disputeRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "d1",
    orderId: "o1",
    status: "OPEN",
    reasonCode: "item_not_received",
    openedBy: "buyer",
    openedAt: new Date("2026-04-01T00:00:00Z"),
    updatedAt: new Date("2026-04-02T00:00:00Z"),
    ...overrides,
  };
}

function paymentRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "p1",
    orderId: "o1",
    amountMinor: "1000",
    selectedRail: "stripe",
    providerContext: { error: "card_declined" },
    updatedAt: new Date("2026-04-02T00:00:00Z"),
    ...overrides,
  };
}

let db: FakeDb;
beforeEach(() => {
  db = createFakeDb();
});

// ─── getInboxSummary ────────────────────────────────────────────────

describe("getInboxSummary", () => {
  it("1. aggregates pending tags, auto-promote ready, disputes, and failed payments", async () => {
    // rule lookup
    db.selectResults.push([defaultRuleRow({ suggestionAutoPromoteCount: 10 })]);
    // pending tag suggestions
    db.selectResults.push([
      tagRow({ id: "s1", occurrenceCount: 5 }),
      tagRow({ id: "s2", occurrenceCount: 12 }),
      tagRow({ id: "s3", occurrenceCount: 20 }),
    ]);
    // disputes
    db.selectResults.push([
      { status: "OPEN" },
      { status: "OPEN" },
      { status: "UNDER_REVIEW" },
      { status: "WAITING_FOR_BUYER" },
      { status: "WAITING_FOR_SELLER" },
    ]);
    // failed payments
    db.selectResults.push([{ id: "p1" }, { id: "p2" }]);

    const summary = await getInboxSummary(asDb(db));
    expect(summary.tags.pending).toBe(3);
    expect(summary.tags.autoPromoteReady).toBe(2);
    expect(summary.disputes.open).toBe(2);
    expect(summary.disputes.underReview).toBe(1);
    expect(summary.disputes.waiting).toBe(2);
    expect(summary.payments.failed).toBe(2);
    expect(typeof summary.computedAt).toBe("string");
  });

  it("2. returns zeros when everything is empty", async () => {
    db.selectResults.push([defaultRuleRow()]); // rule
    db.selectResults.push([]); // tags
    db.selectResults.push([]); // disputes
    db.selectResults.push([]); // payments

    const s = await getInboxSummary(asDb(db));
    expect(s.tags).toEqual({ pending: 0, autoPromoteReady: 0 });
    expect(s.disputes).toEqual({ open: 0, underReview: 0, waiting: 0 });
    expect(s.payments).toEqual({ failed: 0 });
  });

  it("3. when no default rule exists, autoPromoteReady is 0 and does not throw", async () => {
    db.selectResults.push([]); // no rule
    db.selectResults.push([
      tagRow({ id: "s1", occurrenceCount: 9999 }),
    ]);
    db.selectResults.push([]);
    db.selectResults.push([]);

    const s = await getInboxSummary(asDb(db));
    expect(s.tags.pending).toBe(1);
    expect(s.tags.autoPromoteReady).toBe(0);
  });
});

// ─── listPendingTags ────────────────────────────────────────────────

describe("listPendingTags", () => {
  it("4. returns rows mapped to TagInboxItem in the order the db provides", async () => {
    db.selectResults.push([defaultRuleRow({ suggestionAutoPromoteCount: 10 })]);
    db.selectResults.push([
      tagRow({ id: "s1", label: "a", occurrenceCount: 30 }),
      tagRow({ id: "s2", label: "b", occurrenceCount: 20 }),
      tagRow({ id: "s3", label: "c", occurrenceCount: 5 }),
    ]);

    const items = await listPendingTags(asDb(db));
    expect(items.map((i) => i.id)).toEqual(["s1", "s2", "s3"]);

    // orderBy was invoked with desc(occurrence_count), asc(created_at)
    const orderCall = db.calls.find((c) => c.op === "select.orderBy");
    expect(orderCall).toBeDefined();
    const orderArgs = orderCall!.payload as Array<{
      __op: string;
      c: { name: string };
    }>;
    expect(Array.isArray(orderArgs)).toBe(true);
    const descMarker = orderArgs.find(
      (a) => a.__op === "desc" && a.c.name === "occurrence_count",
    );
    const ascMarker = orderArgs.find(
      (a) => a.__op === "asc" && a.c.name === "created_at",
    );
    expect(descMarker).toBeDefined();
    expect(ascMarker).toBeDefined();
  });

  it("5. computes autoPromoteEligible against the default rule threshold", async () => {
    db.selectResults.push([defaultRuleRow({ suggestionAutoPromoteCount: 10 })]);
    db.selectResults.push([
      tagRow({ id: "s1", occurrenceCount: 9 }),
      tagRow({ id: "s2", occurrenceCount: 10 }),
      tagRow({ id: "s3", occurrenceCount: 50 }),
    ]);

    const items = await listPendingTags(asDb(db));
    expect(items[0]!.autoPromoteEligible).toBe(false);
    expect(items[1]!.autoPromoteEligible).toBe(true);
    expect(items[2]!.autoPromoteEligible).toBe(true);
  });

  it("6. respects limit and offset", async () => {
    db.selectResults.push([defaultRuleRow()]);
    db.selectResults.push([tagRow()]);

    await listPendingTags(asDb(db), { limit: 5, offset: 10 });

    const limitCall = db.calls.find((c) => c.op === "select.limit");
    const offsetCall = db.calls.find((c) => c.op === "select.offset");
    expect(limitCall?.payload).toBe(5);
    expect(offsetCall?.payload).toBe(10);
  });
});

// ─── listActiveDisputes ─────────────────────────────────────────────

describe("listActiveDisputes", () => {
  it("7. queries dispute_cases filtered to active statuses", async () => {
    db.selectResults.push([
      disputeRow({ id: "d1", status: "OPEN" }),
      disputeRow({ id: "d2", status: "UNDER_REVIEW" }),
    ]);

    const items = await listActiveDisputes(asDb(db));
    expect(items).toHaveLength(2);
    expect(items[0]!.id).toBe("d1");

    const whereCall = db.calls.find((c) => c.op === "select.where");
    expect(whereCall).toBeDefined();
    // whereCall.payload is our { __op: "inArray", ... } object.
    const payload = whereCall!.payload as {
      __op: string;
      vs: string[];
    };
    expect(payload.__op).toBe("inArray");
    expect(payload.vs).toEqual([
      "OPEN",
      "UNDER_REVIEW",
      "WAITING_FOR_BUYER",
      "WAITING_FOR_SELLER",
    ]);

    // orderBy was invoked with desc(opened_at)
    const orderCall = db.calls.find((c) => c.op === "select.orderBy");
    expect(orderCall).toBeDefined();
    const orderArgs = orderCall!.payload as Array<{
      __op: string;
      c: { name: string };
    }>;
    const descOpenedAt = orderArgs.find(
      (a) => a.__op === "desc" && a.c.name === "opened_at",
    );
    expect(descOpenedAt).toBeDefined();
  });

  it("8. applies optional active status filter via a plain eq clause", async () => {
    db.selectResults.push([disputeRow({ status: "UNDER_REVIEW" })]);

    await listActiveDisputes(asDb(db), { status: "UNDER_REVIEW" });

    const whereCall = db.calls.find((c) => c.op === "select.where");
    const payload = whereCall!.payload as { __op: string; v?: string };
    expect(payload.__op).toBe("eq");
    expect(payload.v).toBe("UNDER_REVIEW");
  });

});

// ─── listFailedPayments ─────────────────────────────────────────────

describe("listFailedPayments", () => {
  it("9. queries payment_intents with status=FAILED and maps provider error", async () => {
    db.selectResults.push([
      paymentRow({ id: "p1", providerContext: { error: "card_declined" } }),
      paymentRow({
        id: "p2",
        providerContext: { failureReason: "insufficient_funds" },
      }),
      paymentRow({ id: "p3", providerContext: null }),
    ]);

    const items = await listFailedPayments(asDb(db));
    expect(items).toHaveLength(3);
    expect(items[0]!.providerError).toBe("card_declined");
    expect(items[1]!.providerError).toBe("insufficient_funds");
    expect(items[2]!.providerError).toBeNull();
    expect(items[0]!.amountMinor).toBe(1000);

    const whereCall = db.calls.find((c) => c.op === "select.where");
    const payload = whereCall!.payload as { __op: string; v: string };
    expect(payload.__op).toBe("eq");
    expect(payload.v).toBe("FAILED");
  });
});

// ─── getInboxDetail ─────────────────────────────────────────────────

describe("getInboxDetail", () => {
  it("10. tag detail returns mapped item when row exists", async () => {
    db.selectResults.push([tagRow({ id: "sug-1", occurrenceCount: 42 })]);
    db.selectResults.push([defaultRuleRow({ suggestionAutoPromoteCount: 10 })]);

    const detail = await getInboxDetail(asDb(db), "tag", "sug-1");
    expect(detail).not.toBeNull();
    expect(detail!.type).toBe("tag");
    if (detail!.type === "tag") {
      expect(detail!.item.id).toBe("sug-1");
      expect(detail!.item.autoPromoteEligible).toBe(true);
    }
  });

  it("11. tag detail returns null when not found", async () => {
    db.selectResults.push([]); // no row
    const detail = await getInboxDetail(asDb(db), "tag", "missing");
    expect(detail).toBeNull();
  });

  it("12. dispute and payment details exercise the polymorphic switch", async () => {
    // dispute
    db.selectResults.push([disputeRow({ id: "d1" })]);
    const d = await getInboxDetail(asDb(db), "dispute", "d1");
    expect(d?.type).toBe("dispute");
    if (d?.type === "dispute") {
      expect(d.item.id).toBe("d1");
      expect(d.item.reasonCode).toBe("item_not_received");
    }

    // payment
    db.selectResults.push([paymentRow({ id: "p1" })]);
    const p = await getInboxDetail(asDb(db), "payment", "p1");
    expect(p?.type).toBe("payment");
    if (p?.type === "payment") {
      expect(p.item.id).toBe("p1");
      expect(p.item.rail).toBe("stripe");
    }
  });
});

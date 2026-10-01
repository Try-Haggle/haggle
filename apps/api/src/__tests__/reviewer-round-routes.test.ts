vi.unmock("@haggle/db");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../middleware/require-auth.js", () => ({
  requireAuth: async (request: { user: unknown }) => {
    request.user = { id: "reviewer-1" };
  },
  requireAdmin: async () => {},
}));
vi.mock("../services/dispute-record.service.js", () => ({
  getDisputeById: vi.fn(),
  getDisputeEvidenceUploadByEvidenceId: vi.fn().mockResolvedValue(null),
}));
vi.mock("../services/dispute-storage.service.js", () => ({
  createDisputeViewUrl: vi.fn().mockResolvedValue("https://storage.example/signed-evidence"),
}));
vi.mock("../services/payment-record.service.js", () => ({ getCommerceOrderByOrderId: vi.fn() }));
vi.mock("../services/dispute-panel-evaluate.service.js", () => ({ evaluateDisputePanel: vi.fn() }));
vi.mock("../services/dispute-review-round.service.js", async (original) => ({
  ...(await original<typeof import("../services/dispute-review-round.service.js")>()),
  withReviewRoundLock: async (db: unknown, _id: string, run: (db: unknown) => unknown) => run(db),
}));

import { assignReviewersToDispute, registerReviewerRoutes } from "../routes/reviewer.js";
import { evaluateDisputePanel } from "../services/dispute-panel-evaluate.service.js";
import {
  getDisputeById,
  getDisputeEvidenceUploadByEvidenceId,
} from "../services/dispute-record.service.js";
import { createDisputeViewUrl } from "../services/dispute-storage.service.js";

function mockDb(rows: unknown[][]) {
  const writes: unknown[] = [];
  return {
    writes,
    select: () => ({ from: () => ({ where: async () => rows.shift() ?? [] }) }),
    update: () => ({
      set: (value: unknown) => {
        writes.push(value);
        return { where: async () => {} };
      },
    }),
  };
}
async function vote(rows: unknown[][], payload = { vote: 75, expected_tier: 2 }) {
  const db = mockDb(rows);
  const app = Fastify();
  registerReviewerRoutes(app, db as never);
  const response = await app.inject({
    method: "POST",
    url: "/reviewer/assignments/d1/vote",
    payload,
  });
  await app.close();
  return { response, db };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDisputeById).mockResolvedValue({
    id: "d1",
    order_id: "o1",
    status: "UNDER_REVIEW",
    metadata: { tier: 2, review_phase: "ACTIVE" },
  } as never);
  vi.mocked(evaluateDisputePanel).mockResolvedValue({ evaluation: { ready: true } } as never);
});
describe("tier-bound reviewer voting", () => {
  it("accepts the real UI payload and releases exactly one slot", async () => {
    const { response, db } = await vote([
      [{ id: "a1", tier: 2, voteValue: null, slotCost: 1 }],
      [{ id: "a1", voteValue: 75 }],
    ]);
    expect(response.statusCode).toBe(200);
    expect(response.json().assignment.vote_value).toBe(75);
    expect(db.writes).toHaveLength(2);
    expect(evaluateDisputePanel).toHaveBeenCalledOnce();
  });
  it("does not evaluate before other reviewers vote", async () => {
    const { response } = await vote([
      [{ id: "a1", tier: 2, voteValue: null, slotCost: 1 }],
      [
        { id: "a1", voteValue: 75 },
        { id: "a2", voteValue: null },
      ],
    ]);
    expect(response.json().all_voted).toBe(false);
    expect(evaluateDisputePanel).not.toHaveBeenCalled();
  });
  it("rejects an unassigned user", async () => {
    const { response, db } = await vote([[]]);
    expect(response.statusCode).toBe(403);
    expect(db.writes).toHaveLength(0);
  });
  it("does not overwrite a submitted vote", async () => {
    const { response, db } = await vote([[{ id: "a1", voteValue: 20 }]]);
    expect(response.json().error).toBe("ALREADY_VOTED");
    expect(db.writes).toHaveLength(0);
  });
  it("rejects a T2 vote after the case advanced to T3", async () => {
    vi.mocked(getDisputeById).mockResolvedValue({
      id: "d1",
      status: "UNDER_REVIEW",
      metadata: { tier: 3 },
    } as never);
    const { response, db } = await vote([]);
    expect(response.json().error).toBe("REVIEW_TIER_CHANGED");
    expect(db.writes).toHaveLength(0);
  });
  it("rejects voting on a settled case", async () => {
    vi.mocked(getDisputeById).mockResolvedValue({
      id: "d1",
      status: "CLOSED",
      metadata: { tier: 2, review_phase: "ACTIVE" },
    } as never);
    const { response, db } = await vote([[{ id: "a1", voteValue: null }]]);
    expect(response.json().error).toBe("VOTING_CLOSED");
    expect(db.writes).toHaveLength(0);
  });
  it("rejects the old incompatible vote_pct payload", async () => {
    const { response } = await vote([], { vote_pct: 70, expected_tier: 2 } as never);
    expect(response.statusCode).toBe(400);
  });
});

describe("reviewer assignment retries", () => {
  it("does not add jurors or consume slots when a panel is full", async () => {
    const db = mockDb([Array.from({ length: 5 }, (_, i) => ({ tier: 2, reviewerId: `r${i}` }))]);
    const result = await assignReviewersToDispute(db as never, "d1", 2, 50000, "buyer", "seller");
    expect(result.assigned).toBe(5);
    expect(db.writes).toEqual([expect.objectContaining({ status: "UNDER_REVIEW" })]);
  });
  it("refuses assigning a stale tier", async () => {
    const db = mockDb([]);
    await expect(
      assignReviewersToDispute(db as never, "d1", 3, 50000, "buyer", "seller"),
    ).rejects.toThrow("REVIEW_TIER_CHANGED");
    expect(db.writes).toHaveLength(0);
  });
});

it("does not grant evidence access to an unassigned user", async () => {
  const app = Fastify();
  registerReviewerRoutes(app, mockDb([[]]) as never);
  const response = await app.inject({ url: "/reviewer/assignments/d1/evidence/e1/view" });
  expect(response.statusCode).toBe(403);
  await app.close();
});

it("signs only evidence paths belonging to the assigned dispute", async () => {
  const app = Fastify();
  registerReviewerRoutes(
    app,
    mockDb([[{ id: "a1" }], [{ uri: "dispute-evidence/d1/photo.jpg" }]]) as never,
  );
  const response = await app.inject({ url: "/reviewer/assignments/d1/evidence/e1/view" });
  expect(response.statusCode).toBe(200);
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(createDisputeViewUrl).toHaveBeenCalledWith("d1/photo.jpg");
  await app.close();
});
it("rejects a path from another dispute even for an assigned reviewer", async () => {
  const app = Fastify();
  registerReviewerRoutes(
    app,
    mockDb([[{ id: "a1" }], [{ uri: "dispute-evidence/d2/photo.jpg" }]]) as never,
  );
  const response = await app.inject({ url: "/reviewer/assignments/d1/evidence/e1/view" });
  expect(response.statusCode).toBe(400);
  expect(createDisputeViewUrl).not.toHaveBeenCalled();
  await app.close();
});
it("does not issue a URL for deleted evidence", async () => {
  vi.mocked(getDisputeEvidenceUploadByEvidenceId).mockResolvedValueOnce({
    retentionStatus: "DELETED",
  } as never);
  const app = Fastify();
  registerReviewerRoutes(
    app,
    mockDb([[{ id: "a1" }], [{ uri: "dispute-evidence/d1/photo.jpg" }]]) as never,
  );
  const response = await app.inject({ url: "/reviewer/assignments/d1/evidence/e1/view" });
  expect(response.statusCode).toBe(410);
  expect(createDisputeViewUrl).not.toHaveBeenCalled();
  await app.close();
});

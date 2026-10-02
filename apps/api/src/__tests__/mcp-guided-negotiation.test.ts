import { beforeEach, describe, expect, it, vi } from "vitest";

const SELLER_SNAPSHOT = {
  negotiationAgentBuilderMemory: {
    categoryCriteria: [
      {
        checkId: "imei_verification",
        questionKo: "IMEI?",
        buyerAskKo: "IMEI 확인 가능한가요?",
        enforcement: "hard",
        requirement: "required",
        stance: "clean IMEI",
      },
    ],
  },
};
const LISTING = {
  id: "11111111-1111-4111-8111-111111111111",
  publicId: "jc6r2T3d",
  title: "iPhone 14",
  description: "Great phone",
  category: "electronics/phones",
  condition: "good",
  targetPrice: "500",
  photoUrl: null,
  tags: ["iphone"],
  negotiationAgentSnapshot: SELLER_SNAPSHOT,
};
const ACTOR = {
  id: "00000000-0000-4000-a000-000000000010",
  role: "user",
  tokenKind: "mcp" as const,
  scopes: ["negotiate", "agents", "listings", "orders", "disputes"],
};
const SESSION_ID = "22222222-2222-4222-8222-222222222222";

const getListing = vi.fn();
const startBuyer = vi.fn();
const builderTurn = vi.fn();
const autoPlay = vi.fn();
const getRounds = vi.fn();
const userInfo = vi.fn();

vi.mock("@haggle/db", async (orig) => ({
  ...(await orig<typeof import("@haggle/db")>()),
  negotiationAgents: {
    id: "id",
    userId: "userId",
    isSystem: "isSystem",
    role: "role",
  },
  and: (...a: unknown[]) => a,
  eq: (...a: unknown[]) => a,
  or: (...a: unknown[]) => a,
  inArray: (...a: unknown[]) => a,
}));
vi.mock("../services/draft.service.js", () => ({
  getPublishedListingByPublicId: (...a: unknown[]) => getListing(...a),
  getDraftById: vi.fn(),
  createAndPublishOwnedListing: vi.fn(),
  listPublishedListings: vi.fn(),
  setOwnedListingPhoto: vi.fn(),
}));
vi.mock("../services/start-buyer-negotiation.service.js", async (orig) => ({
  ...(await orig<typeof import("../services/start-buyer-negotiation.service.js")>()),
  startBuyerNegotiation: (...a: unknown[]) => startBuyer(...a),
}));
vi.mock("../services/negotiation-agent-builder-chat.service.js", async (orig) => ({
  ...(await orig<typeof import("../services/negotiation-agent-builder-chat.service.js")>()),
  processNegotiationAgentBuilderTurn: (...a: unknown[]) => builderTurn(...a),
}));
vi.mock("../services/execute-auto-play-next.service.js", () => ({
  executeAutoPlayNext: (...a: unknown[]) => autoPlay(...a),
}));
vi.mock("../services/negotiation-round.service.js", () => ({
  getRoundsBySessionId: (...a: unknown[]) => getRounds(...a),
  recordPauseAnswersOnRound: vi.fn(),
}));
vi.mock("../notification/get-user-info.js", () => ({
  getNotificationUserInfo: (...a: unknown[]) => userInfo(...a),
}));

const { registerPlatformTools } = await import("../mcp/tools/platform.js");
const { runWithMcpActor } = await import("../lib/mcp-actor.js");

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[] }>;
const handlers = new Map<string, Handler>();
const server = {
  tool: (name: string, ...rest: unknown[]) => handlers.set(name, rest.at(-1) as Handler),
  registerTool: (name: string, _def: unknown, h: Handler) => handlers.set(name, h),
};

// Saved agent lookups: chain .select().from().where().limit()/await
let agentRows: unknown[] = [];
const db = {
  select: () => ({
    from: () => ({
      where: () => Object.assign(Promise.resolve(agentRows), { limit: async () => agentRows }),
    }),
  }),
  update: () => ({ set: () => ({ where: async () => undefined }) }),
};

async function call(name: string, args: Record<string, unknown>) {
  const res = await runWithMcpActor(ACTOR, () => handlers.get(name)!(args));
  return JSON.parse(res.content[0]!.text) as Record<string, any>;
}

beforeEach(() => {
  vi.clearAllMocks();
  agentRows = [];
  getListing.mockResolvedValue(LISTING);
  registerPlatformTools(server as never, db as never);
});

describe("haggle_prepare_negotiation", () => {
  it("returns must-answer criteria, tag questions, price questions, presets and fulfillment", async () => {
    agentRows = [
      { id: "a1", name: "My hunter", description: null, role: "buyer", isSystem: false },
      { id: "a2", name: "Seller only", description: null, role: "seller", isSystem: false },
    ];
    const out = await call("haggle_prepare_negotiation", { public_id: "jc6r2T3d" });
    expect(out.required_criteria).toEqual([
      expect.objectContaining({ checkId: "imei_verification", must_answer: true }),
    ]);
    expect(Array.isArray(out.tag_questions)).toBe(true);
    expect(out.price_questions.map((q: { field: string }) => q.field)).toEqual([
      "targetPrice",
      "budgetMax",
    ]);
    expect(out.presets.map((p: { id: string }) => p.id)).toContain("hunter");
    expect(out.saved_agents).toEqual([{ id: "a1", name: "My hunter", description: null }]);
    expect(out.fulfillment_choices[0].method).toBe("carrier");
    expect(out.instruction).toMatch(/required_criteria/);
    expect(out.modes.consult).toMatch(/haggle_play_next/);
    expect(out.modes.delegate).toMatch(/haggle_play_until/);
  });

  it("404s an unknown listing", async () => {
    getListing.mockResolvedValue(null);
    expect((await call("haggle_prepare_negotiation", { public_id: "nope" })).error).toBe(
      "LISTING_NOT_FOUND",
    );
  });
});

describe("haggle_builder_chat_turn with public_id", () => {
  it("server-fills listing context and returns builder_memory", async () => {
    builderTurn.mockResolvedValue({ reply: "hi", memory: { budgetMax: 420 } });
    const out = await call("haggle_builder_chat_turn", {
      public_id: "jc6r2T3d",
      message: "I want it cheap",
    });
    const input = builderTurn.mock.calls[0]![0];
    expect(input.listings[0]).toMatchObject({
      askPriceMinor: 50000,
      title: "iPhone 14",
      tags: ["iphone"],
    });
    expect(input.seller_required_criteria).toEqual([
      { checkId: "imei_verification", ask: "IMEI 확인 가능한가요?" },
    ]);
    expect(input.previous_memory.riskStyle).toBe("balanced");
    expect(out.builder_memory).toEqual({ budgetMax: 420 });
  });
});

describe("haggle_start_negotiation web parity", () => {
  beforeEach(() => {
    startBuyer.mockResolvedValue({ ok: true, body: { session_id: SESSION_ID, status: "ACTIVE" } });
  });

  it("passes memory, weights, overrides, control mode and fulfillment through", async () => {
    const out = await call("haggle_start_negotiation", {
      public_id: "jc6r2T3d",
      buyerCriteria: [{ checkId: "imei_verification", stance: "clean" }],
      builder_memory: { budgetMax: 420, targetPrice: 380 },
      agent_weights: { w_p: 0.6, w_t: 0.1, w_r: 0.2, w_s: 0.1 },
      agent_overrides: { alpha: 0.5 },
      buyer_control_mode: "manual",
      fulfillment: { methods: ["carrier"], preferred: "carrier" },
    });
    const body = startBuyer.mock.calls[0]![1].body;
    expect(body.negotiation_agent_builder_memory).toMatchObject({
      budgetMax: 420,
      targetPrice: 380,
    });
    expect(body.agent_weights.w_p).toBe(0.6);
    expect(body.agent_overrides).toEqual({ alpha: 0.5 });
    expect(body.buyer_control_mode).toBe("manual");
    expect(body.fulfillment.methods).toEqual(["carrier"]);
    expect(out.session_id).toBe(SESSION_ID);
    expect(out.mode_guidance.consult).toMatch(/haggle_play_next/);
  });

  it("applies a saved agent's stored memory and weights, explicit input wins", async () => {
    agentRows = [
      {
        id: "33333333-3333-4333-8333-333333333333",
        name: "Mine",
        isSystem: false,
        userId: ACTOR.id,
        negotiationAgentConfig: {
          basePresetId: "hunter",
          weights: { w_p: 0.7, w_t: 0.1, w_r: 0.1, w_s: 0.1 },
          builderChatMemory: { budgetMax: 300, mustHave: ["box"] },
        },
      },
    ];
    await call("haggle_start_negotiation", {
      public_id: "jc6r2T3d",
      agent_id: "33333333-3333-4333-8333-333333333333",
    });
    let body = startBuyer.mock.calls[0]![1].body;
    expect(body.negotiation_agent_preset_id).toBe("hunter");
    expect(body.negotiation_agent_builder_memory).toMatchObject({ budgetMax: 300 });
    expect(body.agent_weights.w_p).toBe(0.7);

    await call("haggle_start_negotiation", {
      public_id: "jc6r2T3d",
      agent_id: "33333333-3333-4333-8333-333333333333",
      builder_memory: { budgetMax: 250 },
    });
    body = startBuyer.mock.calls[1]![1].body;
    expect(body.negotiation_agent_builder_memory.budgetMax).toBe(250);
  });

  it("keeps missing required criteria a 409", async () => {
    startBuyer.mockResolvedValue({
      ok: false,
      status: 409,
      body: { error: "BUYER_CRITERIA_REQUIRED", required_criteria: [] },
    });
    const out = await call("haggle_start_negotiation", { public_id: "jc6r2T3d" });
    expect(out.error).toBe("BUYER_CRITERIA_REQUIRED");
  });
});

describe("haggle_play_until", () => {
  it("returns a per-round transcript summary and chat_url", async () => {
    autoPlay
      .mockResolvedValueOnce({ ok: true, body: { complete: false } })
      .mockResolvedValueOnce({ ok: true, body: { complete: true, session_status: "ACCEPTED" } });
    getRounds.mockResolvedValue([
      {
        roundNo: 1,
        senderRole: "BUYER",
        message: "How about $400?",
        decision: "COUNTER",
        priceminor: "40000",
        counterPriceMinor: null,
        metadata: null,
      },
      {
        roundNo: 2,
        senderRole: "SELLER",
        message: "I can do $450.",
        decision: "COUNTER",
        priceminor: "45000",
        counterPriceMinor: null,
        metadata: null,
      },
    ]);
    const out = await call("haggle_play_until", { session_id: SESSION_ID });
    expect(autoPlay).toHaveBeenCalledTimes(2);
    expect(out.chat_url).toContain(SESSION_ID);
    expect(out.transcript_summary.length).toBeGreaterThan(0);
    expect(out.transcript_summary[0]).toEqual(
      expect.objectContaining({ who: expect.any(String), line: expect.any(String) }),
    );
    expect(out.complete).toBe(true);
  });
});

describe("haggle_whoami", () => {
  it("returns own email, display name and my deals url", async () => {
    userInfo.mockResolvedValue({ email: "me@example.com", displayName: "Me" });
    const out = await call("haggle_whoami", {});
    expect(userInfo).toHaveBeenCalledWith(db, ACTOR.id);
    expect(out).toMatchObject({
      connected: true,
      email: "me@example.com",
      display_name: "Me",
    });
    expect(out.my_deals_url).toMatch(/\/buy\/dashboard$/);
  });
});

describe("negotiationSummaryMarkdown / listingImageMarkdown", () => {
  it("builds a round table with status and chat link", async () => {
    const { negotiationSummaryMarkdown, listingImageMarkdown } = await import(
      "../mcp/tools/mcp-negotiation-prep.js"
    );
    const msg = (
      round_no: number,
      speaker: "BUYER" | "SELLER",
      price_minor: number,
      message: string,
    ) => ({ round_no, speaker, price_minor, message }) as never;
    const md = negotiationSummaryMarkdown(
      [msg(1, "SELLER", 50000, "Asking $500"), msg(1, "BUYER", 40000, "How about 400 | ok")],
      "ACTIVE",
      "https://app/chat/1",
    );
    expect(md).toContain("| round | seller offer | my offer | note |");
    expect(md).toContain("| 1 | $500.00 | $400.00 | Asking $500 |");
    expect(md).toContain("Status: ACTIVE · [Open chat](https://app/chat/1)");
    expect(listingImageMarkdown("T", null)).toBeNull();
    expect(listingImageMarkdown("T", "https://x/y.png")).toBe("![T](https://x/y.png)");
  });
});

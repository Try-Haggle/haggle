/**
 * Test setup for API integration tests.
 *
 * Mocks @haggle/db so createServer() can run without a real database.
 * Individual service mocks are applied per-test file using vi.mock().
 */
import { vi } from "vitest";

process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/haggle_test";

// ─── Mock @haggle/db ─────────────────────────────────────────────────
// createServer() validates DATABASE_URL before calling createDb(), which would
// try to connect to PostgreSQL. We intercept it and return a proxy object
// that returns undefined/empty for all query operations.
function createMockQueryProxy(): unknown {
  return new Proxy(
    {},
    {
      get(_target, _prop) {
        // db.query.<table> returns an object with findFirst, findMany, etc.
        return {
          findFirst: vi.fn().mockResolvedValue(null),
          findMany: vi.fn().mockResolvedValue([]),
        };
      },
    },
  );
}

function createMockInsert() {
  return vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "mock-id" }]),
      }),
      returning: vi.fn().mockResolvedValue([]),
    }),
  });
}

vi.mock("@haggle/db", () => ({
  createDb: vi.fn(() => ({
    query: createMockQueryProxy(),
    select: vi.fn().mockReturnValue({ from: vi.fn().mockResolvedValue([]) }),
    insert: createMockInsert(),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    execute: vi.fn().mockResolvedValue([]),
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => fn({
      execute: vi.fn().mockResolvedValue([]),
      query: createMockQueryProxy(),
      select: vi.fn().mockReturnValue({ from: vi.fn().mockResolvedValue([]) }),
      insert: createMockInsert(),
      update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    })),
  })),
  sql: vi.fn().mockReturnValue(""),
  eq: vi.fn(),
  and: vi.fn(),
  or: vi.fn(),
  asc: vi.fn(),
  desc: vi.fn(),
  gt: vi.fn(),
  gte: vi.fn(),
  lt: vi.fn(),
  lte: vi.fn(),
  isNull: vi.fn(),
  inArray: vi.fn(),
  settlementApprovals: {},
  negotiationSessions: {},
  negotiationCheckpoints: {},
  negotiationRoundFacts: {},
  llmTelemetry: {},
  trustScores: { actorId: {}, score: {}, actorRole: {} },
  hfmiPriceObservations: {},
  hfmiModelCoefficients: {},
  sellerAttestationCommits: {},
  // Table references used directly in route handlers (not via services)
  webhookIdempotency: { id: "id", idempotencyKey: "idempotencyKey", source: "source", responseStatus: "responseStatus" },
  refunds: { id: "id", paymentIntentId: "paymentIntentId", status: "status" },
  disputeResolutions: { disputeId: "disputeId" },
  disputeCases: { id: "id" },
  commerceOrders: { id: "id" },
  shipments: { id: "id", trackingNumber: "trackingNumber" },
  shipmentEvents: { shipmentId: "shipmentId" },
  settlementReleases: { id: "id" },
  userWallets: { walletAddress: "walletAddress", userId: "userId", network: "network", isPrimary: "isPrimary" },
}));

// ─── Mock MCP SDK ────────────────────────────────────────────────────
// registerMcpRoutes imports from deep paths in @modelcontextprotocol/sdk.
vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: vi.fn().mockImplementation(() => ({
    tool: vi.fn(),
    resource: vi.fn(),
    connect: vi.fn(),
  })),
}));

vi.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
  StreamableHTTPServerTransport: vi.fn().mockImplementation(() => ({
    handleRequest: vi.fn(),
    close: vi.fn(),
  })),
}));

// ─── Mock payment-core heavy subpath exports ────────────────────────
// These are not resolvable by Vite without the full build.
vi.mock("@haggle/payment-core/heavy/real-x402-adapter", () => ({
  RealX402Adapter: vi.fn(),
}));

vi.mock("@haggle/payment-core/heavy/viem-contracts", () => ({
  ViemDisputeRegistryContract: vi.fn(),
  ViemSettlementRouterContract: vi.fn(),
}));

// ─── Mock viem (heavy crypto dependency) ─────────────────────────────
vi.mock("viem", () => ({
  createPublicClient: vi.fn(),
  createWalletClient: vi.fn(),
  http: vi.fn(),
}));

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: vi.fn(),
}));

vi.mock("viem/chains", () => ({
  base: { id: 8453 },
  baseSepolia: { id: 84532 },
}));

// ─── Patch @haggle/shipping-core ─────────────────────────────────────
// The barrel (index.ts) doesn't export MockCarrierAdapter, EasyPostCarrierAdapter,
// computeWeightBuffer, verifyEasyPostWebhook, parseEasyPostWebhookPayload,
// or parseEasyPostInvoicePayload. Routes import them from the package but
// they are only in non-barrel source files. Provide stubs for the missing exports.
vi.mock("@haggle/shipping-core", async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return {
    ...real,
    MockCarrierAdapter: class MockCarrierAdapter {
      createLabel = vi.fn().mockResolvedValue({ tracking_number: "MOCK123", label_url: "https://mock" });
      getTrackingInfo = vi.fn().mockResolvedValue({ status: "IN_TRANSIT" });
    },
    EasyPostCarrierAdapter: class EasyPostCarrierAdapter {
      constructor(_opts: unknown) {}
      createLabel = vi.fn().mockResolvedValue({ tracking_number: "EP123", label_url: "https://ep" });
      getTrackingInfo = vi.fn().mockResolvedValue({ status: "IN_TRANSIT" });
    },
    computeWeightBuffer: (weightOz: number) => ({
      declared_weight_oz: weightOz,
      buffer_weight_oz: Math.ceil(weightOz * 0.1),
      buffer_amount_minor: Math.ceil(weightOz * 5),
    }),
    verifyEasyPostWebhook: vi.fn().mockReturnValue(true),
    parseEasyPostWebhookPayload: vi.fn((body: unknown) => {
      const result = (body as { result?: Record<string, unknown> } | null)?.result;
      if (!result?.tracking_code || !result.status || !result.carrier) return null;
      const statusMap: Record<string, string> = {
        pre_transit: "LABEL_CREATED",
        in_transit: "IN_TRANSIT",
        out_for_delivery: "OUT_FOR_DELIVERY",
        delivered: "DELIVERED",
        failure: "DELIVERY_EXCEPTION",
        return_to_sender: "RETURN_IN_TRANSIT",
        returned: "RETURNED",
      };
      return {
        tracking_code: result.tracking_code,
        status: statusMap[String(result.status)] ?? "IN_TRANSIT",
        carrier: result.carrier,
        tracking_details: [],
      };
    }),
    parseEasyPostInvoicePayload: vi.fn((body: unknown) => {
      const event = body as { description?: string } | null;
      return event?.description?.startsWith("shipment_invoice") ? null : null;
    }),
  };
});

// ─── Mock @supabase/supabase-js ──────────────────────────────────────
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ data: [], error: null }),
      insert: vi.fn().mockReturnValue({ data: [], error: null }),
      update: vi.fn().mockReturnValue({ data: [], error: null }),
    }),
  })),
}));

// ─── Mock EasyPost ───────────────────────────────────────────────────
vi.mock("@easypost/api", () => ({
  default: vi.fn(),
}));

// ─── Mock @haggle/skill-legit ────────────────────────────────────────
vi.mock("@haggle/skill-legit", () => ({
  AuthenticationService: vi.fn().mockImplementation(() => ({
    authenticate: vi.fn().mockResolvedValue({ status: "PASS", score: 0.95 }),
    processWebhook: vi.fn().mockResolvedValue(null),
  })),
  LegitAuthAdapter: vi.fn(),
  MockAuthAdapter: vi.fn().mockImplementation(() => ({
    authenticate: vi.fn().mockResolvedValue({ status: "PASS", score: 0.95 }),
  })),
  verifyLegitWebhook: vi.fn().mockReturnValue(true),
}));

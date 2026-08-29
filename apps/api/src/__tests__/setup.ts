/**
 * Test setup for API integration tests.
 *
 * Mocks @haggle/db so createServer() can run without a real database.
 * Individual service mocks are applied per-test file using vi.mock().
 */
import { vi } from "vitest";

process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/haggle_test";
process.env.HAGGLE_ALLOW_UNVERIFIED_TEST_JWT ??= "true";

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

function createMockSelect() {
  return vi.fn().mockImplementation(() => {
    const selectQueue = (
      globalThis as typeof globalThis & { __HAGGLE_TEST_DB_SELECT_ROWS__?: unknown[][] }
    ).__HAGGLE_TEST_DB_SELECT_ROWS__;
    const rows: unknown[] = selectQueue?.shift() ?? [];
    const result = Promise.resolve(rows);
    const query = {
      from: vi.fn(() => query),
      where: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      limit: vi.fn(() => query),
      offset: vi.fn(() => query),
      // biome-ignore lint/suspicious/noThenProperty: Drizzle query mocks must remain awaitable.
      then: result.then.bind(result),
      catch: result.catch.bind(result),
      finally: result.finally.bind(result),
    };
    return query;
  });
}

vi.mock("@haggle/db", () => ({
  createDb: vi.fn(() => ({
    query: createMockQueryProxy(),
    select: createMockSelect(),
    insert: createMockInsert(),
    update: vi
      .fn()
      .mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    execute: vi.fn().mockResolvedValue([]),
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        execute: vi.fn().mockResolvedValue([]),
        query: createMockQueryProxy(),
        select: createMockSelect(),
        insert: createMockInsert(),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
        }),
      }),
    ),
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
  listingClaims: { id: "id", listingId: "listingId", status: "status" },
  negotiationSessions: {},
  negotiationCheckpoints: {},
  negotiationRoundFacts: {},
  llmTelemetry: {},
  trustScores: { actorId: {}, score: {}, actorRole: {} },
  hfmiPriceObservations: {},
  hfmiModelCoefficients: {},
  sellerAttestationCommits: {},
  // Table references used directly in route handlers (not via services)
  webhookIdempotency: {
    id: "id",
    idempotencyKey: "idempotencyKey",
    source: "source",
    responseStatus: "responseStatus",
  },
  refunds: {
    id: "id",
    paymentIntentId: "paymentIntentId",
    amountMinor: "amountMinor",
    status: "status",
    updatedAt: "updatedAt",
  },
  disputeResolutions: {
    disputeId: "disputeId",
    outcome: "outcome",
    refundAmountMinor: "refundAmountMinor",
    createdAt: "createdAt",
  },
  disputeCases: {
    id: "id",
    orderId: "orderId",
    status: "status",
    metadata: "metadata",
    resolvedAt: "resolvedAt",
    closedAt: "closedAt",
    updatedAt: "updatedAt",
  },
  disputeEvidence: { id: "id", disputeId: "disputeId" },
  disputeEvidenceUploads: {
    id: "id",
    disputeId: "disputeId",
    status: "status",
    storagePath: "storagePath",
  },
  disputeModuleIdempotencyKeys: {
    id: "id",
    platformId: "platformId",
    idempotencyKey: "idempotencyKey",
    requestFingerprint: "requestFingerprint",
    disputeId: "disputeId",
  },
  disputeModuleWebhookOutbox: {
    id: "id",
    eventId: "eventId",
    platformId: "platformId",
    externalOrderId: "externalOrderId",
    disputeId: "disputeId",
    eventType: "eventType",
    status: "status",
    nextAttemptAt: "nextAttemptAt",
  },
  commerceOrders: { id: "id", status: "status", updatedAt: "updatedAt" },
  paymentIntents: {
    id: "id",
    orderId: "orderId",
    providerContext: "providerContext",
    status: "status",
    amountMinor: "amountMinor",
    updatedAt: "updatedAt",
  },
  paymentAuthorizations: {
    paymentIntentId: "paymentIntentId",
    providerReference: "providerReference",
    createdAt: "createdAt",
  },
  paymentSettlements: {
    id: "id",
    paymentIntentId: "paymentIntentId",
    providerReference: "providerReference",
    createdAt: "createdAt",
  },
  paymentOperationIdempotency: {
    operation: "operation",
    idempotencyKey: "idempotencyKey",
  },
  shipments: {
    id: "id",
    orderId: "orderId",
    shipmentType: "shipmentType",
    status: "status",
    carrier: "carrier",
    trackingNumber: "trackingNumber",
    labelUrl: "labelUrl",
    metadata: "metadata",
    updatedAt: "updatedAt",
  },
  shipmentEvents: { shipmentId: "shipmentId" },
  apiRateLimitWindows: {
    scope: "scope",
    keyHash: "keyHash",
    windowStartedAt: "windowStartedAt",
    requestCount: "requestCount",
    updatedAt: "updatedAt",
  },
  websocketAuthTickets: {
    id: "id",
    tokenHash: "tokenHash",
    userId: "userId",
    channel: "channel",
    resourceId: "resourceId",
    expiresAt: "expiresAt",
    createdAt: "createdAt",
  },
  settlementReleases: {
    id: "id",
    orderId: "orderId",
    productReleaseStatus: "productReleaseStatus",
    updatedAt: "updatedAt",
  },
  userWallets: {
    walletAddress: "walletAddress",
    userId: "userId",
    network: "network",
    isPrimary: "isPrimary",
  },
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
  ViemConditionalSettlementContract: vi.fn(),
  ViemDisputeRegistryContract: vi.fn(),
  ViemSettlementRouterContract: vi.fn(),
}));

// ─── Mock viem (heavy crypto dependency) ─────────────────────────────
vi.mock("viem", () => ({
  createPublicClient: vi.fn(),
  createWalletClient: vi.fn(),
  decodeEventLog: vi.fn(),
  http: vi.fn(),
  isAddress: vi.fn(
    (value: unknown) => typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value),
  ),
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
      createLabel = vi
        .fn()
        .mockResolvedValue({ tracking_number: "MOCK123", label_url: "https://mock" });
      getTrackingInfo = vi.fn().mockResolvedValue({ status: "IN_TRANSIT" });
    },
    EasyPostCarrierAdapter: class EasyPostCarrierAdapter {
      createLabel = vi
        .fn()
        .mockResolvedValue({ tracking_number: "EP123", label_url: "https://ep" });
      getTrackingInfo = vi.fn().mockResolvedValue({ status: "IN_TRANSIT" });
      trackTestStatus = vi.fn().mockImplementation(async (status: string) => ({
        canonical_status:
          status === "delivered"
            ? "DELIVERED"
            : status === "out_for_delivery"
              ? "OUT_FOR_DELIVERY"
              : "IN_TRANSIT",
        carrier_raw_status: status,
        message: `EasyPost test tracker verified ${status}`,
        metadata: {
          easypost_tracker_id: `trk_test_${status}`,
          easypost_test_tracking_code:
            status === "delivered"
              ? "EZ4000000004"
              : status === "out_for_delivery"
                ? "EZ3000000003"
                : "EZ2000000002",
          easypost_test_status_verified: true,
        },
      }));
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
      const details = Array.isArray(result.tracking_details)
        ? (result.tracking_details as Array<Record<string, unknown>>)
        : [];
      const latest = details.at(-1);
      const location = latest?.tracking_location as Record<string, unknown> | undefined;
      return {
        tracking_code: result.tracking_code,
        status: statusMap[String(result.status)] ?? "IN_TRANSIT",
        carrier: result.carrier,
        tracking_details: details,
        occurred_at: typeof latest?.datetime === "string" ? latest.datetime : undefined,
        carrier_raw_status: String(result.status),
        message: typeof latest?.message === "string" ? latest.message : undefined,
        location: location ? [location.city, location.state].filter(Boolean).join(", ") : undefined,
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

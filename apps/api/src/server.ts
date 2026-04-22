import Fastify from "fastify";
import cors from "@fastify/cors";
import { createDb } from "@haggle/db";
import authPlugin from "./middleware/auth.js";
import { globalRateLimit } from "./middleware/rate-limit.js";
import { registerMcpRoutes } from "./mcp/router.js";
import { registerClaimRoutes } from "./routes/claim.js";
import { registerListingsRoutes } from "./routes/listings.js";
import { registerAccountRoutes } from "./routes/account.js";
import { registerPublicListingRoutes } from "./routes/public-listing.js";
import { registerDraftRoutes } from "./routes/drafts.js";
import { registerBuyerListingsRoutes } from "./routes/buyer-listings.js";
import { registerPaymentRoutes } from "./routes/payments.js";
import { registerShipmentRoutes } from "./routes/shipments.js";
import { registerDisputeRoutes } from "./routes/disputes.js";
import { registerAuthenticationRoutes } from "./routes/authentications.js";
import { registerTrustRoutes } from "./routes/trust.js";
import { registerDSRatingRoutes } from "./routes/ds-ratings.js";
import { registerARPRoutes } from "./routes/arp.js";
import { registerTagRoutes } from "./routes/tags.js";
import { registerIntentRoutes } from "./routes/intents.js";
import { registerSkillRoutes } from "./routes/skills.js";
import { registerSettlementReleaseRoutes } from "./routes/settlement-releases.js";
import { registerSettlementApprovalRoutes } from "./routes/settlement-approvals.js";
import { registerNegotiationRoutes } from "./routes/negotiations.js";
import { registerStageRoutes } from "./routes/negotiation-stages.js";
import { registerSimulateRoute } from "./routes/negotiation-simulate.js";
import { registerDemoRoute } from "./routes/negotiation-demo.js";
import { registerGroupRoutes } from "./routes/groups.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerAttestationRoutes } from "./routes/attestation.js";
import { registerWalletRoutes } from "./routes/wallets.js";
import { registerHfmiRoutes } from "./routes/hfmi.js";
import { registerPresetRoutes } from "./routes/presets.js";
import { registerBuddyRoutes } from "./routes/buddies.js";
import { registerGamificationRoutes } from "./routes/gamification.js";
import { registerDemoE2ERoutes } from "./routes/demo-e2e.js";
import { registerReviewerRoutes } from "./routes/reviewer.js";
import { registerAddressRoutes } from "./routes/addresses.js";
import { registerOrderRoutes } from "./routes/orders.js";
import websocket from "@fastify/websocket";
import { registerWebSocketRoutes } from "./ws/negotiation-ws.js";
import { createEventDispatcher } from "./lib/event-dispatcher.js";
import { registerActionHandlers } from "./lib/action-handlers.js";
import { setTelemetryDb } from "./lib/llm-telemetry.js";
import { initCronJobs } from "./jobs/runner.js";

export async function createServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
    },
  });

  // ─── Raw Body Capture (for webhook signature verification) ──
  // Override the default JSON parser to store the raw buffer on the request.
  // Stripe and x402 webhooks require the exact raw bytes for HMAC verification.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_req, body, done) => {
      // Store raw buffer on request for webhook handlers
      (_req as unknown as { rawBody: Buffer }).rawBody = body as Buffer;
      try {
        done(null, JSON.parse((body as Buffer).toString()));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // ─── Database ──────────────────────────────────────────────
  const db = createDb(process.env.DATABASE_URL!);

  // ─── LLM Telemetry DB sink ─────────────────────────────────
  if (process.env.LLM_TELEMETRY === "db") {
    setTelemetryDb(db);
  }

  // ─── CORS ────────────────────────────────────────────────
  // ChatGPT requires these origins to connect to the MCP server.
  await app.register(cors, {
    origin: (origin, cb) => {
      // Allow: ChatGPT, Vercel, tryhaggle.ai, localhost, file:// (null)
      const allowed = !origin                       // same-origin / file:// (null)
        || origin === 'null'                         // file:// protocol
        || origin === 'https://chatgpt.com'
        || origin === 'https://chat.openai.com'
        || origin === 'https://tryhaggle.ai'
        || /\.vercel\.app$/.test(origin)
        || /^http:\/\/localhost:\d+$/.test(origin);
      cb(null, allowed);
    },
    methods: ["GET", "POST", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "mcp-session-id", "x-haggle-actor-id", "x-haggle-actor-role", "x-haggle-x402-signature", "stripe-signature"],
    credentials: true,
  });

  // ─── Rate Limiting ───────────────────────────────────────
  app.addHook("preHandler", globalRateLimit);

  // ─── Auth Middleware ──────────────────────────────────────
  await app.register(authPlugin);

  // ─── Health Check ────────────────────────────────────────
  app.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }));

  // ─── Negotiation Engine Routes ──────────────────────────
  const eventDispatcher = createEventDispatcher();
  registerActionHandlers(eventDispatcher, db);

  // ─── MCP Routes ──────────────────────────────────────────
  registerMcpRoutes(app, db, eventDispatcher);

  // ─── Commerce Routes ─────────────────────────────────────
  registerPaymentRoutes(app, db);
  registerShipmentRoutes(app, db);
  registerDisputeRoutes(app, db);
  registerSettlementReleaseRoutes(app, db);
  registerSettlementApprovalRoutes(app, db);
  registerAuthenticationRoutes(app, db);
  registerAddressRoutes(app, db);

  // ─── Trust, DS Rating, ARP, Tag Routes ──────────────────
  registerTrustRoutes(app, db);
  registerDSRatingRoutes(app, db);
  registerARPRoutes(app, db);
  registerTagRoutes(app, db);
  registerIntentRoutes(app, db);
  registerSkillRoutes(app, db);

  // ─── REST API Routes ───────────────────────────────────
  registerClaimRoutes(app, db);
  registerListingsRoutes(app, db);
  registerAccountRoutes(app, db);
  registerPublicListingRoutes(app, db);
  registerDraftRoutes(app, db);
  registerBuyerListingsRoutes(app, db);

  // ─── Negotiation Session & Group Routes ─────────────────
  registerNegotiationRoutes(app, db, eventDispatcher);
  registerStageRoutes(app, db);
  registerGroupRoutes(app, db, eventDispatcher);
  registerSimulateRoute(app);
  registerDemoRoute(app);

  // ─── Admin Ops Routes ────────────────────────────────────
  registerAdminRoutes(app, db);

  // ─── Attestation Routes ──────────────────────────────────
  registerAttestationRoutes(app, db);

  // ─── Wallet Routes ───────────────────────────────────────
  registerWalletRoutes(app, db);

  // ─── HFMI Routes ────────────────────────────────────────
  registerHfmiRoutes(app, db);

  // ─── Gamification Routes ───────────────────────────────
  registerPresetRoutes(app, db);
  registerBuddyRoutes(app, db);
  registerGamificationRoutes(app, db);

  // ─── Order Routes ─────────────────────────────────────
  registerOrderRoutes(app, db);

  // ─── Reviewer / DS Panel Routes ──────────────────────────
  registerReviewerRoutes(app, db);

  // ─── Demo / E2E Test Routes ────────────────────────────
  registerDemoE2ERoutes(app, db);

  // ─── WebSocket ───────────────────────────────────────────
  await app.register(websocket);
  await registerWebSocketRoutes(app);

  // ─── Cron Jobs (only if ENABLE_CRON=true) ────────────
  initCronJobs(db);

  return app;
}

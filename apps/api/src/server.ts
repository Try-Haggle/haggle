import Fastify from "fastify";
import cors from "@fastify/cors";
import { createDb } from "@haggle/db";
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
import { registerSettlementReleaseRoutes } from "./routes/settlement-releases.js";

export async function createServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
    },
  });

  // ─── Database ──────────────────────────────────────────────
  const db = createDb(process.env.DATABASE_URL!);

  // ─── CORS ────────────────────────────────────────────────
  // ChatGPT requires these origins to connect to the MCP server.
  await app.register(cors, {
    origin: [
      "https://chatgpt.com",
      "https://chat.openai.com",
      /\.vercel\.app$/,
      "https://tryhaggle.ai",
      /^http:\/\/localhost:\d+$/,
    ],
    methods: ["GET", "POST", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "mcp-session-id", "x-haggle-actor-id", "x-haggle-actor-role", "x-haggle-x402-signature", "stripe-signature"],
    credentials: true,
  });

  // ─── Health Check ────────────────────────────────────────
  app.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }));

  // ─── MCP Routes ──────────────────────────────────────────
  registerMcpRoutes(app, db);

  // ─── Commerce Routes ─────────────────────────────────────
  registerPaymentRoutes(app, db);
  registerShipmentRoutes(app, db);
  registerDisputeRoutes(app, db);
  registerSettlementReleaseRoutes(app, db);

  // ─── REST API Routes ───────────────────────────────────
  registerClaimRoutes(app, db);
  registerListingsRoutes(app, db);
  registerAccountRoutes(app, db);
  registerPublicListingRoutes(app, db);
  registerDraftRoutes(app, db);
  registerBuyerListingsRoutes(app, db);

  // TODO(post-mvp): Register WebSocket handler for real-time updates

  return app;
}

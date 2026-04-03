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
import { loadSimilarListingsCaches } from "./services/similar-listings.service.js";
import { registerSimilarListingsRoutes } from "./routes/similar-listings.js";
import { registerRecommendationsRoutes } from "./routes/recommendations.js";
import { registerInternalRoutes } from "./routes/internal.js";

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
    allowedHeaders: ["Content-Type", "Authorization", "mcp-session-id"],
    credentials: true,
  });

  // ─── Health Check ────────────────────────────────────────
  app.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }));

  // ─── MCP Routes ──────────────────────────────────────────
  registerMcpRoutes(app, db);

  // ─── REST API Routes ───────────────────────────────────
  registerClaimRoutes(app, db);
  registerListingsRoutes(app, db);
  registerAccountRoutes(app, db);
  registerPublicListingRoutes(app, db);
  registerDraftRoutes(app, db);
  registerBuyerListingsRoutes(app, db);
  registerSimilarListingsRoutes(app, db);
  registerRecommendationsRoutes(app, db);
  registerInternalRoutes(app, db);

  // ─── Load Caches ────────────────────────────────────────
  await loadSimilarListingsCaches(db);

  // TODO(post-mvp): Register WebSocket handler for real-time updates

  return app;
}

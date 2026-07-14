// Load environment variables before anything else reads process.env.
import "./config/load-env.js";
import { validateEnv } from "./config/validate-env.js";

const PORT = parseInt(process.env.PORT || "3001", 10);
const HOST = process.env.HOST || "0.0.0.0";

async function main() {
  // Fail fast with a single aggregated report if required env vars are missing.
  validateEnv();

  const { createServer } = await import("./server.js");
  const server = await createServer();

  await server.listen({ port: PORT, host: HOST });
  server.log.info(`Haggle API server running on ${HOST}:${PORT}`);
  server.log.info(`MCP endpoint: http://${HOST}:${PORT}/mcp`);
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

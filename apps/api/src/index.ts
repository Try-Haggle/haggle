import dotenv from "dotenv";
import { resolve } from "node:path";

// Load .env from monorepo root (works from any cwd)
dotenv.config({ path: resolve(import.meta.dirname, "../../../.env") });
import { createServer } from "./server.js";

const PORT = parseInt(process.env.PORT || "3001", 10);
const HOST = process.env.HOST || "0.0.0.0";

async function main() {
  const server = await createServer();

  await server.listen({ port: PORT, host: HOST });
  server.log.info(`Haggle API server running on ${HOST}:${PORT}`);
  server.log.info(`MCP endpoint: http://${HOST}:${PORT}/mcp`);
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

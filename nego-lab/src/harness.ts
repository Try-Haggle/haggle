// Shared lab context: boots the real API server (in-process) and a DB handle
// ONCE, so many scenarios can reuse them instead of rebooting per case.
//
// Env: DATABASE_URL must point at the local isolated test DB (haggle_negolab).
// The .env at repo root supplies DEEPSEEK_API_KEY; dotenv does NOT override an
// already-set DATABASE_URL, so exporting the local URL in the shell wins.
import "../../apps/api/src/config/load-env.js";
import { createDb, type Database } from "@haggle/db";
import { createServer } from "../../apps/api/src/server.js";

export interface LabContext {
  app: Awaited<ReturnType<typeof createServer>>;
  db: Database;
  dbUrl: string;
}

export async function createLabContext(): Promise<LabContext> {
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!dbUrl.includes("haggle_negolab")) {
    throw new Error(
      `Refusing to run: DATABASE_URL must be the local test DB (haggle_negolab). Got: ${dbUrl || "<unset>"}`,
    );
  }
  const db = createDb(dbUrl);
  const app = await createServer();
  return { app, db, dbUrl };
}

export async function closeLabContext(ctx: LabContext): Promise<void> {
  await ctx.app.close();
}

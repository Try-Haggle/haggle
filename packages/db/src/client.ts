import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type Database = ReturnType<typeof createDb>;

export function createDb(connectionString: string) {
  const client = postgres(connectionString, {
    prepare: false, // Required for Supabase connection pooler (Transaction mode)
  });

  return drizzle(client, { schema });
}

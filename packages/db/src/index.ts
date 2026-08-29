// Re-export commonly used drizzle-orm operators so consumers don't need a direct drizzle-orm dependency
export {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
export type { Database } from "./client.js";
export { createDb } from "./client.js";
export type { PgListener } from "./listener.js";

// Realtime fan-out helper (session-mode connection required — see listener.ts)
export { createPgListener } from "./listener.js";
// Re-export schema for convenience
export * from "./schema/index.js";

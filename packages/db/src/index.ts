export { createDb } from "./client.js";
export type { Database } from "./client.js";

// Re-export schema for convenience
export * from "./schema/index.js";

// Re-export commonly used drizzle-orm operators so consumers don't need a direct drizzle-orm dependency
export { eq } from "drizzle-orm";

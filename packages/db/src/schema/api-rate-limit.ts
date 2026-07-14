import { integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const apiRateLimitWindows = pgTable(
  "api_rate_limit_windows",
  {
    scope: text("scope").notNull(),
    keyHash: text("key_hash").notNull(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true })
      .notNull(),
    requestCount: integer("request_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.scope, table.keyHash] })],
);

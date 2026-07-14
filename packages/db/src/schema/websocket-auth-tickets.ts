import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const websocketAuthTickets = pgTable(
  "websocket_auth_tickets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id").notNull(),
    channel: text("channel", { enum: ["negotiation", "notification"] }).notNull(),
    resourceId: uuid("resource_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ws_auth_tickets_token_hash_uidx").on(table.tokenHash),
    index("ws_auth_tickets_expiry_idx").on(table.expiresAt),
    check("ws_auth_tickets_hash_ck", sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("ws_auth_tickets_scope_ck", sql`(
      (${table.channel} = 'notification' AND ${table.resourceId} IS NULL)
      OR (${table.channel} = 'negotiation' AND ${table.resourceId} IS NOT NULL)
    )`),
    check("ws_auth_tickets_lifetime_ck", sql`${table.expiresAt} > ${table.createdAt} AND ${table.expiresAt} <= ${table.createdAt} + interval '60 seconds'`),
  ],
);

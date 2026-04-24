import { jsonb, pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";

export const advisorMessages = pgTable(
  "advisor_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    disputeId: uuid("dispute_id").notNull(),
    role: text("role", {
      enum: ["buyer_advisor", "seller_advisor", "buyer_user", "seller_user"],
    }).notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<{
      tokens_used?: number;
      model?: string;
      cost_usd?: number;
      strength?: number;
      blocked?: boolean;
      block_reason?: string;
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_advisor_messages_dispute").on(table.disputeId, table.createdAt),
  ],
);

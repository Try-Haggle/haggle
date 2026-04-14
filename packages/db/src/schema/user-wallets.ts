import { boolean, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const userWallets = pgTable(
  "user_wallets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    walletAddress: text("wallet_address").notNull(),
    network: text("network").notNull(),
    role: text("role").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueUserNetworkRole: unique("user_wallets_user_network_role_unique").on(
      table.userId,
      table.network,
      table.role,
    ),
  }),
);

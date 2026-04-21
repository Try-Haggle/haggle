import { boolean, pgTable, text, timestamp, uuid, unique } from "drizzle-orm/pg-core";

/**
 * Per-order buyer/seller address.
 * Each order can have one buyer address and one seller address.
 * Addresses are snapshotted per-order to preserve history even if the user updates their address book.
 */
export const orderAddresses = pgTable(
  "order_addresses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id").notNull(),
    role: text("role", { enum: ["buyer", "seller"] }).notNull(),
    name: text("name").notNull(),
    company: text("company"),
    street1: text("street1").notNull(),
    street2: text("street2"),
    city: text("city").notNull(),
    state: text("state").notNull(),
    zip: text("zip").notNull(),
    country: text("country").notNull().default("US"),
    phone: text("phone"),
    email: text("email"),
    verified: boolean("verified").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueOrderRole: unique("order_addresses_order_role_unique").on(t.orderId, t.role),
  }),
);

/**
 * User's saved address book (reusable across orders).
 * Users can save multiple addresses with labels (e.g. "home", "office").
 * One address can be marked as default.
 */
export const userSavedAddresses = pgTable("user_saved_addresses", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  label: text("label").default("home"),
  name: text("name").notNull(),
  street1: text("street1").notNull(),
  street2: text("street2"),
  city: text("city").notNull(),
  state: text("state").notNull(),
  zip: text("zip").notNull(),
  country: text("country").notNull().default("US"),
  phone: text("phone"),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

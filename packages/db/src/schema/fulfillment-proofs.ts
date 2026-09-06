import {
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { fulfillments } from "./fulfillments.js";

/**
 * Untrusted seller evidence for digital / no-shipment fulfillment.
 * Proof submit alone must not release funds or skip buyer review.
 */
export const fulfillmentProofs = pgTable(
  "fulfillment_proofs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fulfillmentId: uuid("fulfillment_id").notNull(),
    proofKind: text("proof_kind").notNull(),
    uri: text("uri"),
    sha256: text("sha256"),
    externalReference: text("external_reference"),
    submittedBy: text("submitted_by").notNull(),
    verificationStatus: text("verification_status", {
      enum: ["PENDING", "VERIFIED", "REJECTED"],
    })
      .notNull()
      .default("PENDING"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    fulfillmentFk: foreignKey({
      name: "fulfillment_proofs_fulfillment_id_fkey",
      columns: [table.fulfillmentId],
      foreignColumns: [fulfillments.id],
    }),
    fulfillmentIdx: index("fulfillment_proofs_fulfillment_id_idx").on(table.fulfillmentId),
    submittedByIdx: index("fulfillment_proofs_submitted_by_idx").on(table.submittedBy),
  }),
);

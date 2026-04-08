import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { listingsPublished } from "./listings-published.js";

/**
 * Seller pre-ship attestation commits (Phase 0 dispute-triggered attestation).
 *
 * Append-only audit log. A row is written once at listing publish time and
 * never mutated. The `commitHash` is a sha256 over `canonicalPayload` and is
 * later re-verified by `dispute-core` when evidence is submitted, to prove
 * that the photos/metadata shown to the DS panel match what the seller
 * committed to before shipping.
 *
 * v0 is fully off-chain (Postgres). Onchain hash commitment is Phase 0.5.
 */
export const sellerAttestationCommits = pgTable(
  "seller_attestation_commits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listingsPublished.id, { onDelete: "cascade" }),
    sellerId: uuid("seller_id").notNull(),
    // AES-256 encrypted IMEI. Encryption key lives in env / KMS, never in DB.
    imeiEncrypted: text("imei_encrypted").notNull(),
    batteryHealthPct: integer("battery_health_pct").notNull(),
    findMyOff: boolean("find_my_off").notNull(),
    // Array of S3 object keys (SSE-S3 encrypted, 90-day lifecycle).
    photoUrls: jsonb("photo_urls").notNull().$type<string[]>(),
    // sha256 hex digest of canonicalPayload. Deterministic.
    commitHash: text("commit_hash").notNull(),
    // Full canonical payload used to derive commitHash. Stored for later
    // dispute-time verification (re-hash and compare).
    canonicalPayload: jsonb("canonical_payload")
      .notNull()
      .$type<Record<string, unknown>>(),
    committedAt: timestamp("committed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Review period end — driven by arp-core trust-modulated window.
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // Append-only: at most one commit per listing. Enforced by migration 005.
    uniqueIndex("uq_seller_attestation_commits_listing_id").on(table.listingId),
    index("idx_seller_attestation_commits_listing").on(table.listingId),
    index("idx_seller_attestation_commits_seller_committed").on(
      table.sellerId,
      table.committedAt,
    ),
  ],
);

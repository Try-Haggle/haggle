import { z } from "zod";

// ─── Event Types ─────────────────────────────────────────────────────────────

export const EVENT_TYPES = [
  "negotiation.session.concluded", // AI agents reached agreed price → buyer to review
  "negotiation.offer.accepted",    // Human buyer accepted → seller notified
  "user.signed_up",
  "listing.published",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

// ─── Payload Schemas ──────────────────────────────────────────────────────────

export const SessionConcludedPayloadSchema = z.object({
  sessionId: z.string().uuid(),
  agreedPriceMinor: z.number().int().nonnegative(),
  currency: z.string().length(3),
  listingTitle: z.string().min(1),
  listingId: z.string().uuid(),
});
export type SessionConcludedPayload = z.infer<typeof SessionConcludedPayloadSchema>;

export const OfferAcceptedPayloadSchema = z.object({
  sessionId: z.string().uuid(),
  agreedPriceMinor: z.number().int().nonnegative(),
  currency: z.string().length(3),
  buyerName: z.string().min(1),
  listingTitle: z.string().min(1),
  listingId: z.string().uuid(),
});
export type OfferAcceptedPayload = z.infer<typeof OfferAcceptedPayloadSchema>;

export const UserSignedUpPayloadSchema = z.object({
  userId: z.string().uuid(),
  userName: z.string().min(1),
});
export type UserSignedUpPayload = z.infer<typeof UserSignedUpPayloadSchema>;

export const ListingPublishedPayloadSchema = z.object({
  listingId: z.string().uuid(),
  listingTitle: z.string().min(1),
  listingPriceMinor: z.number().int().nonnegative(),
  currency: z.string().length(3),
  sellerName: z.string().min(1),
});
export type ListingPublishedPayload = z.infer<typeof ListingPublishedPayloadSchema>;

// ─── Catalog Types ────────────────────────────────────────────────────────────

export type NotificationCategory = "negotiation" | "account" | "listing";
export type NotificationChannel = "in_app" | "email";

export interface DisplayResult {
  displayTitle: string;
  displayLink: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface CatalogEntry<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  category: NotificationCategory;
  channels: NotificationChannel[];
  transactional: boolean;
  primaryEntityKey: string;
  payloadSchema: TSchema;
  renderDisplay?: (payload: z.infer<TSchema>) => DisplayResult;
}

// ─── Event Catalog ────────────────────────────────────────────────────────────

export const EVENT_CATALOG: Record<EventType, CatalogEntry> = {
  "negotiation.session.concluded": {
    category: "negotiation",
    channels: ["in_app", "email"],
    transactional: true,
    primaryEntityKey: "sessionId",
    payloadSchema: SessionConcludedPayloadSchema,
    renderDisplay: (p: SessionConcludedPayload) => ({
      displayTitle: `Your agent negotiated ${p.listingTitle} down to $${(p.agreedPriceMinor / 100).toLocaleString("en-US")}. Ready to accept?`,
      displayLink: `/negotiations/${p.sessionId}`,
    }),
  },

  "negotiation.offer.accepted": {
    category: "negotiation",
    channels: ["in_app", "email"],
    transactional: true,
    primaryEntityKey: "sessionId",
    payloadSchema: OfferAcceptedPayloadSchema,
    renderDisplay: (p: OfferAcceptedPayload) => ({
      displayTitle: `${p.buyerName} accepted the deal on ${p.listingTitle}!`,
      displayLink: `/sell/listings/${p.listingId}`,
    }),
  },

  "user.signed_up": {
    category: "account",
    channels: ["email"],
    transactional: true,
    primaryEntityKey: "userId",
    payloadSchema: UserSignedUpPayloadSchema,
  },

  "listing.published": {
    category: "listing",
    channels: ["email"],
    transactional: true,
    primaryEntityKey: "listingId",
    payloadSchema: ListingPublishedPayloadSchema,
  },
};

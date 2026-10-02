/**
 * user_metadata keys for the buyer dashboard's "Get started" card.
 *
 * Plain module on purpose: both server pages (read) and client components
 * (write) import these, and a value exported from a "use client" module
 * reaches a server component as a client reference, not the string.
 */

/** Set once the buyer dismisses the card. */
export const BUYER_GET_STARTED_DISMISSED_KEY = "buyer_get_started_dismissed_at";

/** Set the first time a signed-in buyer opens the marketplace (/browse). */
export const BROWSED_MARKETPLACE_KEY = "browsed_marketplace_at";

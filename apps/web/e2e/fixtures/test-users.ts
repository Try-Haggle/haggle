/**
 * Test account credentials. Real values come from CI secrets / .env.local.
 *
 * Local-dev convention: seed users via Supabase admin tools using the
 * same UUID/email pairs below before running the flow specs.
 */

export const SELLER_USER = {
  email: process.env.E2E_SELLER_EMAIL ?? "seller-e2e@haggle.test",
  password: process.env.E2E_SELLER_PASSWORD ?? "SellerTest!2026",
  id: process.env.E2E_SELLER_ID ?? "10000000-0000-4000-8000-000000000001",
};

export const BUYER_USER = {
  email: process.env.E2E_BUYER_EMAIL ?? "buyer-e2e@haggle.test",
  password: process.env.E2E_BUYER_PASSWORD ?? "BuyerTest!2026",
  id: process.env.E2E_BUYER_ID ?? "10000000-0000-4000-8000-000000000002",
};

/** A pre-seeded published listing the buyer flow targets. */
export const SEED_LISTING_PUBLIC_ID = process.env.E2E_SEED_LISTING_PUBLIC_ID ?? "seed-iphone-pro";

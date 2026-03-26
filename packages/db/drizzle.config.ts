/// <reference types="node" />
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  // Explicit file list instead of glob — drizzle-kit uses CJS internally and can't resolve
  // the .js extension imports in our ESM barrel file (schema/index.ts).
  // Add new table schema files here as they're created.
  schema: [
    "./src/schema/listing-drafts.ts",
    "./src/schema/listings-published.ts",
    "./src/schema/buyer-listings.ts",
    "./src/schema/commerce-orders.ts",
    "./src/schema/payments.ts",
    "./src/schema/shipments.ts",
    "./src/schema/disputes.ts",
    "./src/schema/trust-ledger.ts",
  ],
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});

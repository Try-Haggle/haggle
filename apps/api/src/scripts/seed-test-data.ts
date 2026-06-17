/**
 * Seed 10 dummy users + 10 listings with realistic data for end-to-end testing.
 *
 * Usage:
 *   cd apps/api
 *   npx tsx src/scripts/seed-test-data.ts
 *
 * After seeding, run backfill-embeddings.ts to generate embeddings:
 *   npx tsx src/scripts/backfill-embeddings.ts
 *
 * Requires: DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in root .env
 */

import "../config/load-env.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../../../../.env");
console.log("Loading .env from:", envPath);
console.log("SUPABASE_URL:", process.env.SUPABASE_URL ? "SET" : "NOT SET");

import { randomBytes } from "node:crypto";
import { createDb, listingDrafts, listingsPublished } from "@haggle/db";
import { createClient } from "@supabase/supabase-js";

function generatePublicId(): string {
  return randomBytes(6).toString("base64url").slice(0, 8);
}

// ─── 10 Realistic Listings ──────────────────────────────

const LISTINGS = [
  {
    title: "Sony WH-1000XM5 Wireless Headphones",
    description:
      "Premium noise-cancelling headphones with 30-hour battery life. Excellent sound quality, barely used for 2 months. Comes with original case and charging cable.",
    category: "electronics",
    condition: "like_new",
    tags: ["sony", "headphones", "wireless", "noise-cancelling", "bluetooth"],
    targetPrice: 280,
    floorPrice: 220,
    photoUrl:
      "https://images.pexels.com/photos/3394650/pexels-photo-3394650.jpeg?auto=compress&w=800",
  },
  {
    title: "MacBook Pro 14-inch M3 Pro 2023",
    description:
      "18GB RAM, 512GB SSD. Used for development work. No scratches, battery health at 94%. Includes charger and original box.",
    category: "electronics",
    condition: "good",
    tags: ["macbook", "apple", "laptop", "m3", "pro"],
    targetPrice: 1600,
    floorPrice: 1300,
    photoUrl:
      "https://images.pexels.com/photos/303383/pexels-photo-303383.jpeg?auto=compress&w=800",
  },
  {
    title: "Nike Air Jordan 1 Retro High OG",
    description:
      "Size 10 US. Chicago colorway. Worn only 3 times, comes with original box and extra laces. No creasing.",
    category: "fashion",
    condition: "like_new",
    tags: ["nike", "jordan", "sneakers", "shoes", "retro"],
    targetPrice: 350,
    floorPrice: 280,
    photoUrl:
      "https://images.pexels.com/photos/2529148/pexels-photo-2529148.jpeg?auto=compress&w=800",
  },
  {
    title: "Vintage Levi's 501 Jeans",
    description:
      "Original 90s Levi's 501 in medium wash. Size 32x32. Great fade pattern, no rips or tears. Classic straight fit.",
    category: "fashion",
    condition: "good",
    tags: ["levis", "jeans", "vintage", "denim", "501"],
    targetPrice: 120,
    floorPrice: 80,
    photoUrl:
      "https://images.pexels.com/photos/1082529/pexels-photo-1082529.jpeg?auto=compress&w=800",
  },
  {
    title: "KitchenAid Artisan Stand Mixer",
    description:
      "5-quart tilt-head stand mixer in Empire Red. Used a handful of times, works perfectly. Includes all original attachments.",
    category: "home",
    condition: "like_new",
    tags: ["kitchenaid", "mixer", "kitchen", "baking", "appliance"],
    targetPrice: 250,
    floorPrice: 190,
    photoUrl:
      "https://images.pexels.com/photos/4226896/pexels-photo-4226896.jpeg?auto=compress&w=800",
  },
  {
    title: "Mid-Century Modern Coffee Table",
    description:
      "Solid walnut wood coffee table. 48x24 inches. Minor surface wear but structurally perfect. Beautiful grain pattern.",
    category: "home",
    condition: "good",
    tags: ["furniture", "table", "coffee-table", "mid-century", "walnut"],
    targetPrice: 400,
    floorPrice: 300,
    photoUrl:
      "https://images.pexels.com/photos/1866149/pexels-photo-1866149.jpeg?auto=compress&w=800",
  },
  {
    title: "Peloton Bike+ with Accessories",
    description:
      "Peloton Bike+ in excellent condition. Includes mat, weights, heart rate monitor, and cycling shoes (size 42). 200+ rides logged.",
    category: "sports",
    condition: "good",
    tags: ["peloton", "bike", "cycling", "fitness", "exercise"],
    targetPrice: 1200,
    floorPrice: 900,
    photoUrl:
      "https://images.pexels.com/photos/4162449/pexels-photo-4162449.jpeg?auto=compress&w=800",
  },
  {
    title: "Wilson Pro Staff 97 Tennis Racket",
    description:
      "Roger Federer signature racket. Grip size 3. Strung with Luxilon ALU Power at 50 lbs. Light use, no frame damage.",
    category: "sports",
    condition: "like_new",
    tags: ["tennis", "racket", "wilson", "pro-staff", "sports"],
    targetPrice: 180,
    floorPrice: 130,
    photoUrl:
      "https://images.pexels.com/photos/209977/pexels-photo-209977.jpeg?auto=compress&w=800",
  },
  {
    title: "iPad Pro 12.9-inch M2 with Apple Pencil",
    description:
      "256GB WiFi model, Space Gray. Includes Apple Pencil 2nd gen and Magic Keyboard. Screen protector since day 1. Perfect for digital art.",
    category: "electronics",
    condition: "like_new",
    tags: ["ipad", "apple", "tablet", "pencil", "pro"],
    targetPrice: 900,
    floorPrice: 750,
    photoUrl:
      "https://images.pexels.com/photos/1334597/pexels-photo-1334597.jpeg?auto=compress&w=800",
  },
  {
    title: "2019 Toyota Camry SE - Low Mileage",
    description:
      "35,000 miles. Single owner, clean title. Regular maintenance at dealer. New tires, recently detailed. Silver exterior, black interior.",
    category: "vehicles",
    condition: "good",
    tags: ["toyota", "camry", "sedan", "car", "low-mileage"],
    targetPrice: 22000,
    floorPrice: 19000,
    photoUrl:
      "https://images.pexels.com/photos/170811/pexels-photo-170811.jpeg?auto=compress&w=800",
  },
];

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const db = createDb(process.env.DATABASE_URL!);

  console.log("🌱 Creating 10 dummy users...\n");

  const userIds: string[] = [];

  for (let i = 1; i <= 10; i++) {
    const email = `testuser${i}@haggle-test.com`;

    // Check if user already exists
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const existing = existingUsers?.users.find((u) => u.email === email);

    if (existing) {
      console.log(`  ↩️  User ${i} already exists: ${existing.id}`);
      userIds.push(existing.id);
      continue;
    }

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: `TestPass${i}!2024`,
      email_confirm: true,
    });

    if (error) {
      console.error(`  ❌ Failed to create user ${i}:`, error.message);
      process.exit(1);
    }

    console.log(`  ✅ User ${i}: ${data.user.id} (${email})`);
    userIds.push(data.user.id);
  }

  console.log("\n📦 Creating 10 listings...\n");

  for (let i = 0; i < LISTINGS.length; i++) {
    const listing = LISTINGS[i];
    const userId = userIds[i];
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + 14); // 2 weeks from now

    // Insert draft
    const [draft] = await db
      .insert(listingDrafts)
      .values({
        userId,
        status: "published",
        title: listing.title,
        description: listing.description,
        category: listing.category,
        condition: listing.condition,
        tags: listing.tags,
        targetPrice: String(listing.targetPrice),
        floorPrice: String(listing.floorPrice),
        photoUrl: listing.photoUrl,
        sellingDeadline: deadline,
      })
      .returning();

    // Insert published listing
    const publicId = generatePublicId();
    await db.insert(listingsPublished).values({
      publicId,
      draftId: draft.id,
      snapshotJson: draft as unknown as Record<string, unknown>,
    });

    console.log(`  ✅ [${i + 1}/10] "${listing.title}" → /l/${publicId} (${listing.category})`);
  }

  console.log("\n🎉 Seed complete! Now run embeddings backfill:");
  console.log("   npx tsx src/scripts/backfill-embeddings.ts\n");
  process.exit(0);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });

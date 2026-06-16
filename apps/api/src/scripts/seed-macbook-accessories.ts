/**
 * Seed MacBook accessories for cross-category recommendation testing.
 *
 * Usage:
 *   cd apps/api
 *   npx tsx src/scripts/seed-macbook-accessories.ts
 *   npx tsx src/scripts/backfill-embeddings.ts
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../../.env") });

import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createDb, listingDrafts, listingsPublished } from "@haggle/db";

function generatePublicId(): string {
  return randomBytes(6).toString("base64url").slice(0, 8);
}

const LISTINGS = [
  {
    title: "MacBook Pro 14\" Hardshell Case - Clear",
    description: "Crystal clear protective case for MacBook Pro 14-inch M3/M2. Snap-on design, full access to all ports. Scratch-resistant, doesn't add bulk. Brand new.",
    category: "electronics",
    condition: "new",
    tags: ["macbook", "case", "laptop", "protective", "accessory"],
    targetPrice: 35,
    floorPrice: 20,
    photoUrl: "https://gdmhbrcqhwinafntrjhb.supabase.co/storage/v1/object/public/listing-photos/macbook-pro-hardshell-case.webp",
  },
  {
    title: "Apple 96W USB-C Power Adapter for MacBook Pro",
    description: "Original Apple 96W USB-C charger. Compatible with MacBook Pro 14\" and 16\". Includes 2m USB-C cable. Used for 3 months, works perfectly.",
    category: "electronics",
    condition: "like_new",
    tags: ["apple", "charger", "usb-c", "macbook", "power-adapter"],
    targetPrice: 55,
    floorPrice: 35,
    photoUrl: "https://gdmhbrcqhwinafntrjhb.supabase.co/storage/v1/object/public/listing-photos/usb-c-power-adapter.webp",
  },
  {
    title: "Rain Design mStand Laptop Stand - Silver",
    description: "Aluminum laptop stand for MacBook. Elevates screen to eye level, improves airflow. Cable routing hole in back. Perfect for desk setup.",
    category: "electronics",
    condition: "good",
    tags: ["laptop", "stand", "macbook", "desk", "ergonomic"],
    targetPrice: 40,
    floorPrice: 25,
    photoUrl: "https://gdmhbrcqhwinafntrjhb.supabase.co/storage/v1/object/public/listing-photos/laptop-stand.webp",
  },
  {
    title: "CalDigit TS4 Thunderbolt 4 Dock for MacBook",
    description: "18-port Thunderbolt 4 dock. 98W charging, 2.5GbE ethernet, SD/microSD, 3x USB-A, 3x USB-C, DisplayPort, audio. The ultimate MacBook dock.",
    category: "electronics",
    condition: "like_new",
    tags: ["caldigit", "thunderbolt", "dock", "macbook", "usb-c"],
    targetPrice: 280,
    floorPrice: 220,
    photoUrl: "https://gdmhbrcqhwinafntrjhb.supabase.co/storage/v1/object/public/listing-photos/usb-c-dock.webp",
  },
  {
    title: "Tomtoc Laptop Sleeve for MacBook Pro 14-inch",
    description: "Protective carrying sleeve with accessory pocket. 360° padding, water-resistant fabric. Fits MacBook Pro 14\" perfectly. Navy blue color.",
    category: "fashion",
    condition: "new",
    tags: ["sleeve", "macbook", "laptop", "bag", "carrying-case"],
    targetPrice: 30,
    floorPrice: 18,
    photoUrl: "https://gdmhbrcqhwinafntrjhb.supabase.co/storage/v1/object/public/listing-photos/laptop-sleeve.webp",
  },
];

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const db = createDb(process.env.DATABASE_URL!);

  console.log("🌱 Creating 5 users for MacBook accessories...\n");

  const userIds: string[] = [];

  for (let i = 51; i <= 55; i++) {
    const email = `testuser${i}@haggle-test.com`;

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

  console.log(`\n📦 Creating ${LISTINGS.length} MacBook accessory listings...\n`);

  for (let i = 0; i < LISTINGS.length; i++) {
    const listing = LISTINGS[i];
    const userId = userIds[i];
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + 21);

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

    const publicId = generatePublicId();
    await db.insert(listingsPublished).values({
      publicId,
      draftId: draft.id,
      snapshotJson: draft as unknown as Record<string, unknown>,
    });

    console.log(`  ✅ [${i + 1}/${LISTINGS.length}] "${listing.title}" → /l/${publicId} (${listing.category})`);
  }

  console.log("\n🎉 Done! Now run: npx tsx src/scripts/backfill-embeddings.ts\n");
  process.exit(0);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});

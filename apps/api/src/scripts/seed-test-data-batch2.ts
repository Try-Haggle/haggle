/**
 * Seed 40 more dummy users + listings for comprehensive similarity testing.
 * Run AFTER seed-test-data.ts (which creates the first 10).
 *
 * Usage:
 *   cd apps/api
 *   npx tsx src/scripts/seed-test-data-batch2.ts
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

// ─── 40 Additional Listings ─────────────────────────────
// Designed to test: item clusters, tag overlap, price proximity, condition variance

const LISTINGS = [
  // ══════════════════════════════════════════════════════
  // ELECTRONICS — Headphone cluster (test: very similar items)
  // ══════════════════════════════════════════════════════
  {
    title: "Bose QuietComfort Ultra Headphones",
    description: "Premium wireless noise-cancelling headphones with spatial audio. Immersive sound, 24-hour battery. Includes carrying case.",
    category: "electronics",
    condition: "new",
    tags: ["bose", "headphones", "wireless", "noise-cancelling", "bluetooth"],
    targetPrice: 330,
    floorPrice: 270,
    photoUrl: "https://images.pexels.com/photos/3945667/pexels-photo-3945667.jpeg?auto=compress&w=800",
  },
  {
    title: "AirPods Max - Space Gray",
    description: "Apple over-ear headphones with Active Noise Cancellation and Spatial Audio. Excellent condition, used for 3 months.",
    category: "electronics",
    condition: "like_new",
    tags: ["apple", "headphones", "wireless", "noise-cancelling", "airpods"],
    targetPrice: 400,
    floorPrice: 320,
    photoUrl: "https://images.pexels.com/photos/5081386/pexels-photo-5081386.jpeg?auto=compress&w=800",
  },
  {
    title: "Sennheiser HD 660S2 Open-Back Headphones",
    description: "Audiophile-grade open-back headphones. Wired, 300-ohm impedance. Perfect for home studio listening. Like new condition.",
    category: "electronics",
    condition: "like_new",
    tags: ["sennheiser", "headphones", "audiophile", "wired", "open-back"],
    targetPrice: 350,
    floorPrice: 280,
    photoUrl: "https://images.pexels.com/photos/1649771/pexels-photo-1649771.jpeg?auto=compress&w=800",
  },
  // ── Electronics — Laptop cluster ──
  {
    title: "Dell XPS 15 (2023) Laptop",
    description: "Intel i7-13700H, 16GB RAM, 512GB SSD, 15.6\" OLED display. Used for 6 months, great for creative work.",
    category: "electronics",
    condition: "good",
    tags: ["dell", "laptop", "xps", "intel", "oled"],
    targetPrice: 1200,
    floorPrice: 950,
    photoUrl: "https://images.pexels.com/photos/7974/pexels-photo.jpg?auto=compress&w=800",
  },
  {
    title: "Lenovo ThinkPad X1 Carbon Gen 11",
    description: "Business ultrabook. i7-1365U, 32GB RAM, 1TB SSD. 14\" 2.8K display. Warranty until 2025. Barely used.",
    category: "electronics",
    condition: "like_new",
    tags: ["lenovo", "thinkpad", "laptop", "business", "ultrabook"],
    targetPrice: 1400,
    floorPrice: 1100,
    photoUrl: "https://images.pexels.com/photos/812264/pexels-photo-812264.jpeg?auto=compress&w=800",
  },
  // ── Electronics — Tablet cluster ──
  {
    title: "Samsung Galaxy Tab S9 Ultra",
    description: "14.6\" AMOLED, 256GB, WiFi. Includes S Pen and Book Cover Keyboard. Great for note-taking and drawing.",
    category: "electronics",
    condition: "good",
    tags: ["samsung", "tablet", "galaxy", "s-pen", "android"],
    targetPrice: 800,
    floorPrice: 650,
    photoUrl: "https://images.pexels.com/photos/1334597/pexels-photo-1334597.jpeg?auto=compress&w=800",
  },
  // ── Electronics — Other (less similar to clusters) ──
  {
    title: "Sony Alpha a6400 Mirrorless Camera",
    description: "24.2MP APS-C sensor, 4K video, real-time eye autofocus. Includes 16-50mm kit lens. Shutter count under 5000.",
    category: "electronics",
    condition: "good",
    tags: ["sony", "camera", "mirrorless", "photography", "4k"],
    targetPrice: 700,
    floorPrice: 550,
    photoUrl: "https://images.pexels.com/photos/51383/photo-camera-subject-photographer-51383.jpeg?auto=compress&w=800",
  },
  {
    title: "Keychron Q1 Pro Mechanical Keyboard",
    description: "75% layout, Gateron Jupiter Red switches, aluminum case. Hot-swappable, QMK/VIA compatible. Wireless Bluetooth + USB-C.",
    category: "electronics",
    condition: "new",
    tags: ["keyboard", "mechanical", "keychron", "wireless", "bluetooth"],
    targetPrice: 170,
    floorPrice: 130,
    photoUrl: "https://images.pexels.com/photos/1772123/pexels-photo-1772123.jpeg?auto=compress&w=800",
  },
  {
    title: "LG 27\" 4K UltraFine Monitor",
    description: "27UN850-W. USB-C with 60W Power Delivery. HDR400, 99% sRGB. Perfect for Mac setup. Includes stand and cables.",
    category: "electronics",
    condition: "good",
    tags: ["lg", "monitor", "4k", "usb-c", "hdr"],
    targetPrice: 350,
    floorPrice: 260,
    photoUrl: "https://images.pexels.com/photos/1029757/pexels-photo-1029757.jpeg?auto=compress&w=800",
  },
  {
    title: "JBL Charge 5 Bluetooth Speaker",
    description: "Portable waterproof speaker with 20 hours battery. Deep bass, IP67 rated. Perfect for outdoor use. Blue color.",
    category: "electronics",
    condition: "like_new",
    tags: ["jbl", "speaker", "bluetooth", "wireless", "portable"],
    targetPrice: 120,
    floorPrice: 85,
    photoUrl: "https://images.pexels.com/photos/1279365/pexels-photo-1279365.jpeg?auto=compress&w=800",
  },

  // ══════════════════════════════════════════════════════
  // FASHION — Sneaker cluster (test: very similar items)
  // ══════════════════════════════════════════════════════
  {
    title: "Nike Dunk Low Panda",
    description: "Size 10 US. Black/White colorway. Worn twice, minimal sole wear. Comes with original box.",
    category: "fashion",
    condition: "like_new",
    tags: ["nike", "dunk", "sneakers", "shoes", "panda"],
    targetPrice: 150,
    floorPrice: 110,
    photoUrl: "https://images.pexels.com/photos/1598505/pexels-photo-1598505.jpeg?auto=compress&w=800",
  },
  {
    title: "Adidas Ultraboost 23 Running Shoes",
    description: "Size 10.5 US. Core Black colorway. Used for light jogging only, excellent cushioning. Original box included.",
    category: "fashion",
    condition: "good",
    tags: ["adidas", "ultraboost", "sneakers", "shoes", "running"],
    targetPrice: 120,
    floorPrice: 80,
    photoUrl: "https://images.pexels.com/photos/1032110/pexels-photo-1032110.jpeg?auto=compress&w=800",
  },
  {
    title: "New Balance 550 White/Green",
    description: "Size 9.5 US. Retro basketball-inspired sneaker. Worn a few times, excellent condition. Clean white leather.",
    category: "fashion",
    condition: "like_new",
    tags: ["new-balance", "550", "sneakers", "shoes", "retro"],
    targetPrice: 100,
    floorPrice: 70,
    photoUrl: "https://images.pexels.com/photos/1464625/pexels-photo-1464625.jpeg?auto=compress&w=800",
  },
  // ── Fashion — Denim cluster ──
  {
    title: "Wrangler Cowboy Cut Jeans",
    description: "Original fit, rigid indigo. Size 34x32. New with tags, never worn. Classic western style.",
    category: "fashion",
    condition: "new",
    tags: ["wrangler", "jeans", "denim", "western", "cowboy"],
    targetPrice: 45,
    floorPrice: 30,
    photoUrl: "https://images.pexels.com/photos/1598507/pexels-photo-1598507.jpeg?auto=compress&w=800",
  },
  {
    title: "Levi's Denim Trucker Jacket",
    description: "Classic Type III trucker jacket in medium stonewash. Size L. Vintage look with modern fit. Barely worn.",
    category: "fashion",
    condition: "like_new",
    tags: ["levis", "jacket", "denim", "vintage", "trucker"],
    targetPrice: 80,
    floorPrice: 55,
    photoUrl: "https://images.pexels.com/photos/1040945/pexels-photo-1040945.jpeg?auto=compress&w=800",
  },
  // ── Fashion — Other ──
  {
    title: "Patagonia Better Sweater Fleece Jacket",
    description: "Men's size M. New Navy color. Full-zip, excellent for layering. Worn casually a few times.",
    category: "fashion",
    condition: "good",
    tags: ["patagonia", "jacket", "fleece", "outdoor", "sweater"],
    targetPrice: 90,
    floorPrice: 60,
    photoUrl: "https://images.pexels.com/photos/6764007/pexels-photo-6764007.jpeg?auto=compress&w=800",
  },
  {
    title: "Ray-Ban Wayfarer Sunglasses",
    description: "Classic RB2140 in tortoise/brown gradient. Original case and cloth included. No scratches on lenses.",
    category: "fashion",
    condition: "like_new",
    tags: ["ray-ban", "sunglasses", "wayfarer", "accessories", "classic"],
    targetPrice: 120,
    floorPrice: 85,
    photoUrl: "https://images.pexels.com/photos/46710/pexels-photo-46710.jpeg?auto=compress&w=800",
  },
  {
    title: "Seiko Presage Automatic Watch",
    description: "SRPD37 cocktail time. Blue dial, stainless steel case. Comes with box and papers. Worn 10 times max.",
    category: "fashion",
    condition: "like_new",
    tags: ["seiko", "watch", "automatic", "presage", "accessories"],
    targetPrice: 280,
    floorPrice: 220,
    photoUrl: "https://images.pexels.com/photos/190819/pexels-photo-190819.jpeg?auto=compress&w=800",
  },

  // ══════════════════════════════════════════════════════
  // HOME — Kitchen appliance cluster
  // ══════════════════════════════════════════════════════
  {
    title: "Vitamix E310 Explorian Blender",
    description: "Professional-grade blender. Variable speed control, 48oz container. Used weekly for 6 months. Works perfectly.",
    category: "home",
    condition: "good",
    tags: ["vitamix", "blender", "kitchen", "appliance", "smoothie"],
    targetPrice: 250,
    floorPrice: 180,
    photoUrl: "https://images.pexels.com/photos/1797106/pexels-photo-1797106.jpeg?auto=compress&w=800",
  },
  {
    title: "Breville Smart Oven Air Fryer",
    description: "13-in-1 countertop oven. Air fry, dehydrate, roast, bake. Brushed stainless steel. Like new, used 5 times.",
    category: "home",
    condition: "like_new",
    tags: ["breville", "oven", "air-fryer", "kitchen", "appliance"],
    targetPrice: 300,
    floorPrice: 230,
    photoUrl: "https://images.pexels.com/photos/6996085/pexels-photo-6996085.jpeg?auto=compress&w=800",
  },
  {
    title: "Nespresso Vertuo Next Coffee Machine",
    description: "Matte black finish. Makes espresso to full cup sizes. Includes milk frother. Used for 3 months, descaled regularly.",
    category: "home",
    condition: "good",
    tags: ["nespresso", "coffee", "espresso", "kitchen", "appliance"],
    targetPrice: 120,
    floorPrice: 80,
    photoUrl: "https://images.pexels.com/photos/312418/pexels-photo-312418.jpeg?auto=compress&w=800",
  },
  // ── Home — Furniture cluster ──
  {
    title: "IKEA MALM 6-Drawer Dresser",
    description: "White finish, 63x30.75 inches. Assembled, excellent condition. Moving sale — pickup only.",
    category: "home",
    condition: "good",
    tags: ["ikea", "dresser", "furniture", "bedroom", "storage"],
    targetPrice: 120,
    floorPrice: 70,
    photoUrl: "https://images.pexels.com/photos/1648768/pexels-photo-1648768.jpeg?auto=compress&w=800",
  },
  {
    title: "West Elm Mid-Century Bookshelf",
    description: "Acorn finish solid wood. 5 shelves, 70\" tall. Minor wear on bottom shelf. Beautiful living room piece.",
    category: "home",
    condition: "good",
    tags: ["furniture", "bookshelf", "mid-century", "west-elm", "wood"],
    targetPrice: 450,
    floorPrice: 330,
    photoUrl: "https://images.pexels.com/photos/1125137/pexels-photo-1125137.jpeg?auto=compress&w=800",
  },
  // ── Home — Decor ──
  {
    title: "Dyson Pure Cool TP04 Air Purifier",
    description: "Tower fan + HEPA air purifier combo. WiFi connected, app controlled. Filter replaced 2 months ago.",
    category: "home",
    condition: "good",
    tags: ["dyson", "air-purifier", "fan", "smart-home", "appliance"],
    targetPrice: 350,
    floorPrice: 260,
    photoUrl: "https://images.pexels.com/photos/3935328/pexels-photo-3935328.jpeg?auto=compress&w=800",
  },
  {
    title: "Philips Hue Starter Kit (4 Bulbs + Bridge)",
    description: "Smart LED color bulbs with Bridge hub. Works with Alexa, Google Home, HomeKit. All bulbs tested and working.",
    category: "home",
    condition: "good",
    tags: ["philips", "smart-home", "lighting", "hue", "led"],
    targetPrice: 100,
    floorPrice: 65,
    photoUrl: "https://images.pexels.com/photos/1123262/pexels-photo-1123262.jpeg?auto=compress&w=800",
  },

  // ══════════════════════════════════════════════════════
  // SPORTS — Fitness equipment cluster
  // ══════════════════════════════════════════════════════
  {
    title: "Bowflex SelectTech 552 Adjustable Dumbbells",
    description: "Pair of adjustable dumbbells, 5-52.5 lbs each. Replaces 15 sets of weights. Includes stand. Light use.",
    category: "sports",
    condition: "like_new",
    tags: ["bowflex", "dumbbells", "weights", "fitness", "exercise"],
    targetPrice: 350,
    floorPrice: 260,
    photoUrl: "https://images.pexels.com/photos/4164761/pexels-photo-4164761.jpeg?auto=compress&w=800",
  },
  {
    title: "Lululemon Reversible Yoga Mat 5mm",
    description: "Natural rubber mat, excellent grip. Used for 2 months of daily practice. No tears or heavy wear.",
    category: "sports",
    condition: "good",
    tags: ["lululemon", "yoga", "mat", "fitness", "exercise"],
    targetPrice: 60,
    floorPrice: 35,
    photoUrl: "https://images.pexels.com/photos/4056723/pexels-photo-4056723.jpeg?auto=compress&w=800",
  },
  {
    title: "NordicTrack Commercial S22i Studio Cycle",
    description: "Indoor cycling bike with 22\" HD touchscreen. iFIT compatible. 200+ classes completed. Excellent working condition.",
    category: "sports",
    condition: "good",
    tags: ["nordictrack", "bike", "cycling", "fitness", "exercise"],
    targetPrice: 1000,
    floorPrice: 750,
    photoUrl: "https://images.pexels.com/photos/4162451/pexels-photo-4162451.jpeg?auto=compress&w=800",
  },
  // ── Sports — Racket cluster ──
  {
    title: "Yonex Astrox 88D Pro Badminton Racket",
    description: "Offensive racket, 4U weight. Strung with BG80 at 27 lbs. Used in league play for one season.",
    category: "sports",
    condition: "good",
    tags: ["yonex", "badminton", "racket", "sports", "astrox"],
    targetPrice: 160,
    floorPrice: 110,
    photoUrl: "https://images.pexels.com/photos/3660204/pexels-photo-3660204.jpeg?auto=compress&w=800",
  },
  {
    title: "HEAD Speed Pro Tennis Racket",
    description: "Novak Djokovic signature racket. 310g, 18x20 string pattern. Strung with Babolat RPM Blast. Grip size 3.",
    category: "sports",
    condition: "like_new",
    tags: ["head", "tennis", "racket", "sports", "pro"],
    targetPrice: 200,
    floorPrice: 150,
    photoUrl: "https://images.pexels.com/photos/1432039/pexels-photo-1432039.jpeg?auto=compress&w=800",
  },
  // ── Sports — Outdoor/Other ──
  {
    title: "Burton Custom Snowboard 158cm",
    description: "All-mountain board with EST bindings. Used for two seasons. Base has minor scratches but edges are sharp.",
    category: "sports",
    condition: "good",
    tags: ["burton", "snowboard", "winter", "skiing", "outdoor"],
    targetPrice: 350,
    floorPrice: 250,
    photoUrl: "https://images.pexels.com/photos/848599/pexels-photo-848599.jpeg?auto=compress&w=800",
  },
  {
    title: "Callaway Rogue ST Max Driver",
    description: "10.5 degree loft, regular flex shaft. Used for one season, very forgiving driver. Headcover included.",
    category: "sports",
    condition: "good",
    tags: ["callaway", "golf", "driver", "sports", "club"],
    targetPrice: 300,
    floorPrice: 220,
    photoUrl: "https://images.pexels.com/photos/1325659/pexels-photo-1325659.jpeg?auto=compress&w=800",
  },

  // ══════════════════════════════════════════════════════
  // VEHICLES — Sedan cluster (test: similar to Toyota Camry)
  // ══════════════════════════════════════════════════════
  {
    title: "2020 Honda Civic EX - One Owner",
    description: "28,000 miles. Clean Carfax, no accidents. Honda Sensing suite, Apple CarPlay. Cosmic Blue exterior.",
    category: "vehicles",
    condition: "good",
    tags: ["honda", "civic", "sedan", "car", "one-owner"],
    targetPrice: 21000,
    floorPrice: 18000,
    photoUrl: "https://images.pexels.com/photos/3802510/pexels-photo-3802510.jpeg?auto=compress&w=800",
  },
  {
    title: "2021 BMW 330i xDrive Sedan",
    description: "42,000 miles. M Sport package, navigation, heated seats. Alpine White with black leather interior.",
    category: "vehicles",
    condition: "good",
    tags: ["bmw", "330i", "sedan", "luxury", "car"],
    targetPrice: 32000,
    floorPrice: 27000,
    photoUrl: "https://images.pexels.com/photos/892522/pexels-photo-892522.jpeg?auto=compress&w=800",
  },
  {
    title: "2018 Ford F-150 XLT 4x4",
    description: "55,000 miles. 5.0L V8 engine. Crew cab, 6.5ft bed. Tow package, bed liner. Well maintained truck.",
    category: "vehicles",
    condition: "good",
    tags: ["ford", "f-150", "truck", "4x4", "pickup"],
    targetPrice: 28000,
    floorPrice: 23000,
    photoUrl: "https://images.pexels.com/photos/2676096/pexels-photo-2676096.jpeg?auto=compress&w=800",
  },
  {
    title: "2022 Tesla Model 3 Long Range",
    description: "15,000 miles. Full Self-Driving capable. White exterior, white interior. Home charger included.",
    category: "vehicles",
    condition: "like_new",
    tags: ["tesla", "model-3", "electric", "sedan", "ev"],
    targetPrice: 35000,
    floorPrice: 30000,
    photoUrl: "https://images.pexels.com/photos/3729464/pexels-photo-3729464.jpeg?auto=compress&w=800",
  },
  {
    title: "2019 Harley-Davidson Iron 883",
    description: "8,500 miles. Vivid Black finish. Stage 1 upgrade, forward controls. Clean title, garage kept.",
    category: "vehicles",
    condition: "good",
    tags: ["harley", "motorcycle", "cruiser", "883", "iron"],
    targetPrice: 8500,
    floorPrice: 7000,
    photoUrl: "https://images.pexels.com/photos/2519374/pexels-photo-2519374.jpeg?auto=compress&w=800",
  },

  // ══════════════════════════════════════════════════════
  // OTHER — Miscellaneous (no strong clusters)
  // ══════════════════════════════════════════════════════
  {
    title: "Fender Player Stratocaster Electric Guitar",
    description: "3-Color Sunburst, maple fretboard. Alder body, alnico pickups. Includes gig bag. Played at home only.",
    category: "other",
    condition: "like_new",
    tags: ["fender", "guitar", "electric", "stratocaster", "music"],
    targetPrice: 600,
    floorPrice: 450,
    photoUrl: "https://images.pexels.com/photos/1656415/pexels-photo-1656415.jpeg?auto=compress&w=800",
  },
  {
    title: "Yamaha P-125 Digital Piano",
    description: "88 weighted keys, GHS action. Built-in speakers, USB MIDI. Includes stand and sustain pedal.",
    category: "other",
    condition: "good",
    tags: ["yamaha", "piano", "digital", "keyboard", "music"],
    targetPrice: 450,
    floorPrice: 340,
    photoUrl: "https://images.pexels.com/photos/164743/pexels-photo-164743.jpeg?auto=compress&w=800",
  },
  {
    title: "Settlers of Catan Board Game Bundle",
    description: "Base game + Seafarers + Cities & Knights expansions. All components complete, cards sleeved. Played 20+ times.",
    category: "other",
    condition: "good",
    tags: ["board-game", "catan", "strategy", "tabletop", "game"],
    targetPrice: 60,
    floorPrice: 35,
    photoUrl: "https://images.pexels.com/photos/776654/pexels-photo-776654.jpeg?auto=compress&w=800",
  },
];

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const db = createDb(process.env.DATABASE_URL!);

  console.log("🌱 Creating 40 more dummy users (11-50)...\n");

  const userIds: string[] = [];

  for (let i = 11; i <= 50; i++) {
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

  console.log(`\n📦 Creating ${LISTINGS.length} listings...\n`);

  for (let i = 0; i < LISTINGS.length; i++) {
    const listing = LISTINGS[i];
    const userId = userIds[i];
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + 14 + Math.floor(Math.random() * 14)); // 2-4 weeks

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

  console.log(`\n🎉 Batch 2 seed complete! Now run embeddings backfill:`);
  console.log("   npx tsx src/scripts/backfill-embeddings.ts\n");
  process.exit(0);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});

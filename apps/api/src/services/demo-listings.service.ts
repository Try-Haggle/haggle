import { type Database, eq, listingDrafts, listingsPublished, sql } from "@haggle/db";
import { DEFAULT_NEGOTIATION_AGENT_PRESET_ID } from "@haggle/shared";
import {
  DOGFOOD_SELLER_USER_ID,
  type DogfoodAuthEnv,
  isDogfoodAuthRouteEnabled,
} from "../lib/dogfood-auth-gate.js";

const DEMO_NOTICE = "Demo listing for Haggle staging — not a real item.";
const PHOTO_BASE = "https://images.unsplash.com/";

/** Stable draft IDs and public IDs let multiple API boots safely converge. */
export const DEMO_LISTINGS = [
  {
    id: "56a20d82-d62d-54ce-b5fa-f5f8907626e8",
    publicId: "demo01",
    title: "Sony WH-1000XM5 headphones",
    category: "electronics",
    condition: "like_new",
    target: "265.00",
    floor: "205.00",
    photo: "photo-1505740420928-5e560c06d30e",
    detail: "Black, lightly used, with case and USB-C cable.",
  },
  {
    id: "7c52bea7-2735-5619-ab92-cda7dcbd9dbf",
    publicId: "demo02",
    title: "Fujifilm X-T30 camera kit",
    category: "electronics",
    condition: "good",
    target: "820.00",
    floor: "650.00",
    photo: "photo-1516035069371-29a1b244cc32",
    detail: "Camera and kit lens; normal wear on the body, clean glass.",
  },
  {
    id: "a0204796-ae1b-5068-8b5e-47e3e52a6824",
    publicId: "demo03",
    title: "Vintage denim jacket",
    category: "clothing",
    condition: "good",
    target: "85.00",
    floor: "65.00",
    photo: "photo-1544022613-e87ca75a784a",
    detail: "Medium wash, size M, broken in with no tears.",
  },
  {
    id: "024119d8-f829-54a9-9ac4-571c05abe44e",
    publicId: "demo04",
    title: "Leather crossbody bag",
    category: "clothing",
    condition: "like_new",
    target: "145.00",
    floor: "112.00",
    photo: "photo-1547949003-9792a18a2601",
    detail: "Tan leather with adjustable strap and clean interior.",
  },
  {
    id: "351b8666-13d7-5bfd-bc9e-9fbea0f4672e",
    publicId: "demo05",
    title: "Mid-century style desk lamp",
    category: "furniture",
    condition: "good",
    target: "65.00",
    floor: "49.00",
    photo: "photo-1507473885765-e6ed057f782c",
    detail: "Warm brass finish; tested and working, minor scuffs.",
  },
  {
    id: "18356bb5-4858-555b-8c50-3b34b19e7665",
    publicId: "demo06",
    title: "Walnut accent chair",
    category: "furniture",
    condition: "good",
    target: "320.00",
    floor: "245.00",
    photo: "photo-1503602642458-232111445657",
    detail: "Solid wood frame and charcoal upholstery; light seat wear.",
  },
  {
    id: "33a87ee8-842a-5738-8c82-306d26b42d2f",
    publicId: "demo07",
    title: "Wilson tennis racket",
    category: "sports",
    condition: "good",
    target: "95.00",
    floor: "72.00",
    photo: "photo-1622279457486-62dcc4a431d6",
    detail: "Adult racket, recently restrung; grip shows use.",
  },
  {
    id: "a1260262-2842-5ae5-997f-c9886b8b3c7f",
    publicId: "demo08",
    title: "Hybrid commuter bicycle",
    category: "sports",
    condition: "good",
    target: "475.00",
    floor: "370.00",
    photo: "photo-1485965120184-e220f721d03e",
    detail: "Medium frame, tuned brakes and gears, cosmetic scratches.",
  },
  {
    id: "ea01d714-cde4-52dd-bd83-c6e63434186a",
    publicId: "demo09",
    title: "Retro instant camera",
    category: "collectibles",
    condition: "fair",
    target: "48.00",
    floor: "36.00",
    photo: "photo-1526170375885-4d8ecf77b99f",
    detail: "Tested shutter and flash; surface wear, film not included.",
  },
  {
    id: "ca0c7ed3-ff63-5f3b-ab16-d5afc181938a",
    publicId: "demo10",
    title: "Vintage turntable",
    category: "collectibles",
    condition: "good",
    target: "1200.00",
    floor: "930.00",
    photo: "photo-1461360228754-6e81c478b882",
    detail: "Serviced belt drive with dust cover; cartridge included.",
  },
] as const;

/** Called once on boot. The existing dogfood gate also refuses production. */
export async function ensureDemoListings(
  db: Database,
  env: DogfoodAuthEnv = process.env,
  log: Pick<Console, "info" | "warn"> = console,
): Promise<number> {
  if (!isDogfoodAuthRouteEnabled(env)) return 0;

  try {
    const users = await db.execute<{ id: string }>(
      sql`SELECT id FROM auth.users WHERE id = ${DOGFOOD_SELLER_USER_ID} LIMIT 1`,
    );
    if (users.length === 0) {
      log.warn("Demo listings skipped: dogfood seller user is missing");
      return 0;
    }

    let inserted = 0;
    for (const item of DEMO_LISTINGS) {
      const [existing] = await db
        .select({ id: listingsPublished.id })
        .from(listingsPublished)
        .where(eq(listingsPublished.publicId, item.publicId))
        .limit(1);
      if (existing) continue;

      const draft = {
        id: item.id,
        userId: DOGFOOD_SELLER_USER_ID,
        status: "published" as const,
        title: `[Demo] ${item.title}`,
        description: `${DEMO_NOTICE}\n${item.detail}`,
        category: item.category,
        condition: item.condition,
        photoUrl: `${PHOTO_BASE}${item.photo}?auto=format&fit=crop&w=1200&q=85`,
        targetPrice: item.target,
        floorPrice: item.floor,
        tags: [item.category, "demo"],
        negotiationAgentSnapshot: { preset: DEFAULT_NEGOTIATION_AGENT_PRESET_ID },
        agentId: DEFAULT_NEGOTIATION_AGENT_PRESET_ID,
      };
      await db
        .insert(listingDrafts)
        .values(draft)
        .onConflictDoNothing({ target: listingDrafts.id });
      const rows = await db
        .insert(listingsPublished)
        .values({ publicId: item.publicId, draftId: item.id, snapshotJson: draft })
        .onConflictDoNothing({ target: listingsPublished.publicId })
        .returning({ id: listingsPublished.id });
      inserted += rows.length;
    }
    log.info(`Demo listings ensured: ${inserted} inserted`);
    return inserted;
  } catch (error) {
    log.warn({ error }, "Demo listings could not be ensured; API boot continues");
    return 0;
  }
}

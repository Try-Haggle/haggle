/**
 * Tag Garden — Initial Seed (v2: taxonomy-based)
 *
 * 태그 vs 스펙 구분 원칙:
 *   TAG  = 구매자가 검색창에 치는 것 (discovery 용도)
 *   SPEC = 제품 상세 사양표에 있는 것 (comparison 용도, listing attribute로 관리)
 *
 * 태그 카테고리:
 *   category — 최상위 분류 (electronics, fashion, sports, home, vehicles, music)
 *   product  — 제품 유형 (laptop, headphones, sneakers, guitar)
 *   brand    — 제조사/브랜드 (apple, nike, sony)
 *   feature  — 검색 가능한 기능/특성 (wireless, noise-cancelling, ergonomic)
 *   condition — 제품 상태 (vintage, used, sealed)
 *   style    — 미학/디자인 (retro, mid-century, classic, western)
 *   material — 소재 (denim, wood, walnut, fleece)
 *   activity — 사용 목적/용도 (fitness, cycling, photography, gaming)
 *
 * 스펙으로 제외된 항목 (listing structured attribute로 관리):
 *   모델번호: m3, 550, 883, 501, 330i, f-150, model-3, camry, civic, presage
 *   칩/부품: intel, thunderbolt
 *   색상/컬러웨이: panda
 *   차량속성: one-owner, low-mileage, 4x4
 *   제품등급: pro (너무 모호)
 *   게임장르: strategy
 *   액세서리: s-pen, pencil, power-adapter, carrying-case, charger
 *   비즈니스용: business
 *
 * Usage:
 *   npx tsx apps/api/src/scripts/seed-tag-garden.ts
 */

import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(import.meta.dirname, "../../../../.env") });
config({ path: resolve(import.meta.dirname, "../../.env"), override: false });

import { createDb, sql } from "@haggle/db";
const db = createDb(process.env.DATABASE_URL!);

// ─── Step 1: Create tables ────────────────────────────────

async function createTables() {
  console.log("🏗️  테이블 생성...");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS tags (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'CANDIDATE',
      category TEXT NOT NULL,
      use_count INTEGER NOT NULL DEFAULT 0,
      parent_id UUID,
      idf NUMERIC(8,4) NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL DEFAULT 'USER',
      aliases TEXT[] NOT NULL DEFAULT '{}',
      last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS tags_normalized_name_idx ON tags(normalized_name)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS tag_edges (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      parent_tag_id UUID NOT NULL,
      child_tag_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT tag_edges_unique UNIQUE (parent_tag_id, child_tag_id)
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS tag_edges_parent_idx ON tag_edges(parent_tag_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS tag_edges_child_idx ON tag_edges(child_tag_id)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS tag_suggestions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      label TEXT NOT NULL,
      normalized_label TEXT NOT NULL,
      suggested_by TEXT NOT NULL,
      first_seen_listing_id UUID,
      occurrence_count INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'PENDING',
      merged_into_tag_id UUID,
      reviewed_by UUID,
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT tag_suggestions_normalized_unique UNIQUE (normalized_label)
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS tag_suggestions_status_idx ON tag_suggestions(status)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS tag_placement_cache (
      cache_key TEXT PRIMARY KEY,
      selected_tag_ids TEXT[] NOT NULL,
      reasoning TEXT,
      missing_tags TEXT[] NOT NULL DEFAULT '{}',
      model_version TEXT NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  console.log("  ✅ tags, tag_edges, tag_suggestions, tag_placement_cache");
}

// ─── Step 2: Tag taxonomy ─────────────────────────────────

interface TagDef {
  name: string;
  category: string;
  aliases?: string[];
}

// 리스팅 데이터에 없지만 DAG 상위에 필요한 가상 카테고리 태그
const VIRTUAL_CATEGORY_TAGS: TagDef[] = [
  { name: "electronics", category: "category" },
  { name: "fashion", category: "category" },
  { name: "sports", category: "category" },
  { name: "home", category: "category" },
  { name: "vehicles", category: "category" },
  { name: "music", category: "category" },
  { name: "gaming", category: "category" },
];

// 태그 카테고리 매핑 — 실제 데이터 기반
// key = normalized tag name, value = category
const TAG_CATEGORY: Record<string, string> = {
  // ── product (제품 유형) ──
  laptop: "product",
  headphones: "product",
  sneakers: "product",
  shoes: "product",
  car: "product",
  sedan: "product",
  truck: "product",
  pickup: "product",
  motorcycle: "product",
  cruiser: "product",
  guitar: "product",
  piano: "product",
  keyboard: "product",
  tablet: "product",
  monitor: "product",
  camera: "product",
  blender: "product",
  mixer: "product",
  watch: "product",
  sunglasses: "product",
  jacket: "product",
  jeans: "product",
  sweater: "product",
  bag: "product",
  desk: "product",
  bookshelf: "product",
  dresser: "product",
  table: "product",
  "coffee-table": "product",
  fan: "product",
  iron: "product",
  mat: "product",
  dumbbells: "product",
  speaker: "product",
  dock: "product",
  stand: "product",
  case: "product",
  sleeve: "product",
  oven: "product",
  "air-fryer": "product",
  "air-purifier": "product",
  weights: "product",
  racket: "product",
  "board-game": "product",
  snowboard: "product",
  airpods: "product",
  ipad: "product",

  // ── brand (브랜드/제조사) ──
  apple: "brand",
  nike: "brand",
  sony: "brand",
  samsung: "brand",
  toyota: "brand",
  honda: "brand",
  ford: "brand",
  bmw: "brand",
  tesla: "brand",
  harley: "brand",
  lenovo: "brand",
  dell: "brand",
  adidas: "brand",
  "new-balance": "brand",
  "ray-ban": "brand",
  bose: "brand",
  sennheiser: "brand",
  jbl: "brand",
  lg: "brand",
  dyson: "brand",
  philips: "brand",
  ikea: "brand",
  "west-elm": "brand",
  seiko: "brand",
  vitamix: "brand",
  breville: "brand",
  kitchenaid: "brand",
  nespresso: "brand",
  bowflex: "brand",
  nordictrack: "brand",
  peloton: "brand",
  fender: "brand",
  yamaha: "brand",
  burton: "brand",
  wilson: "brand",
  yonex: "brand",
  head: "brand",
  callaway: "brand",
  lululemon: "brand",
  patagonia: "brand",
  keychron: "brand",
  caldigit: "brand",
  wrangler: "brand",
  levis: "brand",
  jordan: "brand",

  // ── feature (검색 가능한 기능/특성) ──
  wireless: "feature",
  bluetooth: "feature",
  "noise-cancelling": "feature",
  "usb-c": "feature",
  electric: "feature",
  portable: "feature",
  ergonomic: "feature",
  "smart-home": "feature",
  "open-back": "feature",
  mirrorless: "feature",
  ev: "feature",
  oled: "feature",
  "4k": "feature",
  hdr: "feature",
  led: "feature",
  wired: "feature",
  automatic: "feature",
  mechanical: "feature",
  digital: "feature",
  audiophile: "feature",

  // ── condition (제품 상태) ──
  vintage: "condition",

  // ── style (미학/디자인) ──
  retro: "style",
  "mid-century": "style",
  classic: "style",
  western: "style",
  cowboy: "style",
  luxury: "style",

  // ── material (소재) ──
  denim: "material",
  fleece: "material",
  wood: "material",
  walnut: "material",

  // ── activity (사용 목적/용도) ──
  fitness: "activity",
  exercise: "activity",
  sports: "activity",
  cycling: "activity",
  tennis: "activity",
  badminton: "activity",
  golf: "activity",
  skiing: "activity",
  running: "activity",
  photography: "activity",
  baking: "activity",
  coffee: "activity",
  espresso: "activity",
  smoothie: "activity",
  gaming: "activity",
  outdoor: "activity",
  winter: "activity",

  // ── 기타 (분류 보류) ──
  accessories: "product",
  accessory: "product",
  appliance: "product",
  furniture: "product",
  kitchen: "product",
  bedroom: "product",
  lighting: "product",
  music: "activity",
  game: "activity",
  tabletop: "activity",
  catan: "product",
  "hue": "brand",
  protective: "feature",
  trucker: "style",
  club: "product",
  driver: "product",
  "pro-staff": "product",
  ultraboost: "product",
  dunk: "product",
  stratocaster: "product",
  wayfarer: "product",
  galaxy: "product",
  macbook: "product",
  thinkpad: "product",
  xps: "product",
  yoga: "product",
  ultrabook: "product",
  bike: "product",
  android: "feature",
  storage: "feature",
};

// 스펙으로 제외 — 리스팅 structured attribute로 관리해야 할 것들
const EXCLUDED_AS_SPEC = new Set([
  "m3",             // 칩 모델 → spec: chip=M3
  "intel",          // 칩 브랜드 → spec: processor=Intel
  "thunderbolt",    // 포트 타입 → spec: port=Thunderbolt
  "550",            // 모델번호 (New Balance 550)
  "883",            // 모델번호 (Harley 883)
  "501",            // 모델번호 (Levi's 501)
  "330i",           // 모델번호 (BMW 330i)
  "f-150",          // 모델번호 (Ford F-150)
  "model-3",        // 모델번호 (Tesla Model 3)
  "camry",          // 모델명 (Toyota Camry)
  "civic",          // 모델명 (Honda Civic)
  "presage",        // 모델명 (Seiko Presage)
  "astrox",         // 모델명 (Yonex Astrox)
  "pro",            // 너무 모호 (MacBook Pro? iPad Pro? Pro 등급?)
  "panda",          // 컬러웨이 → spec: colorway=Panda
  "one-owner",      // 차량 이력 → spec: owners=1
  "low-mileage",    // 차량 상태 → spec: mileage=low
  "4x4",            // 구동 방식 → spec: drivetrain=4x4
  "s-pen",          // 포함 액세서리 → spec: includes=S-Pen
  "pencil",         // 포함 액세서리 → spec: includes=Apple Pencil
  "power-adapter",  // 포함 액세서리
  "carrying-case",  // 포함 액세서리
  "charger",        // 포함 액세서리
  "business",       // 모호 (ThinkPad 용도)
  "strategy",       // 보드게임 장르 → spec: genre=Strategy
]);

// ─── Step 3: DAG hierarchy ────────────────────────────────
//
// 3단계 트리: category → product/activity → specific
//
// child → parent 관계
const PARENT_MAP: Record<string, string> = {
  // ── electronics 하위 ──
  laptop: "electronics",
  headphones: "electronics",
  tablet: "electronics",
  monitor: "electronics",
  camera: "electronics",
  keyboard: "electronics",
  speaker: "electronics",
  airpods: "electronics",
  ipad: "electronics",
  "smart-home": "electronics",

  // ── fashion 하위 ──
  shoes: "fashion",
  jacket: "fashion",
  jeans: "fashion",
  sweater: "fashion",
  bag: "fashion",
  sunglasses: "fashion",
  accessories: "fashion",

  // 하위 제품 → 제품
  sneakers: "shoes",
  macbook: "laptop",
  thinkpad: "laptop",
  xps: "laptop",
  yoga: "laptop",
  ultrabook: "laptop",
  dunk: "sneakers",
  ultraboost: "sneakers",

  // ── sports 하위 ──
  fitness: "sports",
  cycling: "sports",
  tennis: "sports",
  badminton: "sports",
  golf: "sports",
  skiing: "sports",
  running: "sports",
  racket: "sports",
  dumbbells: "fitness",
  weights: "fitness",
  mat: "fitness",
  bike: "cycling",
  snowboard: "skiing",
  club: "golf",
  driver: "golf",

  // ── home 하위 ──
  furniture: "home",
  kitchen: "home",
  appliance: "home",
  lighting: "home",
  bedroom: "home",
  desk: "furniture",
  bookshelf: "furniture",
  dresser: "furniture",
  table: "furniture",
  "coffee-table": "furniture",
  blender: "kitchen",
  mixer: "kitchen",
  oven: "kitchen",
  "air-fryer": "kitchen",
  "air-purifier": "appliance",
  fan: "appliance",
  iron: "appliance",

  // ── vehicles 하위 ──
  car: "vehicles",
  truck: "vehicles",
  motorcycle: "vehicles",
  sedan: "car",
  pickup: "truck",
  cruiser: "motorcycle",

  // ── music 하위 ──
  guitar: "music",
  piano: "music",
  stratocaster: "guitar",

  // ── brand → category 관계 ──
  apple: "electronics",
  samsung: "electronics",
  sony: "electronics",
  lg: "electronics",
  dell: "electronics",
  lenovo: "electronics",
  bose: "electronics",
  sennheiser: "electronics",
  jbl: "electronics",
  keychron: "electronics",
  caldigit: "electronics",
  dyson: "home",
  philips: "home",
  ikea: "home",
  "west-elm": "home",
  kitchenaid: "kitchen",
  vitamix: "kitchen",
  breville: "kitchen",
  nespresso: "kitchen",
  hue: "lighting",
  nike: "fashion",
  adidas: "fashion",
  "new-balance": "fashion",
  "ray-ban": "fashion",
  levis: "fashion",
  jordan: "sneakers",
  lululemon: "fashion",
  patagonia: "fashion",
  wrangler: "fashion",
  toyota: "vehicles",
  honda: "vehicles",
  ford: "vehicles",
  bmw: "vehicles",
  tesla: "vehicles",
  harley: "motorcycle",
  fender: "music",
  yamaha: "music",
  wilson: "sports",
  yonex: "sports",
  head: "sports",
  callaway: "golf",
  bowflex: "fitness",
  nordictrack: "fitness",
  peloton: "fitness",
  burton: "skiing",
  seiko: "electronics",

  // ── feature 관계 ──
  bluetooth: "wireless",
  "noise-cancelling": "headphones",
  oled: "monitor",
  "4k": "monitor",
  hdr: "monitor",

  // ── style/material ──
  "mid-century": "furniture",

  // ── activity ──
  exercise: "fitness",
  espresso: "coffee",
  smoothie: "blender",
  baking: "kitchen",
  photography: "camera",

  // ── gaming ──
  "board-game": "gaming",
  catan: "board-game",
  tabletop: "gaming",
};

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "-");
}

// ─── Step 4: Gather + filter tag usage ────────────────────

interface TagUsage {
  tag: string;
  count: number;
}

async function gatherTagUsage(): Promise<TagUsage[]> {
  const rows = await db.execute(sql`
    SELECT elem AS tag, COUNT(*)::int AS cnt
    FROM listings_published, jsonb_array_elements_text(snapshot_json->'tags') AS elem
    GROUP BY elem
    ORDER BY cnt DESC
  `);
  const all = (rows as unknown as Array<{ tag: string; cnt: number }>).map((r) => ({
    tag: r.tag,
    count: r.cnt,
  }));

  // 스펙 제외 + 로그
  const included: TagUsage[] = [];
  const excluded: TagUsage[] = [];
  for (const item of all) {
    if (EXCLUDED_AS_SPEC.has(normalize(item.tag))) {
      excluded.push(item);
    } else {
      included.push(item);
    }
  }

  if (excluded.length > 0) {
    console.log(`\n🔧 스펙으로 제외 (listing attribute로 관리):`);
    for (const { tag, count } of excluded) {
      console.log(`  ✂️  ${tag.padEnd(20)} cnt=${count}`);
    }
  }

  return included;
}

// ─── Step 5: Seed tags ────────────────────────────────────

async function seedTags(usage: TagUsage[]) {
  // Count total listings for IDF
  const totalResult = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM listings_published`);
  const totalListings = (totalResult as unknown as Array<{ cnt: number }>)[0]?.cnt ?? 1;

  const tagIdMap = new Map<string, string>(); // normalized → uuid

  // 5a. 가상 카테고리 태그 먼저 삽입
  console.log(`\n📂 가상 카테고리 태그 (${VIRTUAL_CATEGORY_TAGS.length}개):`);
  for (const vtag of VIRTUAL_CATEGORY_TAGS) {
    const normalized = normalize(vtag.name);
    // 가상 태그는 use_count=0, status=OFFICIAL (항상 존재해야 하므로)
    const result = await db.execute(sql`
      INSERT INTO tags (name, normalized_name, status, category, use_count, idf, created_by, aliases)
      VALUES (${vtag.name}, ${normalized}, 'OFFICIAL', ${vtag.category}, ${0}, ${0}, 'IMPORT', ${sql`ARRAY[]::text[]`})
      ON CONFLICT (normalized_name) DO UPDATE SET
        category = EXCLUDED.category,
        status = EXCLUDED.status
      RETURNING id
    `);
    const id = (result as unknown as Array<{ id: string }>)[0]?.id;
    if (id) tagIdMap.set(normalized, id);
    console.log(`  📂 OFFICIAL    ${vtag.name.padEnd(20)} [${vtag.category}]`);
  }

  // 5b. 실제 사용 태그 삽입
  console.log(`\n🌱 실제 사용 태그 (${usage.length}개):`);
  for (const { tag, count } of usage) {
    const normalized = normalize(tag);

    // 가상 카테고리와 중복이면 use_count만 업데이트
    if (tagIdMap.has(normalized)) {
      await db.execute(sql`
        UPDATE tags SET use_count = ${count} WHERE normalized_name = ${normalized}
      `);
      continue;
    }

    const category = TAG_CATEGORY[normalized] ?? "product";

    let status: string;
    if (count >= 3) status = "OFFICIAL";
    else if (count >= 2) status = "EMERGING";
    else status = "CANDIDATE";

    const idf = Math.max(0.1, Math.log(totalListings / count)).toFixed(4);

    const result = await db.execute(sql`
      INSERT INTO tags (name, normalized_name, status, category, use_count, idf, created_by, aliases)
      VALUES (${tag}, ${normalized}, ${status}, ${category}, ${count}, ${idf}, 'IMPORT', ${sql`ARRAY[]::text[]`})
      ON CONFLICT (normalized_name) DO UPDATE SET
        use_count = EXCLUDED.use_count,
        status = EXCLUDED.status,
        idf = EXCLUDED.idf,
        category = EXCLUDED.category
      RETURNING id
    `);
    const id = (result as unknown as Array<{ id: string }>)[0]?.id;
    if (id) tagIdMap.set(normalized, id);

    const icon = status === "OFFICIAL" ? "🌳" : status === "EMERGING" ? "🌿" : "🌱";
    console.log(`  ${icon} ${status.padEnd(10)} ${tag.padEnd(20)} cnt=${String(count).padEnd(3)} idf=${idf}  [${category}]`);
  }

  return tagIdMap;
}

// ─── Step 6: DAG edges ────────────────────────────────────

async function seedEdges(tagIdMap: Map<string, string>) {
  console.log("\n🔗 DAG 관계 설정...");
  let edgeCount = 0;
  const skipped: string[] = [];

  for (const [child, parent] of Object.entries(PARENT_MAP)) {
    const childId = tagIdMap.get(normalize(child));
    const parentId = tagIdMap.get(normalize(parent));
    if (!childId || !parentId) {
      if (!childId) skipped.push(`${child} (없음)`);
      // parent가 없으면 그냥 skip (가상 카테고리에 없는 경우)
      continue;
    }

    await db.execute(sql`
      INSERT INTO tag_edges (parent_tag_id, child_tag_id)
      VALUES (${parentId}, ${childId})
      ON CONFLICT DO NOTHING
    `);
    console.log(`  ${parent} → ${child}`);
    edgeCount++;
  }

  if (skipped.length > 0) {
    console.log(`\n  ⚠️  건너뜀 (child 태그 없음): ${skipped.join(", ")}`);
  }
  console.log(`  ✅ ${edgeCount}개 edge`);
}

// ─── Main ─────────────────────────────────────────────────

async function main() {
  console.log("🌻 Tag Garden — Initial Seed v2 (taxonomy-based)\n");

  // 기존 데이터 정리
  console.log("🧹 기존 태그 데이터 정리...");
  await db.execute(sql`DELETE FROM tag_edges`);
  await db.execute(sql`DELETE FROM tags`);
  console.log("  ✅ tag_edges, tags 초기화 완료");

  await createTables();
  const usage = await gatherTagUsage();
  const tagIdMap = await seedTags(usage);
  await seedEdges(tagIdMap);

  // Summary
  const catCounts: Record<string, number> = {};
  for (const { tag } of usage) {
    const cat = TAG_CATEGORY[normalize(tag)] ?? "product";
    catCounts[cat] = (catCounts[cat] ?? 0) + 1;
  }

  const officials = usage.filter((u) => u.count >= 3).length + VIRTUAL_CATEGORY_TAGS.length;
  const emerging = usage.filter((u) => u.count === 2).length;
  const candidates = usage.filter((u) => u.count === 1).length;
  const totalTags = usage.length + VIRTUAL_CATEGORY_TAGS.length;

  console.log(`\n${"═".repeat(55)}`);
  console.log(`  🌻 Tag Garden v2 Seeded`);
  console.log(`${"═".repeat(55)}`);
  console.log(`  🌳 OFFICIAL:   ${officials}개 (3+ 사용 + 가상 카테고리)`);
  console.log(`  🌿 EMERGING:   ${emerging}개 (2회 사용)`);
  console.log(`  🌱 CANDIDATE:  ${candidates}개 (1회 사용)`);
  console.log(`  🔗 DAG edges:  ${Object.keys(PARENT_MAP).length}개 정의`);
  console.log(`  ✂️  스펙 제외:  ${EXCLUDED_AS_SPEC.size}개`);
  console.log(`  📊 Total:      ${totalTags}개 태그`);
  console.log(`\n  📂 카테고리별:`);
  console.log(`     category:  ${VIRTUAL_CATEGORY_TAGS.length}개`);
  for (const [cat, cnt] of Object.entries(catCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${cat.padEnd(11)}: ${cnt}개`);
  }
  console.log(`${"═".repeat(55)}\n`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});

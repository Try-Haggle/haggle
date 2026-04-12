/**
 * Tag Placement few-shot pool + selection helper (Step 61).
 *
 * - 8 hand-written examples covering electronics/fashion/gaming/home/generic.
 * - `selectFewShots(category)` picks 2–3 examples deterministically based on
 *   substring matching against a listing's category string.
 * - `toChatMessages` flattens selected examples into the [user,assistant,...]
 *   array shape consumed by the OpenAI chat completions API.
 *
 * Examples #1 (iPhone 17 Pro), #3 (vintage leather jacket), and #5
 * (Nintendo Switch OLED) are verbatim copies of the previous inline
 * FEW_SHOT_MESSAGES. Do not edit those without explicit approval —
 * they are the regression safety net for Step 61 prompt drift.
 *
 * See handoff/ARCHITECT-BRIEF-step60-62.md §Step 61.
 */

export type FewShotCategory =
  | "electronics"
  | "fashion"
  | "gaming"
  | "home"
  | "collectibles"
  | "generic";

export interface FewShotExample {
  /** Primary category this example teaches. */
  category: FewShotCategory;
  /** Matching keywords in the listing's category string (lowercase, substring match). */
  categoryKeywords: readonly string[];
  /** Chat messages — always a [user, assistant] pair. */
  messages: readonly [
    { role: "user"; content: string },
    { role: "assistant"; content: string },
  ];
}

// ─── Pool (exactly 8 entries) ────────────────────────────────────────

export const FEW_SHOT_POOL: readonly FewShotExample[] = [
  // #1 — electronics — iPhone 17 Pro (verbatim from legacy inline)
  {
    category: "electronics",
    categoryKeywords: ["electronic", "phone", "iphone", "computer", "laptop"],
    messages: [
      {
        role: "user",
        content: `LISTING:
title: 아이폰 17 Pro 256GB 네이비 미개봉
description: (none)
category_path: (none)

CANDIDATES:
t01 iphone-17-pro [idf=4.2, parent=t05]
t02 256gb [idf=2.1]
t03 navy [idf=1.8]
t04 sealed [idf=3.5]
t05 iphone-17 [idf=3.8]

Return JSON matching the schema.`,
      },
      {
        role: "assistant",
        content:
          '{"selected_tag_ids":["t01","t02","t03","t04"],"reasoning":"iphone-17-pro implies iphone-17/iphone/phone/apple via DAG ancestors","proposed_tags":[]}',
      },
    ],
  },

  // #2 — electronics — Galaxy S24 Ultra (NEW)
  {
    category: "electronics",
    categoryKeywords: ["electronic", "phone", "android", "galaxy"],
    messages: [
      {
        role: "user",
        content: `LISTING:
title: Samsung Galaxy S24 Ultra 512GB Titanium Black unlocked
description: (none)
category_path: (none)

CANDIDATES:
t01 galaxy-s24-ultra [idf=4.0, parent=t05]
t02 512gb [idf=2.3]
t03 titanium-black [idf=1.9]
t04 unlocked [idf=2.6]
t05 galaxy-s24 [idf=3.6]

Return JSON matching the schema.`,
      },
      {
        role: "assistant",
        content:
          '{"selected_tag_ids":["t01","t02","t03","t04"],"reasoning":"galaxy-s24-ultra implies galaxy-s24/galaxy/android/phone via DAG","proposed_tags":[{"label":"s-pen-support","category":"feature","reason":"S24 Ultra includes S Pen, not captured by any candidate"}]}',
      },
    ],
  },

  // #3 — fashion — Vintage leather jacket (teaches description mining + material proposal)
  {
    category: "fashion",
    categoryKeywords: ["fashion", "clothing", "apparel", "jacket", "shoe"],
    messages: [
      {
        role: "user",
        content: `LISTING:
title: 빈티지 가죽 자켓 M사이즈 브라운
description: Schott Perfecto 618 from the 1970s. Real cowhide leather, heavy YKK zippers. Some patina on elbows. Made in USA.
category_path: Men's Clothing > Coats & Jackets

CANDIDATES:
t01 leather-jacket [idf=3.1, parent=t05]
t02 vintage [idf=2.8]
t03 brown [idf=1.5]
t04 size-m [idf=1.2]
t05 jacket [idf=2.0]

Return JSON matching the schema.`,
      },
      {
        role: "assistant",
        content:
          '{"selected_tag_ids":["t01","t02","t03","t04"],"reasoning":"leather-jacket implies jacket/outerwear/clothing via DAG","proposed_tags":[{"label":"schott-perfecto","category":"style","reason":"specific iconic model name buyers search for"},{"label":"cowhide","category":"material","reason":"leather type explicitly stated in description"}]}',
      },
    ],
  },

  // #4 — fashion — Nike Air Jordan 1 (teaches colorway + condition detail)
  {
    category: "fashion",
    categoryKeywords: ["fashion", "shoe", "sneaker"],
    messages: [
      {
        role: "user",
        content: `LISTING:
title: Nike Air Jordan 1 High OG Chicago size 10 used
description: 8/10 condition. Slight creasing on toe box, soles have some outdoor wear. Comes with original box and extra laces.
category_path: Sneakers

CANDIDATES:
t01 air-jordan-1 [idf=3.9, parent=t05]
t02 size-10 [idf=1.3]
t03 used [idf=1.1]
t05 jordan [idf=3.0]

Return JSON matching the schema.`,
      },
      {
        role: "assistant",
        content:
          '{"selected_tag_ids":["t01","t02","t03"],"reasoning":"air-jordan-1 implies jordan/sneaker/shoe/nike via DAG","proposed_tags":[{"label":"chicago","category":"style","reason":"Chicago is the specific colorway buyers search for"}]}',
      },
    ],
  },

  // #5 — gaming — Nintendo Switch OLED (verbatim from legacy inline)
  {
    category: "gaming",
    categoryKeywords: [
      "gaming",
      "console",
      "game",
      "nintendo",
      "playstation",
      "xbox",
    ],
    messages: [
      {
        role: "user",
        content: `LISTING:
title: 닌텐도 스위치 OLED 화이트 조이콘 포함
description: (none)
category_path: (none)

CANDIDATES:
t01 switch [idf=3.2, parent=t03]
t02 white [idf=1.4]
t03 nintendo [idf=2.9]

Return JSON matching the schema.`,
      },
      {
        role: "assistant",
        content:
          '{"selected_tag_ids":["t01","t02"],"reasoning":"switch implies nintendo/console/gaming; OLED variant missing","proposed_tags":[{"label":"switch-oled","category":"feature","reason":"OLED variant is a key differentiator not in candidates"}]}',
      },
    ],
  },

  // #6 — gaming — PS5 Slim (NEW)
  {
    category: "gaming",
    categoryKeywords: ["gaming", "console", "playstation"],
    messages: [
      {
        role: "user",
        content: `LISTING:
title: Sony PS5 Slim Disc Edition 1TB sealed
description: (none)
category_path: (none)

CANDIDATES:
t01 ps5-slim [idf=3.7, parent=t05]
t02 disc-edition [idf=2.2]
t03 1tb [idf=1.6]
t04 sealed [idf=3.5]
t05 ps5 [idf=3.1]

Return JSON matching the schema.`,
      },
      {
        role: "assistant",
        content:
          '{"selected_tag_ids":["t01","t02","t03","t04"],"reasoning":"ps5-slim implies ps5/playstation/console/sony via DAG","proposed_tags":[]}',
      },
    ],
  },

  // #7 — home — Herman Miller Aeron (teaches furniture size + variant)
  {
    category: "home",
    categoryKeywords: ["home", "kitchen", "furniture", "appliance"],
    messages: [
      {
        role: "user",
        content: `LISTING:
title: Herman Miller Aeron Size B Fully Loaded Remastered 2021
description: Graphite frame, PostureFit SL, adjustable arms, tilt limiter. Mesh clean, no sags. 12-year warranty transferable. Pickup only Brooklyn.
category_path: Furniture > Office

CANDIDATES:
t01 herman-miller [idf=4.5]
t02 aeron [idf=5.0, parent=t01]
t03 office-chair [idf=2.0]
t04 ergonomic [idf=2.5]
t05 used [idf=1.0]

Return JSON matching the schema.`,
      },
      {
        role: "assistant",
        content:
          '{"selected_tag_ids":["t02","t04","t05"],"reasoning":"aeron implies herman-miller/office-chair via DAG","proposed_tags":[{"label":"size-b","category":"size","reason":"chair size B is a key fit attribute buyers filter by"},{"label":"fully-loaded","category":"feature","reason":"fully loaded config distinguishes from base model"},{"label":"remastered","category":"other","reason":"remastered version is a distinct product generation"}]}',
      },
    ],
  },

  // #8 — generic — unbranded wireless earbuds (NEW, teaches missing-tag behavior)
  {
    category: "generic",
    categoryKeywords: [],
    messages: [
      {
        role: "user",
        content: `LISTING:
title: Unbranded wireless earbuds with charging case
description: (none)
category_path: (none)

CANDIDATES:
t01 wireless [idf=1.9]
t02 earbuds [idf=2.3]
t03 charging-case [idf=1.5]

Return JSON matching the schema.`,
      },
      {
        role: "assistant",
        content:
          '{"selected_tag_ids":["t01","t02","t03"],"reasoning":"no brand/model available; generic attribute tags only","proposed_tags":[{"label":"brand-unknown","category":"other","reason":"no brand identified, useful for filtering unbranded items"}]}',
      },
    ],
  },
];

// ─── Selector ────────────────────────────────────────────────────────

const MIN_SELECTED = 2;
const MAX_SELECTED = 3;

function getGenerics(): FewShotExample[] {
  return FEW_SHOT_POOL.filter((e) => e.category === "generic");
}

/**
 * Pick 2–3 few-shots for a given listing category string.
 *
 * Algorithm (deterministic, pool order is the tiebreaker):
 *  1. null/empty category → generics + diversity fallback.
 *  2. Substring-match lowercase category against each entry's categoryKeywords.
 *  3. ≥ 2 matches → return the first 3 matches (or all if fewer).
 *  4. 1 match → return [match, first generic] (2 examples).
 *  5. 0 matches → return up to 3 generics, padded from the pool if needed.
 *
 * Always returns between MIN_SELECTED (2) and MAX_SELECTED (3) examples
 * (provided the pool itself has ≥ 2 entries, which is enforced by the
 * pool-size test).
 */
export function selectFewShots(
  category: string | null,
): ReadonlyArray<FewShotExample> {
  const generics = getGenerics();

  // Case 1: null / empty → fallback path.
  if (!category || category.trim() === "") {
    return buildFallback(generics);
  }

  const needle = category.toLowerCase();
  const matches = FEW_SHOT_POOL.filter((example) =>
    example.categoryKeywords.some((kw) => kw !== "" && needle.includes(kw)),
  );

  // Case 3: ≥ 2 matches → first MAX_SELECTED.
  if (matches.length >= 2) {
    return matches.slice(0, MAX_SELECTED);
  }

  // Case 4: exactly 1 match → match + 1 generic.
  if (matches.length === 1) {
    const firstGeneric = generics[0];
    return firstGeneric ? [matches[0], firstGeneric] : [matches[0]];
  }

  // Case 5: 0 matches → generics + padding.
  return buildFallback(generics);
}

/**
 * Build a 2–3 entry fallback list: prefer generics, pad from pool order.
 */
function buildFallback(
  generics: readonly FewShotExample[],
): ReadonlyArray<FewShotExample> {
  const selected: FewShotExample[] = [...generics.slice(0, MAX_SELECTED)];
  if (selected.length >= MAX_SELECTED) return selected;

  for (const entry of FEW_SHOT_POOL) {
    if (selected.length >= MAX_SELECTED) break;
    if (!selected.includes(entry)) selected.push(entry);
  }
  return selected.slice(0, MAX_SELECTED);
}

// ─── Flattener ───────────────────────────────────────────────────────

/**
 * Flatten selected examples into the messages array consumed by the
 * OpenAI chat completions API. Preserves example order: example N's
 * user message comes before example N's assistant reply.
 */
export function toChatMessages(
  examples: ReadonlyArray<FewShotExample>,
): Array<{ role: "user" | "assistant"; content: string }> {
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const example of examples) {
    out.push({ role: example.messages[0].role, content: example.messages[0].content });
    out.push({ role: example.messages[1].role, content: example.messages[1].content });
  }
  return out;
}

import type { CategoryNode, NegotiationCheck } from "./types.js";

/**
 * Seed taxonomy (thin — proves the hierarchy across a few top categories; more
 * categories/checks are added incrementally). Top level aligns with
 * LISTING_CATEGORIES. featureKey values must match FEATURE_SCHEMA keys.
 */
export const CATEGORY_TAXONOMY: readonly CategoryNode[] = [
  {
    path: "electronics",
    checks: [
      {
        id: "working_status",
        questionKo: "정상 작동하나요? 결함이 있나요?",
        buyerAskKo: "Should the agent only consider fully working units?",
        enforcement: "soft",
      },
      {
        id: "cosmetic_grade",
        questionKo: "외관 상태(등급)는 어떤가요?",
        buyerAskKo: "What cosmetic condition are you comfortable with?",
        featureKey: "cosmetic_grade",
        enforcement: "soft",
      },
    ],
  },
  {
    path: "electronics/phones",
    checks: [
      {
        id: "battery_health",
        questionKo: "배터리 성능(%)은 얼마인가요?",
        buyerAskKo: "What minimum battery health do you want?",
        featureKey: "battery_health",
        enforcement: "soft",
      },
      {
        id: "carrier_lock",
        questionKo: "통신사 언락 상태인가요?",
        buyerAskKo: "Is an unlocked model required?",
        featureKey: "carrier_lock",
        enforcement: "soft",
      },
      {
        id: "storage_capacity",
        questionKo: "저장 용량은 얼마인가요?",
        buyerAskKo: "What storage capacity do you want?",
        featureKey: "storage_capacity",
        enforcement: "soft",
      },
    ],
  },
  {
    path: "electronics/phones/iphone",
    aliases: ["iphone", "아이폰"],
    checks: [
      {
        id: "imei_verification",
        questionKo: "IMEI가 깨끗한지(블랙리스트 아님) 확인 가능한가요?",
        buyerAskKo: "Should the agent require a clean IMEI (not lost/blacklisted) before closing?",
        featureKey: "imei_verification",
        enforcement: "hard",
        // Topic-specific only. Generic condition words (정상/깨끗/이력/clean) were removed
        // — they matched unrelated "works normally / clean exterior / no repair history".
        answerHints: ["imei", "블랙리스트", "blacklist", "분실", "도난", "장물"],
      },
      {
        id: "find_my_status",
        questionKo: "Find My(활성화 잠금)가 해제되어 있나요?",
        buyerAskKo: "Should the agent require Find My / activation lock to be off before closing?",
        featureKey: "find_my_status",
        enforcement: "hard",
        // Topic-specific only. Bare "해제" removed — it collided with carrier "잠금 해제".
        answerHints: [
          "find my",
          "파인드마이",
          "icloud",
          "아이클라우드",
          "활성화 잠금",
          "activation lock",
          "나의 찾기",
        ],
      },
    ],
  },
  {
    path: "electronics/laptops",
    aliases: ["laptop", "macbook", "notebook", "노트북"],
    checks: [
      {
        id: "battery_cycles",
        questionKo: "배터리 사이클 수는 얼마인가요?",
        buyerAskKo: "Any maximum battery cycle count you want?",
        enforcement: "soft",
      },
      {
        id: "spec_summary",
        questionKo: "CPU/RAM/저장 사양은 어떻게 되나요?",
        buyerAskKo: "Any required CPU/RAM/storage specs?",
        enforcement: "soft",
      },
    ],
  },
  {
    path: "clothing",
    aliases: ["fashion", "패션", "의류"],
    checks: [
      {
        id: "size",
        questionKo: "사이즈는 무엇인가요?",
        buyerAskKo: "What size are you looking for?",
        enforcement: "soft",
      },
      {
        id: "authenticity",
        questionKo: "정품 인증(택/영수증 등)이 가능한가요?",
        buyerAskKo:
          "Should the agent only consider items with proof of authenticity (tags/receipt)?",
        enforcement: "hard",
        // Topic-specific only. Bare "택" removed — it matched 택배(delivery)/선택(choice).
        answerHints: [
          "정품",
          "authentic",
          "가품",
          "짝퉁",
          "영수증",
          "시리얼",
          "serial",
          "보증서",
          "정가품",
        ],
      },
      {
        id: "cosmetic_grade",
        questionKo: "착용감/상태(등급)는 어떤가요?",
        buyerAskKo: "What condition / wear level are you comfortable with?",
        featureKey: "cosmetic_grade",
        enforcement: "soft",
      },
    ],
  },
  {
    path: "vehicles",
    checks: [
      {
        id: "mileage",
        questionKo: "주행거리는 얼마인가요?",
        buyerAskKo: "What maximum mileage do you want?",
        enforcement: "soft",
      },
      {
        id: "title_status",
        questionKo: "명의/소유권(등록증)이 명확한가요?",
        buyerAskKo: "Should the agent only consider clean-title vehicles?",
        enforcement: "hard",
        // Topic-specific only. Bare "이전" removed — it matched 이전에(previously/before).
        answerHints: ["명의", "소유권", "등록증", "title", "서류", "차주", "등본"],
      },
      {
        id: "service_history",
        questionKo: "정비 이력이 있나요?",
        buyerAskKo: "Do you want vehicles with service history?",
        enforcement: "soft",
      },
    ],
  },
];

const BY_PATH: ReadonlyMap<string, CategoryNode> = new Map(
  CATEGORY_TAXONOMY.map((n) => [n.path, n]),
);

/** All ancestor paths of a path, broadest first (inclusive of the path itself). */
function pathChain(path: string): string[] {
  const parts = path.split("/");
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

/** Look up a single node by exact path. */
export function getCategoryNode(path: string): CategoryNode | undefined {
  return BY_PATH.get(path);
}

/**
 * Resolve the category node paths a set of item tags match, broadest ancestor
 * first (each matched node contributes its own path plus every ancestor's).
 *
 * A node matches if any tag — or a token of a hyphenated/spaced tag — equals the
 * node's exact path, its leaf segment, or an alias. Tokenizing is essential for
 * real listings: production tags look like "iphone-15-pro" / "space-black", so the
 * "iphone" token must still match the iphone node (otherwise real phones would lose
 * their IMEI/battery checks).
 *
 * Exposed so the dynamic-learning overlay (resolveChecksWithLearned) can decide
 * which learned checks apply to a tag set with the same matching + inheritance rules.
 */
export function matchedCategoryPaths(tags: readonly string[]): string[] {
  const candidates = new Set<string>();
  for (const raw of tags) {
    const t = raw.trim().toLowerCase();
    if (!t) continue;
    candidates.add(t); // whole tag (preserves path-form tags like "electronics/phones")
    for (const seg of t.split(/[\s-]+/)) {
      if (seg) candidates.add(seg); // tokens of hyphenated/spaced tags
    }
  }

  const matchedPaths = new Set<string>();
  for (const node of CATEGORY_TAXONOMY) {
    const leaf = node.path.split("/").pop() ?? node.path;
    const hit =
      candidates.has(node.path) ||
      candidates.has(leaf) ||
      (node.aliases?.some((a) => candidates.has(a)) ?? false);
    if (hit) {
      for (const p of pathChain(node.path)) matchedPaths.add(p);
    }
  }

  return [...matchedPaths].sort((a, b) => a.split("/").length - b.split("/").length);
}

/**
 * Resolve the negotiation checks for a set of item tags, with hierarchical
 * inheritance: a matched node contributes its own checks plus every ancestor's.
 * Deduped by check id (broadest ancestor first).
 */
export function resolveChecks(tags: readonly string[]): NegotiationCheck[] {
  const ordered = matchedCategoryPaths(tags);
  const seen = new Set<string>();
  const out: NegotiationCheck[] = [];
  for (const p of ordered) {
    const node = BY_PATH.get(p);
    if (!node) continue;
    for (const c of node.checks) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
  }
  return out;
}

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
      { id: "working_status", questionKo: "정상 작동하나요? 결함이 있나요?", enforcement: "soft" },
      {
        id: "cosmetic_grade",
        questionKo: "외관 상태(등급)는 어떤가요?",
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
        featureKey: "battery_health",
        enforcement: "soft",
      },
      {
        id: "carrier_lock",
        questionKo: "통신사 언락 상태인가요?",
        featureKey: "carrier_lock",
        enforcement: "soft",
      },
      {
        id: "storage_capacity",
        questionKo: "저장 용량은 얼마인가요?",
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
        featureKey: "imei_verification",
        enforcement: "hard",
      },
      {
        id: "find_my_status",
        questionKo: "Find My(활성화 잠금)가 해제되어 있나요?",
        featureKey: "find_my_status",
        enforcement: "hard",
      },
    ],
  },
  {
    path: "electronics/laptops",
    aliases: ["laptop", "macbook", "notebook", "노트북"],
    checks: [
      { id: "battery_cycles", questionKo: "배터리 사이클 수는 얼마인가요?", enforcement: "soft" },
      { id: "spec_summary", questionKo: "CPU/RAM/저장 사양은 어떻게 되나요?", enforcement: "soft" },
    ],
  },
  {
    path: "clothing",
    aliases: ["fashion", "패션", "의류"],
    checks: [
      { id: "size", questionKo: "사이즈는 무엇인가요?", enforcement: "soft" },
      {
        id: "authenticity",
        questionKo: "정품 인증(택/영수증 등)이 가능한가요?",
        enforcement: "hard",
      },
      {
        id: "cosmetic_grade",
        questionKo: "착용감/상태(등급)는 어떤가요?",
        featureKey: "cosmetic_grade",
        enforcement: "soft",
      },
    ],
  },
  {
    path: "vehicles",
    checks: [
      { id: "mileage", questionKo: "주행거리는 얼마인가요?", enforcement: "soft" },
      { id: "title_status", questionKo: "명의/소유권(등록증)이 명확한가요?", enforcement: "hard" },
      { id: "service_history", questionKo: "정비 이력이 있나요?", enforcement: "soft" },
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
 * Resolve the negotiation checks for a set of item tags, with hierarchical
 * inheritance: a matched node contributes its own checks plus every ancestor's.
 *
 * A node matches if any tag — or a token of a hyphenated/spaced tag — equals the
 * node's exact path, its leaf segment, or an alias. Tokenizing is essential for
 * real listings: production tags look like "iphone-15-pro" / "space-black", so the
 * "iphone" token must still match the iphone node (otherwise real phones would lose
 * their IMEI/battery checks). Deduped by check id (broadest ancestor first).
 */
export function resolveChecks(tags: readonly string[]): NegotiationCheck[] {
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

  const ordered = [...matchedPaths].sort((a, b) => a.split("/").length - b.split("/").length);
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

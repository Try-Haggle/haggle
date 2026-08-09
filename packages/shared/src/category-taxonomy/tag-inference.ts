/**
 * Deterministic tag inference (Tag Garden ↔ taxonomy bridge).
 *
 * The whole criteria/PAUSE system is keyed by TAGS: `resolveChecks(tags)` drills from a
 * bare category into the node that carries the real safety gates (mattress → bed bugs,
 * car-seat → expiration/crash, iphone → IMEI). But listing tags come from a vision LLM
 * whose job is *descriptive attributes* ("256gb", "space-black", "minor-scratches") — it
 * does not reliably emit the item-type token the taxonomy needs, and it fails entirely
 * when the image is unreachable. Result: child-node hard gates silently never fire.
 *
 * This module closes that gap WITHOUT the LLM: it scans the listing's own title/description
 * for the taxonomy's controlled vocabulary (node leaves + aliases) and returns canonical
 * tags. Pure + deterministic, so it works when vision is down and is cheap to test.
 *
 * Safety posture: inference is CONSERVATIVE. An accessory listing ("iPhone case",
 * "TV stand", "car seat cover") must NOT inherit the parent item's gates, so a bare
 * accessory head-word suppresses inference entirely — we would rather infer nothing
 * (status quo: category-root checks only) than attach the wrong safety gates.
 */

import { CATEGORY_TAXONOMY } from "./taxonomy.js";

/**
 * Head nouns that mean "this listing is an ACCESSORY FOR the item", not the item.
 * Their presence (unless introduced by an inclusion marker — see below) suppresses
 * inference so a $10 phone case never inherits IMEI/activation-lock gates.
 */
const ACCESSORY_HEADS = [
  "case",
  "cases",
  "cover",
  "covers",
  "sleeve",
  "skin",
  "pouch",
  "mount",
  "holder",
  "bracket",
  "dock",
  "charger",
  "cable",
  "adapter",
  "cord",
  "protector",
  "lanyard",
  "tripod",
] as const;

/** CJK accessory heads — matched by substring (Korean compounds have no spaces). */
const ACCESSORY_HEADS_CJK = [
  "케이스",
  "커버",
  "거치대",
  "충전기",
  "케이블",
  "보호필름",
  "스트랩",
] as const;

/**
 * Words that are accessory heads ONLY in an explicit "X for Y" construction. Each is
 * commonly the listing's own subject — a handbag ("Neverfull bag"), a watch band
 * ("14k gold band"), a film camera, a stand mixer — so treating them as bare accessory
 * markers would suppress inference on the very items that most need their gates.
 */
const WEAK_ACCESSORY_HEADS = ["bag", "band", "film", "grip", "stand", "strap"] as const;

/** Words that make an accessory head explicit: "case FOR iphone", "band FITS series 9". */
const ACCESSORY_PREPOSITIONS = ["for", "fits", "compatible"] as const;

/**
 * Words that introduce a BUNDLED extra rather than the listing's subject
 * ("iPhone 15 with charger" is a phone; "iPhone charger" is an accessory).
 * Only the IMMEDIATELY preceding word is considered — a wider window let an adjective
 * list smuggle a marker in ("Clear *and* slim case for iPhone" is still a case).
 */
const INCLUSION_MARKERS = [
  "with",
  "includes",
  "including",
  "incl",
  "plus",
  "and",
  "w",
  "포함",
  "및",
] as const;

/**
 * Vocabulary terms that are ordinary English words. They appear constantly in listing
 * prose ("I *saw* no dead *pixel*", "kept on my *desk*", "*pet*-free home", "*midi* dress")
 * and, being taxonomy leaves/aliases, would otherwise attach that node's HARD safety gates
 * to an unrelated item. Never inferred from free text — a real listing of one of these is
 * still reachable through its category plus a specific tag.
 */
const GENERIC_STOPWORDS = new Set([
  "saw",
  "table",
  "wood",
  "pet",
  "book",
  "books",
  "notebook",
  "tool",
  "tools",
  "desk",
  "pixel",
  "wheel",
  "wheels",
  "rim",
  "rims",
  "grill",
  "oven",
  "irons",
  "midi",
  // Singular "coin" is the collision-prone form ("coin operated", "coin slot"); the
  // plural "coins" is how real coin listings read, so it stays inferable.
  "coin",
]);

/**
 * Brand names that span several product families (Samsung/Galaxy make phones, tablets,
 * watches, TVs and fridges). Used ONLY when nothing more specific matched, so
 * "Samsung 65 inch QLED TV" resolves the TV node rather than the phone node's IMEI gates.
 */
const WEAK_BRAND_TERMS = new Set(["samsung", "galaxy"]);

/** Max canonical tags returned — a listing resolves a handful of nodes at most. */
const MAX_INFERRED = 6;

/** Vocabulary entry: a taxonomy term plus how to match it against free text. */
interface VocabEntry {
  /** The canonical tag to emit (a real node leaf or alias). */
  term: string;
  /** Lowercased word sequence for latin terms; empty for CJK (substring-matched). */
  words: string[];
  /** True when the term has no latin word boundaries (Korean) → substring match. */
  cjk: boolean;
}

let VOCAB_CACHE: VocabEntry[] | null = null;

/** Whether a string contains Hangul (no reliable word boundaries → substring match). */
function isCjk(s: string): boolean {
  return /[가-힣]/.test(s);
}

/**
 * Every taxonomy node leaf + alias, as a matchable vocabulary. Built once. Longer terms
 * come first so a specific phrase ("car-seat") is preferred over a shorter overlap.
 */
function getVocabulary(): VocabEntry[] {
  if (VOCAB_CACHE) return VOCAB_CACHE;
  const seen = new Set<string>();
  const out: VocabEntry[] = [];
  const add = (raw: string) => {
    const term = raw.trim().toLowerCase();
    // Skip 1-char terms — far too collision-prone in free text.
    if (term.length < 2 || seen.has(term)) return;
    seen.add(term);
    const cjk = isCjk(term);
    out.push({ term, cjk, words: cjk ? [] : term.split(/[\s-]+/).filter(Boolean) });
  };
  for (const node of CATEGORY_TAXONOMY) {
    const leaf = node.path.split("/").pop();
    if (leaf) add(leaf);
    for (const alias of node.aliases ?? []) add(alias);
  }
  out.sort((a, b) => b.term.length - a.term.length);
  VOCAB_CACHE = out;
  return out;
}

/**
 * The taxonomy's latin item-type vocabulary, sorted, for injecting into an LLM tagger's
 * prompt as a CONTROLLED VOCABULARY. Keeping the vision tagger's item-type token inside
 * this set is what lets `resolveChecks` drill past the category root into the node that
 * carries the real safety gates. Korean terms are omitted (the prompt is English; Korean
 * titles are still handled by the deterministic `inferTaxonomyTags` path).
 */
export function getTaxonomyVocabulary(): string[] {
  return getVocabulary()
    .filter((v) => !v.cjk)
    .map((v) => v.term)
    .sort();
}

let VOCAB_WORDS_CACHE: Set<string> | null = null;

/**
 * Every individual latin word appearing in the vocabulary ("apple-watch" → apple, watch).
 * Lets the accessory guard recognise an "<item> <head>" construction ("TV stand") without
 * suppressing a head that is the listing's own subject ("wedding band").
 */
function getVocabularyWords(): Set<string> {
  if (VOCAB_WORDS_CACHE) return VOCAB_WORDS_CACHE;
  const words = new Set<string>();
  for (const entry of getVocabulary()) {
    if (GENERIC_STOPWORDS.has(entry.term)) continue;
    for (const w of entry.words) words.add(w);
  }
  VOCAB_WORDS_CACHE = words;
  return words;
}

/** Lowercase and split free text into latin word tokens (CJK kept in the raw string). */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Whether the text advertises an ACCESSORY rather than the item itself. An accessory head
 * that is introduced by an inclusion marker ("with charger") is a bundled extra and does
 * NOT count.
 */
export function looksLikeAccessory(text: string): boolean {
  const raw = text.toLowerCase();
  // Korean compounds have no spaces ("아이폰15케이스"), so match CJK heads by substring —
  // mirroring how CJK vocabulary terms are matched, so the guard is not biased open.
  for (const head of ACCESSORY_HEADS_CJK) {
    if (raw.includes(head)) return true;
  }

  const words = tokenize(text);
  const heads = new Set<string>(ACCESSORY_HEADS);
  const weakHeads = new Set<string>(WEAK_ACCESSORY_HEADS);
  const markers = new Set<string>(INCLUSION_MARKERS);
  const preps = new Set<string>(ACCESSORY_PREPOSITIONS);

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === undefined) continue;
    const isHead = heads.has(w);
    const isWeakHead = weakHeads.has(w);
    if (!isHead && !isWeakHead) continue;

    // "case FOR iphone" / "band FITS series 9" — an explicit accessory construction,
    // which settles it for both strong and weak heads.
    const next = words[i + 1];
    const explicitlyFor = next !== undefined && preps.has(next);
    if (explicitlyFor) return true;

    if (isWeakHead) {
      // A weak head is an accessory only in an "<item> <head>" construction — "TV stand",
      // "Apple Watch band". On its own it is usually the listing's OWN subject
      // ("Neverfull bag", "gold wedding band", "film camera", "stand mixer"), and
      // suppressing those would lose the very gates those items need.
      const prev = i >= 1 ? words[i - 1] : undefined;
      if (prev !== undefined && getVocabularyWords().has(prev)) return true;
      continue;
    }

    // Only the immediately preceding word counts as an inclusion marker; a wider window
    // let an adjective list smuggle one in ("Clear *and* slim case for iPhone").
    const prev1 = i >= 1 ? words[i - 1] : undefined;
    const bundled = prev1 !== undefined && markers.has(prev1);
    if (!bundled) return true;
  }
  return false;
}

/** Whether a latin vocab term's word sequence appears contiguously in the token list. */
function containsSequence(words: string[], seq: string[]): boolean {
  if (seq.length === 0) return false;
  for (let i = 0; i + seq.length <= words.length; i++) {
    let hit = true;
    for (let j = 0; j < seq.length; j++) {
      if (words[i + j] !== seq[j]) {
        hit = false;
        break;
      }
    }
    if (hit) return true;
  }
  return false;
}

/**
 * Infer canonical taxonomy tags from a listing's free text (title + optional description).
 *
 * Returns node leaves/aliases that `resolveChecks` matches — e.g. "Queen mattress, memory
 * foam" → `["mattress"]`, "Graco car seat" → `["car-seat"]`. Returns `[]` for accessory
 * listings and for text with no taxonomy term (the caller then keeps whatever it had).
 */
export function inferTaxonomyTags(text: string): string[] {
  if (!text?.trim()) return [];
  // An accessory listing must not inherit the parent item's safety gates.
  if (looksLikeAccessory(text)) return [];

  const words = tokenize(text);
  const rawLower = text.toLowerCase();
  const strong: string[] = [];
  const weak: string[] = [];
  for (const entry of getVocabulary()) {
    if (strong.length >= MAX_INFERRED) break;
    // Ordinary English words ("saw", "table", "desk") must never pull in a node's gates.
    if (GENERIC_STOPWORDS.has(entry.term)) continue;
    const hit = entry.cjk ? rawLower.includes(entry.term) : containsSequence(words, entry.words);
    if (!hit) continue;
    if (WEAK_BRAND_TERMS.has(entry.term)) weak.push(entry.term);
    else strong.push(entry.term);
  }
  // A multi-family brand only decides the item when nothing more specific matched:
  // "Samsung 65 inch QLED TV" resolves the TV node, not the phone node's IMEI gates.
  return strong.length > 0 ? strong : weak.slice(0, MAX_INFERRED);
}

/**
 * Merge a listing's existing tags with tags inferred from its text, so the taxonomy can
 * resolve the item's node even when the vision tagger emitted only attributes (or failed).
 *
 * Existing tags always win position (they are what the seller/vision actually asserted);
 * inferred tags are appended only when missing. Never drops anything the caller had.
 */
export function enrichTagsWithTaxonomy(
  existingTags: readonly string[],
  text: string,
): { tags: string[]; inferred: string[] } {
  const have = new Set(existingTags.map((t) => t.trim().toLowerCase()).filter(Boolean));
  const inferred = inferTaxonomyTags(text).filter((t) => !have.has(t));
  return { tags: [...existingTags, ...inferred], inferred };
}

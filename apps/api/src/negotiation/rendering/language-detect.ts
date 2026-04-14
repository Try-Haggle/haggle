/**
 * Language detection based on Unicode script ranges.
 * Zero dependencies — pure character analysis.
 *
 * Design: detect input language → respond in same language.
 * Internal processing stays in English (token savings).
 */

export type SupportedLocale = "en" | "ko" | "ja" | "zh" | "es" | "fr" | "de";

interface DetectionResult {
  locale: SupportedLocale;
  confidence: number; // 0.0 ~ 1.0
  script: string;
}

// ─── Unicode Range Detectors ──────────────────────────────────────────

/** Korean: Hangul Jamo + Syllables + Compatibility Jamo */
const HANGUL_REGEX = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/g;

/** Japanese: Hiragana + Katakana (exclude CJK shared with Chinese) */
const JAPANESE_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FF]/g;

/** Chinese: CJK Unified Ideographs (shared with Japanese Kanji) */
const CJK_REGEX = /[\u4E00-\u9FFF\u3400-\u4DBF]/g;

/** Latin extended (accented chars for European languages) */
const LATIN_EXTENDED_REGEX = /[\u00C0-\u024F]/g;

// ─── Detection ────────────────────────────────────────────────────────

/**
 * Detect the primary language of input text.
 * Uses character script ratio — fast (no ML/API).
 */
export function detectLanguage(text: string): DetectionResult {
  if (!text || text.trim().length === 0) {
    return { locale: "en", confidence: 0, script: "none" };
  }

  const clean = text.replace(/[\s\d\p{P}\p{S}]/gu, ""); // strip whitespace, digits, punctuation, symbols
  if (clean.length === 0) {
    return { locale: "en", confidence: 0.5, script: "numeric_only" };
  }

  const total = clean.length;

  // Count script characters
  const hangulCount = (clean.match(HANGUL_REGEX) || []).length;
  const japaneseCount = (clean.match(JAPANESE_REGEX) || []).length;
  const cjkCount = (clean.match(CJK_REGEX) || []).length;

  const hangulRatio = hangulCount / total;
  const japaneseRatio = japaneseCount / total;
  const cjkRatio = cjkCount / total;

  // Korean: Hangul > 30%
  if (hangulRatio > 0.3) {
    return { locale: "ko", confidence: Math.min(1, hangulRatio + 0.2), script: "hangul" };
  }

  // Japanese: Kana > 10% (even with Kanji, kana presence = Japanese)
  if (japaneseRatio > 0.1) {
    return { locale: "ja", confidence: Math.min(1, japaneseRatio + cjkRatio + 0.2), script: "kana" };
  }

  // Chinese: CJK > 30% and no Kana (distinguish from Japanese Kanji)
  if (cjkRatio > 0.3 && japaneseRatio < 0.05) {
    return { locale: "zh", confidence: Math.min(1, cjkRatio + 0.2), script: "cjk" };
  }

  // Default: English (Latin script)
  return { locale: "en", confidence: 0.7, script: "latin" };
}

/**
 * Get display name for a locale.
 */
export function getLocaleName(locale: SupportedLocale): string {
  const names: Record<SupportedLocale, string> = {
    en: "English",
    ko: "한국어",
    ja: "日本語",
    zh: "中文",
    es: "Español",
    fr: "Français",
    de: "Deutsch",
  };
  return names[locale] ?? "English";
}

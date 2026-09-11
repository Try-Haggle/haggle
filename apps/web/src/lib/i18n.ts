/**
 * Display locale for the web app.
 *
 * Default is English. Add a locale by appending to `LOCALES` and `MESSAGES`.
 * Missing keys fall back to English, then to the key itself.
 * New user-visible copy should go through `t()` so later locales can land
 * without rewriting call sites.
 */

export const DEFAULT_LOCALE = "en";
export const LOCALES = ["en", "ko"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_STORAGE_KEY = "haggle-locale";

/** Native names in the language picker — not translated with `t()`. */
export const LOCALE_NATIVE_NAME: Record<Locale, string> = {
  en: "English",
  ko: "한국어",
};

type MessageTree = {
  settings: {
    language: {
      title: string;
      hint: string;
      label: string;
    };
  };
};

const en: MessageTree = {
  settings: {
    language: {
      title: "Language",
      hint: "This is the language of the Haggle website. It does not change how agents negotiate.",
      label: "Display language",
    },
  },
};

/** Korean may omit keys; `t()` fills those from English. */
const ko: DeepPartial<MessageTree> = {
  settings: {
    language: {
      title: "언어",
      hint: "Haggle 웹사이트의 표시 언어입니다. 에이전트가 협상하는 방식은 바뀌지 않습니다.",
      label: "표시 언어",
    },
  },
};

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

const MESSAGES: Record<Locale, DeepPartial<MessageTree>> = { en, ko };

export function isLocale(value: string | null | undefined): value is Locale {
  return value === "en" || value === "ko";
}

function lookup(tree: unknown, path: string[]): unknown {
  let current = tree;
  for (const part of path) {
    if (current === null || typeof current !== "object" || !(part in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function t(locale: Locale, key: string): string {
  const path = key.split(".").filter(Boolean);
  const fromLocale = lookup(MESSAGES[locale], path);
  if (typeof fromLocale === "string") return fromLocale;
  if (locale !== DEFAULT_LOCALE) {
    const fromDefault = lookup(MESSAGES[DEFAULT_LOCALE], path);
    if (typeof fromDefault === "string") return fromDefault;
  }
  return key;
}

export function readDocumentLocale(): Locale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const fromDataset = document.documentElement.dataset.locale;
  if (isLocale(fromDataset)) return fromDataset;
  if (isLocale(document.documentElement.lang)) return document.documentElement.lang;
  return DEFAULT_LOCALE;
}

export function applyLocale(next: Locale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = next;
  document.documentElement.dataset.locale = next;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, next);
  } catch {
    // private mode / blocked storage
  }
}

/** Value for the `Accept-Language` request header. Default English. */
export function acceptLanguageHeader(locale: Locale = readDocumentLocale()): string {
  if (locale === DEFAULT_LOCALE) return DEFAULT_LOCALE;
  return `${locale},en;q=0.8`;
}

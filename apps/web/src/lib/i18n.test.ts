import { afterEach, describe, expect, it } from "vitest";
import {
  acceptLanguageHeader,
  applyLocale,
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_STORAGE_KEY,
  readDocumentLocale,
  t,
} from "./i18n";

describe("i18n", () => {
  afterEach(() => {
    window.localStorage.removeItem(LOCALE_STORAGE_KEY);
    document.documentElement.lang = DEFAULT_LOCALE;
    delete document.documentElement.dataset.locale;
  });

  it("defaults to English and only accepts known locales", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(isLocale("en")).toBe(true);
    expect(isLocale("ko")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(null)).toBe(false);
  });

  it("returns English copy and falls back when a locale omits a key", () => {
    expect(t("en", "settings.language.title")).toBe("Language");
    expect(t("ko", "settings.language.title")).toBe("언어");
    expect(t("ko", "settings.language.missing")).toBe("settings.language.missing");
    expect(t("en", "not.a.key")).toBe("not.a.key");
  });

  it("persists locale to html lang and localStorage", () => {
    applyLocale("ko");
    expect(document.documentElement.lang).toBe("ko");
    expect(document.documentElement.dataset.locale).toBe("ko");
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("ko");
    expect(readDocumentLocale()).toBe("ko");
  });

  it("builds Accept-Language with English as the default and fallback", () => {
    expect(acceptLanguageHeader("en")).toBe("en");
    expect(acceptLanguageHeader("ko")).toBe("ko,en;q=0.8");
  });
});

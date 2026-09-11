import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyLocale, DEFAULT_LOCALE, LOCALE_STORAGE_KEY } from "./i18n";

const fetchMock = vi.fn();

vi.stubGlobal("fetch", fetchMock);

describe("api client Accept-Language", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => "{}",
    });
    window.localStorage.removeItem(LOCALE_STORAGE_KEY);
    document.documentElement.lang = DEFAULT_LOCALE;
    delete document.documentElement.dataset.locale;
  });

  afterEach(() => {
    window.localStorage.removeItem(LOCALE_STORAGE_KEY);
    document.documentElement.lang = DEFAULT_LOCALE;
    delete document.documentElement.dataset.locale;
  });

  it("sends English by default", async () => {
    const { api } = await import("./api-client");
    await api.get("/health", { skipAuth: true });
    const headers = fetchMock.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers["Accept-Language"]).toBe("en");
  });

  it("sends the selected locale with English fallback", async () => {
    applyLocale("ko");
    const { api } = await import("./api-client");
    await api.get("/health", { skipAuth: true });
    const headers = fetchMock.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers["Accept-Language"]).toBe("ko,en;q=0.8");
  });
});

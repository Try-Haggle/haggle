import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_API_LOCALE, parseAcceptLanguage } from "../lib/request-locale.js";
import localePlugin from "../middleware/locale.js";

describe("parseAcceptLanguage", () => {
  it("defaults to English when the header is missing or empty", () => {
    expect(parseAcceptLanguage(undefined)).toBe(DEFAULT_API_LOCALE);
    expect(parseAcceptLanguage("")).toBe("en");
    expect(parseAcceptLanguage("   ")).toBe("en");
  });

  it("picks the first supported tag, including regional forms", () => {
    expect(parseAcceptLanguage("ko")).toBe("ko");
    expect(parseAcceptLanguage("ko-KR,ko;q=0.9,en;q=0.8")).toBe("ko");
    expect(parseAcceptLanguage("en-US,en;q=0.9")).toBe("en");
  });

  it("falls back to English for unknown or wildcard tags", () => {
    expect(parseAcceptLanguage("*")).toBe("en");
    expect(parseAcceptLanguage("fr-FR,fr;q=0.9")).toBe("en");
    expect(parseAcceptLanguage("fr;q=0.9,ko;q=0.8")).toBe("ko");
  });
});

describe("locale middleware", () => {
  let app: ReturnType<typeof Fastify>;

  afterEach(async () => {
    await app.close();
  });

  it("exposes request.locale, defaulting to English", async () => {
    app = Fastify();
    await app.register(localePlugin);
    app.get("/loc", async (request) => ({ locale: request.locale }));
    await app.ready();

    expect((await app.inject({ method: "GET", url: "/loc" })).json()).toEqual({ locale: "en" });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/loc",
          headers: { "accept-language": "ko-KR,en;q=0.8" },
        })
      ).json(),
    ).toEqual({ locale: "ko" });
  });
});

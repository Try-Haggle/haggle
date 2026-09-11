import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { type ApiLocale, DEFAULT_API_LOCALE, parseAcceptLanguage } from "../lib/request-locale.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Resolved display locale for this request. Always set; default `en`. */
    locale: ApiLocale;
  }
}

async function localePlugin(app: FastifyInstance) {
  app.decorateRequest("locale", DEFAULT_API_LOCALE);
  app.addHook("onRequest", async (request) => {
    request.locale = parseAcceptLanguage(request.headers["accept-language"]);
  });
}

export default fp(localePlugin, { name: "locale" });

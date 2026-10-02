import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.unmock("@haggle/db");

import {
  getPublishedPriceBuckets,
  getPublishedPriceRange,
  listPublishedListings,
} from "../services/draft.service.js";

const dialect = new PgDialect();

/** Chainable fake db that records the argument of every `.where(...)` call. */
function recordingDb() {
  const wheres: unknown[] = [];
  const chain: Record<string, unknown> = {};
  const self = new Proxy(chain, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown[]) => void) => resolve([]);
      }
      if (prop === "where") {
        return (arg: unknown) => {
          wheres.push(arg);
          return self;
        };
      }
      return () => self;
    },
  });
  return { db: self as never, wheres };
}

function sqlOf(wheres: unknown[]): string {
  return wheres
    .map((w) => dialect.sqlToQuery(w as never).sql)
    .join("\n")
    .toLowerCase();
}

describe("public listing queries exclude seller-less (userId=null) listings", () => {
  it("listPublishedListings", async () => {
    const { db, wheres } = recordingDb();
    await listPublishedListings(db, {});
    expect(sqlOf(wheres)).toContain('"user_id" is not null');
  });

  it("getPublishedPriceBuckets", async () => {
    const { db, wheres } = recordingDb();
    await getPublishedPriceBuckets(db, {});
    expect(sqlOf(wheres)).toContain('"user_id" is not null');
  });

  it("getPublishedPriceRange", async () => {
    const { db, wheres } = recordingDb();
    await getPublishedPriceRange(db, {});
    expect(sqlOf(wheres)).toContain('"user_id" is not null');
  });
});

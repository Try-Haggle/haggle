import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { buildAdvisorHistoryFilter } from "../advisor/advisor-service.js";

vi.mock("@haggle/db", async (importOriginal) => importOriginal());

const DISPUTE_ID = "0fd58f3e-5f41-4924-803a-77caaa30f2c7";

function compileHistoryFilter(role: "buyer" | "seller") {
  const filter = buildAdvisorHistoryFilter(DISPUTE_ID, role);
  if (!filter) throw new Error("Advisor history filter was not created");
  return new PgDialect().sqlToQuery(filter.getSQL());
}

describe("advisor history role isolation", () => {
  it("uses an IN list PostgreSQL can execute for the seller conversation", () => {
    const query = compileHistoryFilter("seller");

    expect(query.sql).toContain('"advisor_messages"."role" in ($2, $3)');
    expect(query.params).toEqual([DISPUTE_ID, "seller_advisor", "seller_user"]);
  });

  it("keeps buyer and seller conversation roles separate", () => {
    const query = compileHistoryFilter("buyer");

    expect(query.params).toEqual([DISPUTE_ID, "buyer_advisor", "buyer_user"]);
    expect(query.params).not.toContain("seller_advisor");
    expect(query.params).not.toContain("seller_user");
  });
});

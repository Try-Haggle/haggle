import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(process.cwd(), "src/app/buy/negotiations/[sessionId]/page.tsx"),
  "utf8",
);

describe("buyer negotiation page missing-session contract", () => {
  it("404s missing or inaccessible sessions instead of throwing a 500", () => {
    expect(source).toContain('import { notFound } from "next/navigation"');
    expect(source).toContain("isNegotiationSessionId");
    expect(source).toContain("isMissingNegotiationSessionError");
    expect(source).toContain("if (!isNegotiationSessionId(sessionId)) notFound()");
    expect(source).toContain("if (isMissingNegotiationSessionError(error)) notFound()");
    expect(source).toContain("try {");
  });
});

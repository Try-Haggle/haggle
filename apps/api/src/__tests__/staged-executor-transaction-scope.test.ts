import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("staged negotiation executor transaction scope", () => {
  it("does not retain a transaction-backed checkpoint store between negotiations", () => {
    const source = readFileSync(
      new URL("../negotiation/pipeline/executor.ts", import.meta.url),
      "utf8",
    );

    // A `tx` object only lives for one db.transaction callback. Capturing it in the
    // module-scoped checkpoint store caused every later live negotiation to hang at
    // round zero while reading through the completed transaction.
    expect(source).not.toMatch(/getCheckpointStore\(tx/);
    expect(source).not.toMatch(/new PgCheckpointPersistence\(tx/);
  });
});

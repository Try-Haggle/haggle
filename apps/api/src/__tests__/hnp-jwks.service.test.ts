import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateTrustedHnpJwks } from "../services/hnp-jwks.service.js";

describe("validateTrustedHnpJwks", () => {
  it("accepts RSA keys with supported HNP JWS algorithms", () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = publicKey.export({ format: "jwk" });

    expect(validateTrustedHnpJwks(JSON.stringify({
      keys: [{ ...jwk, kid: "rsa-key", alg: "RS256" }],
    }))).toEqual({ ok: true, keyCount: 1 });
  });

  it("rejects parseable non-RSA keys", () => {
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = publicKey.export({ format: "jwk" });

    expect(validateTrustedHnpJwks(JSON.stringify({
      keys: [{ ...jwk, kid: "ec-key", alg: "ES256" }],
    }))).toMatchObject({ ok: false, reason: "no supported public keys found" });
  });

  it("rejects RSA keys without an explicit supported algorithm", () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = publicKey.export({ format: "jwk" });

    expect(validateTrustedHnpJwks(JSON.stringify({
      keys: [{ ...jwk, kid: "rsa-key-without-alg" }],
    }))).toMatchObject({ ok: false, reason: "no supported public keys found" });
  });
});

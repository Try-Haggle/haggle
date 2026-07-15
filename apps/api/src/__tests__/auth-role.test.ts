import Fastify, { type FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import authPlugin from "../middleware/auth.js";
import { requireAdmin } from "../middleware/require-auth.js";
import { resetSupabaseJwtVerifierForTests } from "../services/supabase-jwt.service.js";

const TEST_SECRET = "staging-auth-role-test-secret";
const TEST_USER_ID = "00000000-0000-4000-a000-000000000010";

describe("Supabase application role mapping", () => {
  let app: FastifyInstance | undefined;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    process.env.NODE_ENV = "test";
    process.env.HAGGLE_SUPABASE_JWT_MODE = "legacy_hs256";
    process.env.SUPABASE_JWT_SECRET = TEST_SECRET;
    delete process.env.SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_JWT_AUDIENCE;
    resetSupabaseJwtVerifierForTests();

    app = Fastify();
    await app.register(authPlugin);
    app.get("/admin-check", { preHandler: [requireAdmin] }, async (request) => ({
      role: request.user?.role,
    }));
    await app.ready();
  });

  afterEach(async () => {
    await app?.close();
    process.env = { ...originalEnv };
    resetSupabaseJwtVerifierForTests();
  });

  it("uses admin-controlled app_metadata before the Supabase authenticated role", async () => {
    const token = jwt.sign(
      {
        sub: TEST_USER_ID,
        role: "authenticated",
        app_metadata: { role: "admin" },
        user_metadata: { role: "authenticated" },
      },
      TEST_SECRET,
    );

    const response = await app!.inject({
      method: "GET",
      url: "/admin-check",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ role: "admin" });
  });

  it("does not trust user-controlled user_metadata for admin access", async () => {
    const token = jwt.sign(
      {
        sub: TEST_USER_ID,
        role: "authenticated",
        user_metadata: { role: "admin" },
      },
      TEST_SECRET,
    );

    const response = await app!.inject({
      method: "GET",
      url: "/admin-check",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "ADMIN_REQUIRED" });
  });
});

/**
 * Shared test helpers for API integration tests.
 */
import type { FastifyInstance } from "fastify";
import { createServer } from "../server.js";

// ─── Test Auth Tokens ─────────────────────────────────────────────────
// These are valid JWT-shaped tokens that the dev passthrough will decode
// without secret verification (SUPABASE_JWT_SECRET not set in test env).
// Payload: { sub, email, role } — decoded via jwt.decode() only.

// Authenticated user: sub=test-user-001, role=authenticated
export const TEST_USER_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
  ".eyJzdWIiOiJ0ZXN0LXVzZXItMDAxIiwiZW1haWwiOiJ0ZXN0QGhhZ2dsZS5haSIsInJvbGUiOiJhdXRoZW50aWNhdGVkIn0" +
  ".fakesig";

// Admin user: sub=test-admin-001, role=admin
export const TEST_ADMIN_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
  ".eyJzdWIiOiJ0ZXN0LWFkbWluLTAwMSIsImVtYWlsIjoiYWRtaW5AaGFnZ2xlLmFpIiwicm9sZSI6ImFkbWluIn0" +
  ".fakesig";

export const AUTH_HEADERS = { authorization: `Bearer ${TEST_USER_JWT}` };
export const ADMIN_HEADERS = { authorization: `Bearer ${TEST_ADMIN_JWT}` };

let _app: FastifyInstance | null = null;

/**
 * Build and return the Fastify app. Cached for the test suite lifetime
 * so route registration only happens once.
 */
export async function getTestApp(): Promise<FastifyInstance> {
  if (!_app) {
    _app = await createServer();
    await _app.ready();
  }
  return _app;
}

/**
 * Close the cached app (call in afterAll).
 */
export async function closeTestApp(): Promise<void> {
  if (_app) {
    await _app.close();
    _app = null;
  }
}

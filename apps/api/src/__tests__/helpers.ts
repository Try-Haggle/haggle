/**
 * Shared test helpers for API integration tests.
 */
import type { FastifyInstance } from "fastify";
import { createServer } from "../server.js";

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

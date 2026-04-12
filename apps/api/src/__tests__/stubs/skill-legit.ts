/**
 * Stub for @haggle/skill-legit.
 * The package may not be built. Provide mock exports for test resolution.
 */
export class AuthenticationService {
  constructor(_opts: unknown) {}
  authenticate = async () => ({ status: "PASS", score: 0.95 });
  processWebhook = async () => null;
}

export class LegitAuthAdapter {
  constructor(_opts: unknown) {}
}

export class MockAuthAdapter {
  constructor() {}
  authenticate = async () => ({ status: "PASS", score: 0.95 });
}

export function verifyLegitWebhook() {
  return true;
}

export type AuthenticationRecord = Record<string, unknown>;
export type HaggleCategory = string;

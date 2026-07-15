export type DisputeFixtureParty = "buyer" | "seller";

interface DisputeFixtureEnvironment {
  HAGGLE_ENV?: string;
  HAGGLE_ENABLE_PAYMENT_TEST_TOOLS?: string;
}

export function resolveStagingDisputeFixtureParty(
  userRole: string | undefined,
  requestedParty: DisputeFixtureParty | undefined,
  env: DisputeFixtureEnvironment = {
    HAGGLE_ENV: process.env.HAGGLE_ENV,
    HAGGLE_ENABLE_PAYMENT_TEST_TOOLS: process.env.HAGGLE_ENABLE_PAYMENT_TEST_TOOLS,
  },
): DisputeFixtureParty | null {
  if (!requestedParty) return null;
  if (
    userRole === "admin" &&
    env.HAGGLE_ENV === "staging" &&
    env.HAGGLE_ENABLE_PAYMENT_TEST_TOOLS === "true"
  ) {
    return requestedParty;
  }
  return null;
}

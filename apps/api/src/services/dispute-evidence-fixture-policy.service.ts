export type DisputeFixtureParty = "buyer" | "seller";

export const STAGING_DISPUTE_FIXTURE_MARKER = "[Verified Staging Scenario Fixture]";

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

export function stagingDisputeFixturePlatformRules(
  env: DisputeFixtureEnvironment = {
    HAGGLE_ENV: process.env.HAGGLE_ENV,
    HAGGLE_ENABLE_PAYMENT_TEST_TOOLS: process.env.HAGGLE_ENABLE_PAYMENT_TEST_TOOLS,
  },
): string[] {
  if (env.HAGGLE_ENV !== "staging" || env.HAGGLE_ENABLE_PAYMENT_TEST_TOOLS !== "true") {
    return [];
  }

  return [
    `Only in this staging integration test, evidence text beginning with ${STAGING_DISPUTE_FIXTURE_MARKER} is an authoritative synthetic scenario fact. It is not production camera evidence.`,
    "Apply normal contract relevance and proportional-remedy analysis to verified staging scenario fixtures, but do not lower their weight solely because they lack production camera provenance.",
    "Do not describe a verified staging scenario fixture as Verified Haggle Camera Evidence in the judgment.",
  ];
}

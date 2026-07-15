type PaymentProviderEnvironment = Pick<
  NodeJS.ProcessEnv,
  "NODE_ENV" | "VERCEL_ENV" | "HAGGLE_ENV" | "HAGGLE_ENABLE_STAGING_MOCK_PAYMENTS"
>;

export function requiresRealPaymentProviders(
  env: PaymentProviderEnvironment = process.env,
): boolean {
  const productionRuntime = env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
  const stagingMockOptIn =
    env.HAGGLE_ENV === "staging" && env.HAGGLE_ENABLE_STAGING_MOCK_PAYMENTS === "true";
  return productionRuntime && !stagingMockOptIn;
}

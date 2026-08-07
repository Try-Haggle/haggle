export function resolveAdvisorCanarySecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.CANARY_SECRET?.trim();
  if (!secret) {
    throw new Error("CANARY_SECRET is required for the Advisor service");
  }
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("CANARY_SECRET must contain at least 32 bytes");
  }
  return secret;
}

import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts", "src/negotiation/**/*.test.ts", "src/payments/**/*.test.ts"],
    environment: "node",
    setupFiles: ["src/__tests__/setup.ts"],
    env: {
      LOG_LEVEL: "silent",
    },
  },
  resolve: {
    alias: {
      // Map unresolvable subpath imports to mock stubs.
      // These heavy modules depend on viem and have no package.json "exports" entry.
      "@haggle/payment-core/heavy/real-x402-adapter": path.resolve(
        __dirname,
        "src/__tests__/stubs/payment-heavy.ts",
      ),
      "@haggle/payment-core/heavy/viem-contracts": path.resolve(
        __dirname,
        "src/__tests__/stubs/payment-heavy.ts",
      ),
      "@haggle/skill-legit": path.resolve(
        __dirname,
        "src/__tests__/stubs/skill-legit.ts",
      ),
    },
  },
});

import { isProductionRuntime } from "../config/runtime.js";

/**
 * Lab-only routes that take floors and run a model with no auth.
 * Closed unless explicitly enabled, and never on staging/production.
 */
export function insecureDemoRoutesEnabled(): boolean {
  if (process.env.ENABLE_INSECURE_DEMO_ROUTES !== "true") return false;
  if (isProductionRuntime()) return false;
  const env = process.env.HAGGLE_ENV?.trim().toLowerCase();
  if (env === "staging" || env === "production") return false;
  return true;
}

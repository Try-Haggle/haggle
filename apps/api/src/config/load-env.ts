import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import dotenv from "dotenv";

/**
 * Single source of truth for loading environment variables.
 *
 * Replaces the ad-hoc `dotenv.config({ path: "../../../.env" })` calls that
 * were copy-pasted across the entry point, scripts, and tests with mismatched
 * relative-path depths. Import this module once at the top of any entry point:
 *
 *   import "./config/load-env.js";   // or "../config/load-env.js" from scripts
 *
 * Load order (later files override earlier ones):
 *   1. <repo-root>/.env          — shared defaults for the whole monorepo
 *   2. <repo-root>/apps/api/.env — API-local overrides (optional)
 *
 * The repo root is discovered by walking up from this file until we find the
 * directory containing `pnpm-workspace.yaml`, so it no longer breaks when a
 * caller lives at a different directory depth.
 */

function findRepoRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      // Reached the filesystem root without finding the marker — fall back to
      // the conventional location relative to this compiled file
      // (apps/api/dist/config → repo root is four levels up).
      return resolve(startDir, "../../../..");
    }
    dir = parent;
  }
}

const repoRoot = findRepoRoot(import.meta.dirname);

// Shared root .env first, then API-local .env wins on conflicts.
dotenv.config({ path: resolve(repoRoot, ".env") });
dotenv.config({ path: resolve(repoRoot, "apps/api/.env"), override: true });

export { repoRoot };

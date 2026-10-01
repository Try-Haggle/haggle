/**
 * Decide model routing: pick a catalog id for this turn.
 *
 * Every default DeepSeek resolution is Flash (`deepseek-flash`).
 * `DEEPSEEK_MODEL` is the general default (Flash ids only).
 * `DEEPSEEK_FLASH_MODEL`, `BUILDER_LLM_MODEL`, and `DISPUTE_AI_*` model envs
 * also accept only Flash ids (`deepseek-flash`, `deepseek-v4-flash`, or those
 * plus a `-suffix`). Empty is unset. Pro or unknown values warn once and fall
 * back to `deepseek-flash`. Pro (`DEEPSEEK_PRO_MODEL`, default
 * `deepseek-v4-pro`) is an explicit fallback id for existing-session
 * entitlement (`allowedModelId`, legacy `proCredit`) and pricing. No default
 * path uses it. Ask price does not choose the model. New sessions accept only
 * a catalog Flash id.
 *
 * Category and buyer target are not inputs. See
 * docs/engine/decide-model-routing.md.
 *
 * `allowedModelId` is server entitlement after a ledger debit. Do not treat a
 * raw client bit as payment. `proCredit` is a legacy alias for "this session
 * may use the Pro catalog id".
 */

export const DEFAULT_PRO_MODEL = "deepseek-v4-pro";
export const DEFAULT_FLASH_MODEL = "deepseek-flash";

const FLASH_MODEL_ID = /^(?:deepseek-flash|deepseek-v4-flash)(?:-[a-z0-9.-]+)?$/;
const flashRoleEnvWarned = new Set<string>();

export type DecideModelReason = "flash_default" | "allowed_model" | "pro_credit";

export interface DecideModelRoute {
  model: string;
  reason: DecideModelReason;
  /** Logged only. Does not choose the model. */
  askMinor?: number;
}

/** True only for Flash ids. Any id containing "pro" is false. */
export function isFlashModelId(id: string): boolean {
  const normalized = id.trim().toLowerCase();
  if (normalized.includes("pro")) return false;
  return FLASH_MODEL_ID.test(normalized);
}

/**
 * Read a Flash-only model env. Empty/whitespace is unset. A non-Flash value
 * warns once per env name (the value is not logged) and is treated as unset.
 */
export function readFlashRoleEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (!isFlashModelId(trimmed)) {
    if (!flashRoleEnvWarned.has(name)) {
      flashRoleEnvWarned.add(name);
      console.warn(
        `[model] ${name} is not an allowed Flash model id; falling back to deepseek-flash`,
      );
    }
    return undefined;
  }
  return trimmed;
}

export function getFlashModel(): string {
  return readFlashRoleEnv("DEEPSEEK_FLASH_MODEL") ?? DEFAULT_FLASH_MODEL;
}

/** General default model. `DEEPSEEK_MODEL` is Flash-only; otherwise Flash. */
export function getDefaultDeepSeekModel(): string {
  return readFlashRoleEnv("DEEPSEEK_MODEL") ?? getFlashModel();
}

/** Builder path. `BUILDER_LLM_MODEL` is Flash-only; otherwise the general default. */
export function getBuilderLlmModel(): string {
  return readFlashRoleEnv("BUILDER_LLM_MODEL") ?? getDefaultDeepSeekModel();
}

/** Explicit Pro fallback id. Not used by any default path. */
export function getProModel(): string {
  const raw = process.env.DEEPSEEK_PRO_MODEL?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_PRO_MODEL;
}

/** True when `id` names Pro, including a custom `DEEPSEEK_PRO_MODEL`. */
export function isProModelId(id: string): boolean {
  const normalized = id.trim().toLowerCase();
  if (normalized.includes("deepseek-v4-pro")) return true;
  return normalized === getProModel().trim().toLowerCase();
}

/** Models this process may call. Extra ids via DECIDE_EXTRA_MODELS (comma-separated). */
export function getDecideModelCatalog(): string[] {
  const extra = (process.env.DECIDE_EXTRA_MODELS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  return [...new Set([getFlashModel(), getProModel(), ...extra])];
}

export function isDecideCatalogModel(modelId: string | undefined): boolean {
  if (!modelId) return false;
  return getDecideModelCatalog().includes(modelId);
}

/**
 * Model id for a new session. Catalog Flash ids only. Pro, extras, and
 * anything else become the Flash default.
 */
export function resolveNewSessionAllowedModel(requested: unknown): string {
  if (typeof requested === "string") {
    const trimmed = requested.trim();
    if (isFlashModelId(trimmed) && isDecideCatalogModel(trimmed)) return trimmed;
  }
  return getFlashModel();
}

/** Drop client-supplied model entitlement. Server code sets `allowed_model`. */
export function stripClientModelEntitlement(
  snapshot: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...snapshot };
  delete next.pro_model_credit;
  delete next.allowed_model;
  return next;
}

function finitePositiveMinor(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function resolveDecideModel(input: {
  publishedAskMinor?: number;
  /**
   * Seller-only fallback when the listing snapshot has no ask. Recorded on the
   * route for logging. Seller `my_target` is the published ask. Never pass a
   * buyer target.
   */
  sellerAskMinor?: number;
  /** Server-set catalog id for this side. Client body must not set this. */
  allowedModelId?: string;
  /**
   * Legacy server flag: this session may use Pro. Prefer `allowedModelId`.
   * Do not copy from a client request.
   */
  proCredit?: boolean;
}): DecideModelRoute {
  const askMinor =
    finitePositiveMinor(input.publishedAskMinor) ?? finitePositiveMinor(input.sellerAskMinor);

  if (input.allowedModelId && isDecideCatalogModel(input.allowedModelId)) {
    return {
      model: input.allowedModelId,
      reason: "allowed_model",
      askMinor,
    };
  }
  if (input.proCredit === true) {
    return { model: getProModel(), reason: "pro_credit", askMinor };
  }
  return { model: getFlashModel(), reason: "flash_default", askMinor };
}

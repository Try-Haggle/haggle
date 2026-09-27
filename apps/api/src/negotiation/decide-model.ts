/**
 * Decide model routing: pick a catalog id for this turn.
 *
 * Every negotiation turn uses Flash (`DEEPSEEK_FLASH_MODEL`, default
 * `deepseek-flash`; legacy alias `deepseek-v4-flash`). Ask price does not
 * choose the model. Pro (`DEEPSEEK_MODEL`, default `deepseek-v4-pro`) stays
 * in the catalog only as a code-level fallback or an explicit server
 * entitlement (`allowedModelId`, legacy `proCredit`). The default path never
 * picks Pro.
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

export type DecideModelReason = "flash_default" | "allowed_model" | "pro_credit";

export interface DecideModelRoute {
  model: string;
  reason: DecideModelReason;
  /** Logged only. Does not choose the model. */
  askMinor?: number;
}

export function getProModel(): string {
  const raw = process.env.DEEPSEEK_MODEL?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_PRO_MODEL;
}

export function getFlashModel(): string {
  const raw = process.env.DEEPSEEK_FLASH_MODEL?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_FLASH_MODEL;
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

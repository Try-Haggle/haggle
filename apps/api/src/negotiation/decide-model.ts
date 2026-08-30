/**
 * Decide model routing: pick a catalog id for this turn.
 *
 * Category and buyer target are not inputs. Flash/Pro are the current catalog
 * rows, not a 3-rung ladder. See docs/engine/decide-model-routing.md.
 *
 * `allowedModelId` is server entitlement after a ledger debit. Do not treat a
 * raw client bit as payment. `proCredit` is a legacy alias for "this session
 * may use the Pro catalog id".
 */

export const DEFAULT_PRO_MODEL = "deepseek-v4-pro";
export const DEFAULT_FLASH_MODEL = "deepseek-v4-flash";

/** Published ask at or above this USD amount uses Pro. Below uses Flash unless allowed. */
export const DEFAULT_PRO_ASK_THRESHOLD_USD = 100;

export type DecideModelReason =
  | "ask_at_or_above_threshold"
  | "allowed_model"
  | "pro_credit"
  | "ask_below_threshold"
  | "ask_unknown";

export interface DecideModelRoute {
  model: string;
  reason: DecideModelReason;
  askMinor?: number;
  thresholdMinor: number;
}

export function getProModel(): string {
  const raw = process.env.DEEPSEEK_MODEL?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_PRO_MODEL;
}

export function getFlashModel(): string {
  const raw = process.env.DEEPSEEK_FLASH_MODEL?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_FLASH_MODEL;
}

export function getProAskThresholdMinor(): number {
  const raw = process.env.DEEPSEEK_PRO_ASK_THRESHOLD_USD;
  if (raw !== undefined && raw !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.round(parsed * 100);
    }
  }
  return DEFAULT_PRO_ASK_THRESHOLD_USD * 100;
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

function defaultModelForAsk(
  askMinor: number | undefined,
  thresholdMinor: number,
): {
  model: string;
  reason: Exclude<DecideModelReason, "allowed_model" | "pro_credit">;
} {
  if (askMinor === undefined) {
    return { model: getProModel(), reason: "ask_unknown" };
  }
  if (askMinor >= thresholdMinor) {
    return { model: getProModel(), reason: "ask_at_or_above_threshold" };
  }
  return { model: getFlashModel(), reason: "ask_below_threshold" };
}

export function resolveDecideModel(input: {
  publishedAskMinor?: number;
  /**
   * Seller-only fallback when the listing snapshot has no ask. Seller `my_target`
   * is the published ask. Never pass a buyer target — that would Flash a $900 phone
   * whose buyer target is $70.
   */
  sellerAskMinor?: number;
  /** Server-set catalog id for this side. Client body must not set this. */
  allowedModelId?: string;
  /**
   * Legacy server flag: this session may use Pro. Prefer `allowedModelId`.
   * Do not copy from a client request.
   */
  proCredit?: boolean;
  thresholdMinor?: number;
}): DecideModelRoute {
  const thresholdMinor = input.thresholdMinor ?? getProAskThresholdMinor();
  const askMinor =
    finitePositiveMinor(input.publishedAskMinor) ?? finitePositiveMinor(input.sellerAskMinor);
  const fallback = defaultModelForAsk(askMinor, thresholdMinor);

  if (input.allowedModelId && isDecideCatalogModel(input.allowedModelId)) {
    return {
      model: input.allowedModelId,
      reason: "allowed_model",
      askMinor,
      thresholdMinor,
    };
  }
  if (input.proCredit === true) {
    return { model: getProModel(), reason: "pro_credit", askMinor, thresholdMinor };
  }
  return { ...fallback, askMinor, thresholdMinor };
}

/**
 * A9 — one-step EasyPost test/mock label for staging dogfood.
 *
 * - Uses EASYPOST_TEST_API_KEY (EZTK/EZTEST) or clear mock artifact.
 * - Never reads EASYPOST_LIVE_API_KEY; fail-closed on staging + live key (R4 spirit).
 * - No real paid / production EasyPost labels.
 */
import {
  type Address,
  type CreateLabelResult,
  EasyPostCarrierAdapter,
  type LabelRequest,
  MockCarrierAdapter,
  type Parcel,
} from "@haggle/shipping-core";
import {
  assertStagingEasyPostTestLabelKeysAllowed,
  classifyEasyPostKeyMode,
  type EasyPostKeyMode,
  isStagingLiveEasyPostKeysForbiddenError,
  resolveEasyPostTestLabelCandidateKey,
  STAGING_LIVE_EASYPOST_KEYS_FORBIDDEN,
} from "./shipping-execution-mode.js";

export { isStagingLiveEasyPostKeysForbiddenError, STAGING_LIVE_EASYPOST_KEYS_FORBIDDEN };

/** Deterministic fake addresses for dogfood — not real customer PII. */
export const EASYPOST_TEST_LABEL_DEFAULT_FROM: Address = {
  name: "Haggle Test Seller",
  street1: "417 Montgomery St",
  city: "San Francisco",
  state: "CA",
  zip: "94104",
  country: "US",
  phone: "4155550100",
};

export const EASYPOST_TEST_LABEL_DEFAULT_TO: Address = {
  name: "Haggle Test Buyer",
  street1: "179 N Harbor Dr",
  city: "San Diego",
  state: "CA",
  zip: "92101",
  country: "US",
  phone: "6195550100",
};

export const EASYPOST_TEST_LABEL_DEFAULT_PARCEL: Parcel = {
  weight_oz: 16,
  length_in: 10,
  width_in: 8,
  height_in: 4,
};

export type EasyPostTestLabelSource = "easypost_test" | "mock";

export interface EasyPostTestLabelOneStepResult {
  source: EasyPostTestLabelSource;
  label_environment: "test" | "mock";
  money_charged: false;
  one_step: true;
  key_mode: EasyPostKeyMode;
  tracking_number: string;
  label_url: string;
  label_qr_code_url: string | null;
  rate_minor: number;
  carrier: string;
  service: string;
  carrier_raw_status: string;
  metadata: Record<string, unknown>;
}

export interface CreateEasyPostTestLabelOneStepInput {
  env?: Partial<NodeJS.ProcessEnv>;
  shipment_id?: string;
  from_address?: Address;
  to_address?: Address;
  parcel?: Parcel;
  service_level?: string;
  /**
   * Injectable purchase hook for unit tests.
   * Production path calls EasyPost test API or MockCarrierAdapter — never live keys.
   */
  purchaseLabel?: (args: {
    apiKey: string | null;
    keyMode: EasyPostKeyMode;
    request: LabelRequest;
  }) => Promise<CreateLabelResult>;
}

function buildLabelRequest(input: CreateEasyPostTestLabelOneStepInput): LabelRequest {
  return {
    from_address: input.from_address ?? EASYPOST_TEST_LABEL_DEFAULT_FROM,
    to_address: input.to_address ?? EASYPOST_TEST_LABEL_DEFAULT_TO,
    parcel: input.parcel ?? EASYPOST_TEST_LABEL_DEFAULT_PARCEL,
    service_level: input.service_level,
  };
}

async function purchaseWithTestKey(
  apiKey: string,
  request: LabelRequest,
  shipmentId: string,
): Promise<CreateLabelResult> {
  const adapter = new EasyPostCarrierAdapter({ api_key: apiKey, is_test: true });
  return adapter.createLabel(
    {
      id: shipmentId,
      order_id: "ord_test_label_one_step",
      carrier: "easypost",
      status: "LABEL_PENDING",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      events: [],
    },
    request,
  );
}

async function purchaseWithMock(
  shipmentId: string,
  request: LabelRequest,
): Promise<CreateLabelResult> {
  const adapter = new MockCarrierAdapter();
  const result = await adapter.createLabel(
    {
      id: shipmentId,
      order_id: "ord_test_label_one_step",
      carrier: "mock",
      status: "LABEL_PENDING",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      events: [],
    },
    request,
  );
  const tracking = result.tracking_number || `MOCK-TEST-${shipmentId.slice(0, 8)}`;
  return {
    ...result,
    tracking_number: tracking,
    label_url: result.label_url ?? `https://mock-labels.haggle.test/${tracking}.pdf`,
    label_qr_code_url:
      result.label_qr_code_url ?? `https://mock-labels.haggle.test/${tracking}-qr.png`,
    rate_minor: result.rate_minor ?? 550,
    service: result.service ?? "GroundAdvantage",
    metadata: {
      ...(result.metadata ?? {}),
      easypost_test_label_one_step: true,
      label_source: "mock",
    },
  };
}

/**
 * One-step EasyPost test/mock label for staging dogfood.
 * Fail-closed when staging would use a live (EZAK) key — never creates a real paid label.
 */
export async function createEasyPostTestLabelOneStep(
  input: CreateEasyPostTestLabelOneStepInput = {},
): Promise<EasyPostTestLabelOneStepResult> {
  const env = input.env ?? process.env;
  const candidateKey = resolveEasyPostTestLabelCandidateKey(env);
  const keyMode = classifyEasyPostKeyMode(candidateKey ?? undefined);

  assertStagingEasyPostTestLabelKeysAllowed({ HAGGLE_ENV: env.HAGGLE_ENV }, keyMode);

  // Defense in depth: the one-step test-label path never purchases with live keys.
  if (keyMode === "live") {
    throw Object.assign(
      new Error(
        `${STAGING_LIVE_EASYPOST_KEYS_FORBIDDEN}: EasyPost test-label one-step forbids live (EZAK) keys. Use EASYPOST_TEST_API_KEY or mock.`,
      ),
      { code: STAGING_LIVE_EASYPOST_KEYS_FORBIDDEN, statusCode: 503 },
    );
  }

  const request = buildLabelRequest(input);
  const shipmentId = input.shipment_id ?? "shp_test_label_one_step";

  let purchased: CreateLabelResult;
  let source: EasyPostTestLabelSource;

  if (keyMode === "test" && candidateKey) {
    source = "easypost_test";
    purchased = input.purchaseLabel
      ? await input.purchaseLabel({ apiKey: candidateKey, keyMode, request })
      : await purchaseWithTestKey(candidateKey, request, shipmentId);
  } else {
    // missing / unknown → clear mock artifact (never call EasyPost with a non-test key)
    source = "mock";
    purchased = input.purchaseLabel
      ? await input.purchaseLabel({ apiKey: null, keyMode, request })
      : await purchaseWithMock(shipmentId, request);
  }

  const trackingNumber = purchased.tracking_number;
  const labelUrl =
    purchased.label_url ?? `https://mock-labels.haggle.test/${trackingNumber || "unknown"}.pdf`;

  return {
    source,
    label_environment: source === "easypost_test" ? "test" : "mock",
    money_charged: false,
    one_step: true,
    key_mode: keyMode,
    tracking_number: trackingNumber,
    label_url: labelUrl,
    label_qr_code_url: purchased.label_qr_code_url ?? null,
    rate_minor: purchased.rate_minor ?? 0,
    carrier:
      typeof purchased.metadata?.easypost_carrier === "string"
        ? purchased.metadata.easypost_carrier
        : source === "easypost_test"
          ? "easypost"
          : "mock",
    service: purchased.service ?? "GroundAdvantage",
    carrier_raw_status: purchased.carrier_raw_status,
    metadata: {
      ...(purchased.metadata ?? {}),
      easypost_test_label_one_step: true,
      label_environment: source === "easypost_test" ? "test" : "mock",
      money_charged: false,
      shipping_provider_environment: source === "easypost_test" ? "test" : "mock",
    },
  };
}

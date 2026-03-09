// ============================================================
// @haggle/ucp-adapter — Public API
// UCP (Universal Commerce Protocol) integration for Haggle
// ============================================================

// --- Profile ---
export type {
  UcpProfile,
  UcpCapabilityEntry,
  UcpServiceEntry,
  UcpPaymentHandlerEntry,
  UcpSigningKey,
  UcpTransport,
} from './profile/types.js';
export {
  UCP_SPEC_VERSION,
  UCP_CAPABILITIES,
  UCP_SERVICES,
  UCP_PAYMENT_HANDLERS,
} from './profile/types.js';
export { createProfileBuilder, buildDefaultHaggleProfile } from './profile/builder.js';
export type { ProfileBuilderOptions } from './profile/builder.js';
export {
  negotiateCapabilities,
} from './profile/negotiator.js';
export type {
  NegotiatedCapability,
  NegotiationResult,
} from './profile/negotiator.js';

// --- Checkout ---
export type {
  CheckoutSession,
  CheckoutStatus,
  LineItem,
  LineItemProduct,
  Total,
  TotalType,
  Buyer,
  Address,
  Fulfillment,
  FulfillmentMethod,
  FulfillmentGroup,
  FulfillmentOption,
  Payment,
  PaymentHandler,
  PaymentInstrument,
  CheckoutLink,
  CheckoutMessage,
  CreateCheckoutRequest,
  UpdateCheckoutRequest,
  CompleteCheckoutRequest,
  UcpRequestHeaders,
} from './checkout/types.js';
export { dollarsToMinorUnits, minorUnitsToDollars } from './checkout/price.js';
export { transitionCheckout, isTerminalCheckoutStatus } from './checkout/state-machine.js';
export type { CheckoutEvent } from './checkout/state-machine.js';
export { createCheckoutStore } from './checkout/store.js';
export type { CheckoutStore, IdempotencyRecord } from './checkout/store.js';
export {
  createCheckoutSession,
  getCheckoutSession,
  updateCheckoutSession,
  completeCheckoutSession,
  cancelCheckoutSession,
  markCheckoutReady,
} from './checkout/operations.js';
export type { CheckoutResult } from './checkout/operations.js';

// --- Extension ---
export type {
  HaggleNegotiationExtension,
  NegotiationExtensionStatus,
  NegotiationConstraints,
} from './extension/negotiation.js';
export {
  NEGOTIATION_EXTENSION_KEY,
  createNegotiationExtension,
} from './extension/negotiation.js';
export { NEGOTIATION_EXTENSION_SCHEMA } from './extension/schema.js';

// --- Session Bridge ---
export {
  createBridgeStore,
  createBridgedSession,
  processNegotiationRound,
  mapHnpStatusToBridge,
} from './checkout/session-bridge.js';
export type {
  BridgedSession,
  BridgedSessionStatus,
  BridgeStore,
  CreateBridgedSessionParams,
  CreateBridgedSessionResult,
  ProcessRoundParams,
  ProcessRoundResult,
} from './checkout/session-bridge.js';

// --- Order ---
export type {
  Order,
  OrderLineItem,
  OrderFulfillmentStatus,
  FulfillmentEvent,
  FulfillmentEventType,
  FulfillmentExpectation,
  OrderAdjustment,
  AdjustmentType,
  AdjustmentStatus,
  OrderWebhookPayload,
} from './order/types.js';
export {
  verifyWebhookSignature,
  createOrderStore,
  processOrderWebhook,
} from './order/webhook.js';
export type { OrderStore, WebhookVerificationResult } from './order/webhook.js';

// --- Payment (USDC) ---
export type {
  UsdcPaymentHandlerConfig,
  UsdcPaymentInstrument,
  UsdcPaymentResult,
  SupportedChain,
  SupportedToken,
} from './payment/types.js';
export { USDC_HANDLER_ID, DEFAULT_USDC_CONFIG } from './payment/types.js';
export {
  validateUsdcInstrument,
  processUsdcPayment,
  buildUsdcPaymentHandlerEntry,
} from './payment/usdc-handler.js';

// --- Transport ---
export { parseUcpHeaders, buildUcpHeaders } from './transport/headers.js';
export type { ParsedUcpHeaders } from './transport/headers.js';

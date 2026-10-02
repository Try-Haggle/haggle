"use client";

import { formatMoney } from "@haggle/shared";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  CheckCircle2,
  ChevronLeft,
  CreditCard,
  ExternalLink,
  FlaskConical,
  RotateCcw,
  Truck,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { useAccount, useBalance, useChainId, useSendCallsSync, useSwitchChain } from "wagmi";
import {
  Alert,
  Button,
  buttonVariants,
  ResultState,
  SelectableOptionCard,
  Spinner,
  Stepper,
} from "@/components/ui";
import { ApiError, api } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { confirmConditionalSettlementFunding } from "@/lib/conditional-settlement-confirmation";
import { createPaymentDisclosureAck } from "@/lib/payment-disclosure";
import { clearSessionDraft, readSessionDraft, writeSessionDraft } from "@/lib/session-draft";
import {
  assertConditionalSettlementTarget,
  HAGGLE_SETTLEMENT_ASSET,
  HAGGLE_WALLET_CHAIN,
  HAGGLE_WALLET_CHAIN_ID,
  HAGGLE_WALLET_NETWORK,
} from "@/lib/wallet-network";
import { useLocale } from "@/providers/locale-provider";
import { checkoutCopy } from "./checkout-copy";

// USDC contract ABI (minimal: approve)
const USDC_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const CONDITIONAL_SETTLEMENT_ABI = [
  {
    name: "createAndFund",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "p",
        type: "tuple",
        components: [
          { name: "orderId", type: "bytes32" },
          { name: "paymentIntentId", type: "bytes32" },
          { name: "approvalPolicyHash", type: "bytes32" },
          { name: "agreementHash", type: "bytes32" },
          { name: "listingHash", type: "bytes32" },
          { name: "grantNonce", type: "bytes32" },
          { name: "buyer", type: "address" },
          { name: "seller", type: "address" },
          { name: "asset", type: "address" },
          { name: "grossAmount", type: "uint256" },
          { name: "expiresAt", type: "uint256" },
          { name: "signerNonce", type: "uint256" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "settlementId", type: "bytes32" }],
  },
] as const;

type PaymentMethod = "crypto" | "card";
type ShippingExecutionMode = "integration_manual" | "physical_live";

interface CheckoutDraft {
  method: PaymentMethod | null;
  shippingExecutionMode: ShippingExecutionMode | null;
}

interface PreparedPaymentResponse {
  intent?: { id?: string };
  order?: { id?: string };
  shipping_execution_mode?: ShippingExecutionMode;
}

function isCheckoutDraft(value: unknown): value is CheckoutDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<CheckoutDraft>;
  return (
    (draft.method === null || draft.method === "crypto" || draft.method === "card") &&
    (draft.shippingExecutionMode === null ||
      draft.shippingExecutionMode === "integration_manual" ||
      draft.shippingExecutionMode === "physical_live")
  );
}

type PaymentStepStatus =
  | "select_method"
  | "connect_wallet"
  | "check_balance"
  | "confirm_payment"
  | "submit"
  | "onramp_loading"
  | "onramp_active"
  | "complete"
  | "error";

interface SoftAgreementAckPayload {
  version: string;
  source: string;
  terms_hash: string;
  attested_at: string;
}

interface PaymentStepProps {
  settlementApprovalId: string;
  amountMinor: number;
  currency: string;
  requiresShipping: boolean;
  physicalShippingReadiness: {
    ready: boolean;
    live_label_max_minor: number;
    missing: string[];
  } | null;
  softAgreementAck: SoftAgreementAckPayload;
}

interface ConditionalSettlementRequest {
  mode: "buyer_contract_call";
  settlement_id?: Hex;
  contract: {
    address: Address;
    network: string;
    asset: "USDC";
    asset_address: Address;
  };
  contract_call: {
    function_name: "createAndFund";
    params: {
      orderId: Hex;
      paymentIntentId: Hex;
      approvalPolicyHash: Hex;
      agreementHash: Hex;
      listingHash: Hex;
      grantNonce: Hex;
      buyer: Address;
      seller: Address;
      asset: Address;
      grossAmount: string;
      expiresAt: string;
      signerNonce: string;
    };
    signature: Hex;
  };
}

interface Money {
  currency: string;
  amount_minor: number;
  decimals?: number;
}

interface QuoteConfirmation {
  rail: "x402" | "stripe";
  display?: {
    rail_label?: string;
    payment_method_label?: string;
    settlement_asset?: "USDC";
    settlement_network?: "Base";
    buyer_total_label?: string;
    seller_receives_label?: string;
    fee_summary_label?: string;
  };
  amount: Money;
  buyer_total: Money;
  seller_receives: Money;
  amount_confirmation?: {
    order_amount: Money;
    buyer_pays: Money;
    settlement_amount: Money;
    seller_receives: Money;
    buyer_fee: Money;
    seller_fee: Money;
  };
  fees: {
    buyer_fee_total: Money;
    seller_fee_total: Money;
    items: Array<{
      code: string;
      label: string;
      payer: "buyer" | "seller";
      amount: Money;
      rate_bps: number;
      included_in_buyer_total: boolean;
    }>;
  };
}

function toConditionalSettlementTuple(request: ConditionalSettlementRequest) {
  const p = request.contract_call.params;
  return {
    orderId: p.orderId,
    paymentIntentId: p.paymentIntentId,
    approvalPolicyHash: p.approvalPolicyHash,
    agreementHash: p.agreementHash,
    listingHash: p.listingHash,
    grantNonce: p.grantNonce,
    buyer: p.buyer,
    seller: p.seller,
    asset: p.asset,
    grossAmount: BigInt(p.grossAmount),
    expiresAt: BigInt(p.expiresAt),
    signerNonce: BigInt(p.signerNonce),
  };
}

function formatMinor(money: Money): string {
  return formatMoney(money);
}

function isConfirmedSettlementAmount(money: Money | undefined): money is Money {
  return Boolean(
    money &&
      money.currency.toUpperCase() === "USDC" &&
      money.decimals === 6 &&
      Number.isInteger(money.amount_minor) &&
      money.amount_minor > 0,
  );
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * After Stripe Onramp fulfillment_complete, the staging webhook may lag briefly
 * before providerContext.stripe_onramp.status becomes ONRAMP_FUNDED. Retry the
 * conditional-settlement request only for that specific gate.
 */
async function requestConditionalSettlementWithOnrampRetry(
  paymentIntentId: string,
  buyerWalletAddress: string,
  isCardOnrampPath: boolean,
): Promise<ConditionalSettlementRequest> {
  const maxAttempts = isCardOnrampPath ? 8 : 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await api.post<ConditionalSettlementRequest>(
        `/payments/${paymentIntentId}/x402/conditional-settlement-request`,
        { buyer_wallet_address: buyerWalletAddress },
      );
    } catch (error) {
      lastError = error;
      const waitingForWebhook =
        isCardOnrampPath && error instanceof ApiError && error.code === "STRIPE_ONRAMP_NOT_FUNDED";
      if (!waitingForWebhook || attempt === maxAttempts - 1) {
        throw error;
      }
      await sleep(1500);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function PaymentStep({
  settlementApprovalId,
  amountMinor,
  currency,
  requiresShipping,
  physicalShippingReadiness,
  softAgreementAck,
}: PaymentStepProps) {
  const { locale } = useLocale();
  const copy = checkoutCopy(locale);
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { data: balance } = useBalance({ address, chainId: HAGGLE_WALLET_CHAIN_ID });
  const { switchChain, isPending: isSwitchingChain } = useSwitchChain();
  const { sendCallsSyncAsync, isPending: isSendingCalls } = useSendCallsSync();

  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [shippingExecutionMode, setShippingExecutionMode] = useState<ShippingExecutionMode | null>(
    requiresShipping ? null : "integration_manual",
  );
  const [step, setStep] = useState<PaymentStepStatus>("select_method");
  const [error, setError] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [_onrampClientSecret, setOnrampClientSecret] = useState<string | null>(null);
  const [conditionalSettlement, setConditionalSettlement] =
    useState<ConditionalSettlementRequest | null>(null);
  const [quoteConfirmation, setQuoteConfirmation] = useState<QuoteConfirmation | null>(null);
  const [quotedBuyerAddress, setQuotedBuyerAddress] = useState<Address | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const draftKey = `haggle:checkout-draft:${settlementApprovalId}`;
  const isWrongNetwork = isConnected && chainId !== HAGGLE_WALLET_CHAIN_ID;

  useEffect(() => {
    const draft = readSessionDraft(draftKey, isCheckoutDraft);
    if (draft) {
      setMethod(draft.method);
      setShippingExecutionMode(
        requiresShipping ? draft.shippingExecutionMode : "integration_manual",
      );
    }
    setDraftReady(true);
  }, [draftKey, requiresShipping]);

  useEffect(() => {
    if (!draftReady || step === "complete") return;
    writeSessionDraft(draftKey, { method, shippingExecutionMode } satisfies CheckoutDraft);
  }, [draftKey, draftReady, method, shippingExecutionMode, step]);

  useEffect(() => {
    if (!paymentIntentId || step === "complete" || step === "select_method" || step === "error") {
      return;
    }

    const disconnected = !isConnected || !address;
    const changedAfterQuote = Boolean(
      quotedBuyerAddress && address && quotedBuyerAddress.toLowerCase() !== address.toLowerCase(),
    );
    const wrongNetworkForPreparedPayment = isWrongNetwork;

    if (changedAfterQuote || (quotedBuyerAddress && wrongNetworkForPreparedPayment)) {
      // The signed request is bound to one buyer address and network. Never carry it across a
      // wallet/account/network change; require a fresh server request for the new wallet.
      setConditionalSettlement(null);
      setQuoteConfirmation(null);
      setQuotedBuyerAddress(null);
    }

    if (disconnected || changedAfterQuote || wrongNetworkForPreparedPayment) {
      setError(null);
      setStep("connect_wallet");
    }
  }, [address, isConnected, isWrongNetwork, paymentIntentId, quotedBuyerAddress, step]);

  function handleBack() {
    setError(null);
    if (step === "connect_wallet") {
      setStep("select_method");
      return;
    }
    if (step === "check_balance") {
      setStep("connect_wallet");
      return;
    }
    if (step === "confirm_payment") {
      setStep("check_balance");
      return;
    }
    setStep("select_method");
  }

  const fallbackAmount: Money = { currency, amount_minor: amountMinor };
  const buyerPayable = quoteConfirmation?.buyer_total ?? fallbackAmount;
  const buyerFee = quoteConfirmation?.fees.buyer_fee_total ?? { currency, amount_minor: 0 };
  const sellerFee = quoteConfirmation?.fees.seller_fee_total ?? { currency, amount_minor: 0 };
  const sellerReceives = quoteConfirmation?.seller_receives ?? {
    currency,
    amount_minor: Math.max(0, amountMinor - sellerFee.amount_minor),
  };
  const confirmedAmounts = quoteConfirmation?.amount_confirmation;
  const buyerPaysDisplay = confirmedAmounts?.buyer_pays ?? buyerPayable;
  const settlementAmountDisplay = confirmedAmounts?.settlement_amount;
  const sellerReceivesDisplay = confirmedAmounts?.seller_receives ?? sellerReceives;
  const buyerFeeDisplay = confirmedAmounts?.buyer_fee ?? buyerFee;
  const sellerFeeDisplay = confirmedAmounts?.seller_fee ?? sellerFee;
  const railLabel =
    (locale === "en" ? quoteConfirmation?.display?.rail_label : undefined) ??
    (quoteConfirmation?.rail === "stripe"
      ? copy.cardRail
      : copy.directRail(HAGGLE_SETTLEMENT_ASSET.symbol));
  const buyerTotalLabel =
    (locale === "en" ? quoteConfirmation?.display?.buyer_total_label : undefined) ?? copy.buyerPays;
  const sellerReceivesLabel =
    (locale === "en" ? quoteConfirmation?.display?.seller_receives_label : undefined) ??
    copy.sellerReceives;
  const feeSummaryLabel =
    (locale === "en" ? quoteConfirmation?.display?.fee_summary_label : undefined) ??
    (quoteConfirmation?.rail === "stripe" ? copy.cardFees : copy.directFees);
  const hasPreparedPayment = paymentIntentId !== null;

  async function handleResumePreparedPayment() {
    if (!paymentIntentId || !method) return;
    if (method === "card") {
      await handleStripeOnramp(paymentIntentId);
      return;
    }
    setStep("check_balance");
  }

  function assertExpectedWalletNetwork() {
    if (chainId !== HAGGLE_WALLET_CHAIN_ID) {
      throw new Error(copy.networkRequired(HAGGLE_WALLET_CHAIN.name));
    }
  }

  async function handlePrepare() {
    if (!isConnected || !address) {
      setError(copy.connectRequired);
      setStep("connect_wallet");
      return;
    }
    if (requiresShipping && !shippingExecutionMode) {
      setError(copy.shippingRequired);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      assertExpectedWalletNetwork();
      const paymentDisclosureAck = createPaymentDisclosureAck({
        stripeFallback: method === "card",
      });
      const data = await api.post<PreparedPaymentResponse>("/payments/prepare", {
        settlement_approval_id: settlementApprovalId,
        ...(requiresShipping && shippingExecutionMode
          ? { shipping_execution_mode: shippingExecutionMode }
          : {}),
        payment_disclosure_ack: paymentDisclosureAck,
        soft_agreement_ack: softAgreementAck,
      });
      const intentId = data.intent?.id;
      const preparedOrderId = data.order?.id;
      if (!intentId || !preparedOrderId) {
        throw new Error(copy.intentMissing);
      }
      if (requiresShipping && data.shipping_execution_mode) {
        setShippingExecutionMode(data.shipping_execution_mode);
      }
      setPaymentIntentId(intentId);
      setOrderId(preparedOrderId);
      // Route based on payment method
      if (method === "card") {
        await handleStripeOnramp(intentId);
        return;
      }
      setStep("check_balance");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("error");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleQuote() {
    if (!paymentIntentId || !address) return;
    setIsLoading(true);
    setError(null);
    setConditionalSettlement(null);
    setQuotedBuyerAddress(null);
    try {
      assertExpectedWalletNetwork();
      const quote = await api.post<{ quote_confirmation?: QuoteConfirmation }>(
        `/payments/${paymentIntentId}/quote`,
      );
      const confirmation = quote.quote_confirmation;
      if (!isConfirmedSettlementAmount(confirmation?.amount_confirmation?.settlement_amount)) {
        throw new Error(copy.quoteMissing(HAGGLE_SETTLEMENT_ASSET.symbol));
      }
      setQuoteConfirmation(confirmation);
      const request = await requestConditionalSettlementWithOnrampRetry(
        paymentIntentId,
        address,
        method === "card",
      );
      assertConditionalSettlementTarget({
        contractAddress: request.contract.address,
        network: request.contract.network,
        assetAddress: request.contract.asset_address,
        requestAssetAddress: request.contract_call.params.asset,
        requestGrossAmount: request.contract_call.params.grossAmount,
        expectedGrossAmountMinor: confirmation.amount_confirmation.settlement_amount.amount_minor,
        requestBuyerAddress: request.contract_call.params.buyer,
        connectedBuyerAddress: address,
      });
      setConditionalSettlement(request);
      setQuotedBuyerAddress(address);
      setStep("confirm_payment");
    } catch (err) {
      setQuoteConfirmation(null);
      setError(err instanceof Error ? err.message : String(err));
      setStep("error");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleStripeOnramp(intentId = paymentIntentId) {
    if (!intentId || !address) {
      setError(copy.onrampWalletRequired);
      setStep("error");
      return;
    }
    setIsLoading(true);
    setStep("onramp_loading");
    setError(null);
    try {
      const data = await api.post<{
        client_secret?: string;
        stripe_publishable_key: string;
        quote_confirmation?: QuoteConfirmation;
        buyer_payable?: Money;
        seller_receives?: Money;
      }>(`/payments/${intentId}/onramp/session`, {
        destination_wallet: address,
      });
      setOnrampClientSecret(data.client_secret ?? null);
      setQuoteConfirmation(
        data.quote_confirmation ??
          (data.buyer_payable
            ? {
                rail: "stripe",
                display: {
                  rail_label: checkoutCopy("en").cardRail,
                  payment_method_label: "Pay by card; Stripe converts to USDC on Base",
                  settlement_asset: "USDC",
                  settlement_network: "Base",
                  buyer_total_label: checkoutCopy("en").buyerPays,
                  seller_receives_label: checkoutCopy("en").sellerReceives,
                  fee_summary_label: checkoutCopy("en").cardFees,
                },
                amount: fallbackAmount,
                buyer_total: data.buyer_payable,
                seller_receives: data.seller_receives ?? fallbackAmount,
                fees: {
                  buyer_fee_total: {
                    currency: data.buyer_payable.currency,
                    amount_minor: data.buyer_payable.amount_minor - amountMinor,
                  },
                  seller_fee_total: { currency, amount_minor: 0 },
                  items: [],
                },
              }
            : null),
      );
      setStep("onramp_active");

      // Load Stripe onramp widget
      if (typeof window !== "undefined" && data.client_secret) {
        const { loadStripeOnramp } = await import("@stripe/crypto/pure");
        const stripeOnramp = await loadStripeOnramp(data.stripe_publishable_key);
        if (stripeOnramp) {
          const session = stripeOnramp.createSession({ clientSecret: data.client_secret });
          session.mount("#stripe-onramp-element");
          session.addEventListener("onramp_session_updated", (event) => {
            if (event.payload.session.status === "fulfillment_complete") {
              // Onramp only funds the buyer wallet. Conditional settlement still
              // required (SoT: ACCEPTED → onramp → webhook ONRAMP_FUNDED → settle).
              clearSessionDraft(draftKey);
              setStep("check_balance");
            }
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("error");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleConfirmPayment() {
    if (!paymentIntentId || !address) return;
    setIsLoading(true);
    setError(null);
    try {
      assertExpectedWalletNetwork();
      if (!conditionalSettlement) {
        throw new Error(copy.requestRequired);
      }
      const target = assertConditionalSettlementTarget({
        contractAddress: conditionalSettlement.contract.address,
        network: conditionalSettlement.contract.network,
        assetAddress: conditionalSettlement.contract.asset_address,
        requestAssetAddress: conditionalSettlement.contract_call.params.asset,
        requestGrossAmount: conditionalSettlement.contract_call.params.grossAmount,
        expectedGrossAmountMinor: settlementAmountDisplay?.amount_minor ?? 0,
        requestBuyerAddress: conditionalSettlement.contract_call.params.buyer,
        connectedBuyerAddress: address,
      });
      const callsStatus = await sendCallsSyncAsync({
        account: address,
        chainId: HAGGLE_WALLET_CHAIN_ID,
        forceAtomic: true,
        throwOnFailure: true,
        timeout: 60_000,
        calls: [
          {
            to: target.assetAddress,
            abi: USDC_ABI,
            functionName: "approve",
            args: [target.contractAddress, BigInt(settlementAmountDisplay?.amount_minor ?? 0)],
          },
          {
            to: target.contractAddress,
            abi: CONDITIONAL_SETTLEMENT_ABI,
            functionName: "createAndFund",
            args: [
              toConditionalSettlementTuple(conditionalSettlement),
              conditionalSettlement.contract_call.signature,
            ],
          },
        ],
      });
      if (callsStatus.status !== "success" || callsStatus.atomic !== true) {
        throw new Error(copy.atomicFailed);
      }
      const txHash = callsStatus.receipts?.at(-1)?.transactionHash;
      if (!txHash) {
        throw new Error(copy.transactionMissing);
      }
      await api.post(
        `/payments/${paymentIntentId}/x402/conditional-settlement-funding`,
        {
          tx_hash: txHash,
          settlement_id: conditionalSettlement.settlement_id,
          contract_address: target.contractAddress,
        },
        {
          headers: {
            "Idempotency-Key": `funding-submit-${paymentIntentId}-${crypto.randomUUID()}`,
          },
        },
      );
      await confirmConditionalSettlementFunding(paymentIntentId);
      clearSessionDraft(draftKey);
      setStep("complete");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(
        /atomic|wallet_sendCalls|method.*(not found|not supported)/i.test(message)
          ? copy.atomicUnsupported
          : message,
      );
      setStep("error");
    } finally {
      setIsLoading(false);
    }
  }

  const progressSteps = copy.progressSteps;
  const currentStepIndex: number =
    step === "select_method"
      ? 0
      : step === "connect_wallet"
        ? 1
        : step === "check_balance"
          ? 2
          : step === "confirm_payment"
            ? 3
            : step === "complete"
              ? 4
              : 3;
  const backLabel =
    step === "connect_wallet"
      ? copy.backToOptions
      : step === "check_balance"
        ? copy.backToWallet
        : step === "confirm_payment"
          ? copy.backToQuote
          : copy.backToOptions;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="font-semibold text-ink text-lg">{copy.paymentTitle}</h2>
        <p className="text-ink-secondary text-sm">
          {quoteConfirmation && <span className="font-medium text-ink">{railLabel}: </span>}
          {formatMinor(buyerPaysDisplay)}
          {buyerFeeDisplay.amount_minor > 0 && (
            <span className="ml-2 text-ink-muted text-xs">
              {copy.includesFee(formatMinor(buyerFeeDisplay))}
            </span>
          )}
        </p>
      </div>

      <Stepper steps={progressSteps} current={currentStepIndex} showLabels={false} />

      {step !== "select_method" && step !== "complete" && (
        <button
          type="button"
          onClick={handleBack}
          disabled={isLoading || isSendingCalls}
          className="inline-flex items-center gap-1.5 rounded text-ink-secondary text-sm transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ChevronLeft className="size-4" />
          {backLabel}
        </button>
      )}

      {HAGGLE_WALLET_NETWORK === "base-sepolia" && (
        <Alert tone="info" title={copy.testnetTitle}>
          {copy.testnetNote(HAGGLE_SETTLEMENT_ASSET.symbol)}
        </Alert>
      )}

      {step === "select_method" && (
        <div className="space-y-6">
          {requiresShipping && (
            <section className="space-y-3" aria-labelledby="fulfillment-test-heading">
              <div>
                <h3 id="fulfillment-test-heading" className="font-medium text-ink text-sm">
                  {copy.fulfillmentTitle}
                </h3>
                <p className="mt-1 text-ink-secondary text-xs">{copy.fulfillmentNote}</p>
              </div>
              <SelectableOptionCard
                selected={shippingExecutionMode === "integration_manual"}
                icon={<FlaskConical className="size-5" />}
                title={copy.integrationTitle}
                description={copy.integrationDescription}
                onClick={() => setShippingExecutionMode("integration_manual")}
                disabled={hasPreparedPayment}
              />
              <SelectableOptionCard
                selected={shippingExecutionMode === "physical_live"}
                icon={<Truck className="size-5" />}
                title={copy.physicalTitle}
                description={copy.physicalDescription(
                  ((physicalShippingReadiness?.live_label_max_minor ?? 5000) / 100).toFixed(2),
                )}
                disabled={
                  hasPreparedPayment ||
                  (HAGGLE_WALLET_NETWORK === "base-sepolia" &&
                    physicalShippingReadiness?.ready !== true)
                }
                onClick={() => setShippingExecutionMode("physical_live")}
                className="disabled:cursor-not-allowed disabled:opacity-50"
              />
              {HAGGLE_WALLET_NETWORK === "base-sepolia" &&
                physicalShippingReadiness?.ready !== true && (
                  <Alert tone="warning" title={copy.shippingSetupTitle}>
                    {physicalShippingReadiness?.missing.length
                      ? physicalShippingReadiness.missing.join(" · ")
                      : copy.shippingSetupNote}
                  </Alert>
                )}
              {shippingExecutionMode === "physical_live" &&
                HAGGLE_WALLET_NETWORK === "base-sepolia" && (
                  <Alert tone="warning" title={copy.postageTitle}>
                    {copy.postageNote(HAGGLE_SETTLEMENT_ASSET.symbol)}
                  </Alert>
                )}
            </section>
          )}

          {requiresShipping && !shippingExecutionMode && (
            <p role="status" className="text-sm text-ink-secondary">
              {copy.chooseShippingHint}
            </p>
          )}
          <section
            className="space-y-3"
            aria-labelledby="payment-method-heading"
            data-testid="checkout-payment-rail"
          >
            <div>
              <h3 id="payment-method-heading" className="font-medium text-ink text-sm">
                {copy.methodHeading}
              </h3>
              <p className="mt-1 text-ink-secondary text-xs">
                {copy.assetNote(HAGGLE_SETTLEMENT_ASSET.symbol, HAGGLE_WALLET_CHAIN.name)}
              </p>
            </div>
            <SelectableOptionCard
              selected={method === "card"}
              icon={<CreditCard className="size-5" />}
              title={copy.cardTitle}
              description={copy.cardDescription}
              onClick={() => {
                setMethod("card");
                setStep("connect_wallet");
              }}
              disabled={hasPreparedPayment || (requiresShipping && !shippingExecutionMode)}
            />
            <SelectableOptionCard
              selected={method === "crypto"}
              icon={<WalletCards className="size-5" />}
              title={copy.directTitle(HAGGLE_SETTLEMENT_ASSET.symbol, formatMinor(fallbackAmount))}
              description={copy.directDescription(HAGGLE_WALLET_CHAIN.name)}
              onClick={() => {
                setMethod("crypto");
                setStep("connect_wallet");
              }}
              disabled={hasPreparedPayment || (requiresShipping && !shippingExecutionMode)}
            />
            {hasPreparedPayment && method && (
              <Alert tone="info" title={copy.savedTitle}>
                <div className="space-y-3">
                  <p>{copy.savedNote}</p>
                  <Button onClick={handleResumePreparedPayment} loading={isLoading} fullWidth>
                    {copy.continuePayment}
                  </Button>
                </div>
              </Alert>
            )}
          </section>
        </div>
      )}

      {step === "onramp_active" && (
        <div className="space-y-3">
          <p className="text-ink-secondary text-sm">{copy.stripeActive}</p>
          <div
            id="stripe-onramp-element"
            className="min-h-[400px] rounded-lg border border-line bg-surface-raised"
          />
        </div>
      )}

      {step === "onramp_loading" && (
        <div className="flex flex-col items-center gap-3 py-10 text-ink-secondary">
          <Spinner size="lg" />
          <p className="text-sm">{copy.stripeLoading}</p>
        </div>
      )}

      <div className="space-y-4">
        {step === "connect_wallet" && (
          <div className="space-y-3">
            {!isConnected ? (
              <>
                <p className="text-ink-secondary text-sm">
                  {method === "card" ? copy.connectCard : copy.connectDirect}
                </p>
                <ConnectButton label={copy.connectWallet} />
                <p className="text-ink-muted text-xs">{copy.walletsHint}</p>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-sunken p-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-success">{copy.connected}</p>
                    <p className="truncate font-mono text-ink-secondary text-xs">{address}</p>
                  </div>
                  <ConnectButton.Custom>
                    {({ openAccountModal }) => (
                      <Button variant="secondary" size="sm" onClick={openAccountModal}>
                        {copy.changeWallet}
                      </Button>
                    )}
                  </ConnectButton.Custom>
                </div>
                {isWrongNetwork && (
                  <Alert tone="warning" title={copy.switchTitle(HAGGLE_WALLET_CHAIN.name)}>
                    <div className="space-y-3">
                      <p>{copy.switchNote}</p>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => switchChain({ chainId: HAGGLE_WALLET_CHAIN_ID })}
                        loading={isSwitchingChain}
                      >
                        {copy.switchNetwork}
                      </Button>
                    </div>
                  </Alert>
                )}
                {isConnected && !isWrongNetwork && (
                  <Button
                    onClick={hasPreparedPayment ? handleResumePreparedPayment : handlePrepare}
                    loading={isLoading}
                    fullWidth
                  >
                    {isLoading
                      ? copy.preparing
                      : hasPreparedPayment
                        ? copy.continuePrepared
                        : copy.continue}
                  </Button>
                )}
              </>
            )}
          </div>
        )}

        {step === "check_balance" && (
          <div className="space-y-3">
            <div className="space-y-2 rounded-lg bg-surface-sunken p-4">
              <div className="flex justify-between text-sm">
                <span className="text-ink-secondary">{copy.yourAddress}</span>
                <span className="font-mono text-ink text-xs">
                  {address?.slice(0, 6)}...{address?.slice(-4)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-ink-secondary">{copy.ethBalance}</span>
                <span className="text-ink">
                  {balance ? `${Number(balance.formatted).toFixed(4)} ETH` : "—"}
                </span>
              </div>
              <div className="flex justify-between text-sm font-medium">
                <span className="text-ink-secondary">{buyerTotalLabel}</span>
                <span className="text-ink">{formatMinor(buyerPaysDisplay)}</span>
              </div>
              {method === "crypto" && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-ink-secondary">{copy.rail}</span>
                    <span className="text-ink">{railLabel}</span>
                  </div>
                  {quoteConfirmation && (
                    <div className="flex justify-between text-sm">
                      <span className="text-ink-secondary">{sellerReceivesLabel}</span>
                      <span className="text-ink">{formatMinor(sellerReceivesDisplay)}</span>
                    </div>
                  )}
                </>
              )}
            </div>
            {method === "card" && (
              <Alert tone="info" title={copy.fundedTitle}>
                {copy.fundedNote(HAGGLE_SETTLEMENT_ASSET.symbol)}
              </Alert>
            )}
            <Button onClick={handleQuote} loading={isLoading} disabled={isWrongNetwork} fullWidth>
              {isLoading
                ? method === "card"
                  ? copy.waitingQuote
                  : copy.loading
                : method === "crypto"
                  ? copy.getQuote(HAGGLE_SETTLEMENT_ASSET.symbol)
                  : copy.continueSettlement(HAGGLE_SETTLEMENT_ASSET.symbol)}
            </Button>
          </div>
        )}

        {step === "confirm_payment" && (
          <div className="space-y-3">
            <p className="text-ink-secondary text-sm">
              {copy.confirmDeposit(formatMinor(settlementAmountDisplay ?? buyerPaysDisplay))}
            </p>
            {(buyerFeeDisplay.amount_minor > 0 || sellerFeeDisplay.amount_minor > 0) && (
              <div className="space-y-1 rounded-lg bg-surface-sunken p-3 text-ink-secondary text-xs">
                <div className="flex justify-between font-medium">
                  <span>{copy.rail}</span>
                  <span className="text-ink">{railLabel}</span>
                </div>
                {settlementAmountDisplay && (
                  <div className="flex justify-between">
                    <span>{copy.settlementAmount}</span>
                    <span>{formatMinor(settlementAmountDisplay)}</span>
                  </div>
                )}
                {buyerFeeDisplay.amount_minor > 0 && (
                  <div className="flex justify-between">
                    <span>{copy.buyerFee}</span>
                    <span>{formatMinor(buyerFeeDisplay)}</span>
                  </div>
                )}
                {sellerFeeDisplay.amount_minor > 0 && (
                  <div className="flex justify-between">
                    <span>{copy.sellerFee}</span>
                    <span>{formatMinor(sellerFeeDisplay)}</span>
                  </div>
                )}
                <div className="flex justify-between font-medium">
                  <span>{sellerReceivesLabel}</span>
                  <span>{formatMinor(sellerReceivesDisplay)}</span>
                </div>
                <p className="pt-1 text-ink-muted">{feeSummaryLabel}</p>
              </div>
            )}
            {conditionalSettlement && <p className="text-ink-muted text-xs">{copy.atomicNote}</p>}
            <Button
              onClick={handleConfirmPayment}
              disabled={
                isLoading ||
                isSendingCalls ||
                isWrongNetwork ||
                !settlementAmountDisplay ||
                !conditionalSettlement
              }
              loading={isLoading || isSendingCalls}
              fullWidth
            >
              {isLoading || isSendingCalls
                ? copy.confirming
                : copy.pay(formatMinor(settlementAmountDisplay ?? buyerPaysDisplay))}
            </Button>
          </div>
        )}

        {step === "complete" && (
          <ResultState
            tone="success"
            icon={<CheckCircle2 className="size-7" />}
            title={conditionalSettlement ? copy.confirmedTitle : copy.submittedTitle}
            description={
              conditionalSettlement
                ? copy.confirmedDescription(
                    formatMinor(settlementAmountDisplay ?? buyerPaysDisplay),
                  )
                : copy.submittedDescription(formatMinor(buyerPaysDisplay))
            }
            action={
              orderId ? (
                <Link href={`/orders/${orderId}`} className={cn(buttonVariants(), "min-w-44")}>
                  {copy.viewOrder}
                  <ExternalLink className="size-4" />
                </Link>
              ) : undefined
            }
          />
        )}

        {step === "error" && (
          <div className="space-y-3">
            <Alert tone="error" title={copy.errorTitle}>
              {error}
            </Alert>
            <Button
              variant="secondary"
              onClick={() => {
                setError(null);
                setStep(
                  paymentIntentId && (method === "crypto" || method === "card")
                    ? "check_balance"
                    : "connect_wallet",
                );
              }}
              fullWidth
            >
              <RotateCcw className="size-4" />
              {copy.retry}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

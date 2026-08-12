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
import { api } from "@/lib/api-client";
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

export function PaymentStep({
  settlementApprovalId,
  amountMinor,
  currency,
  requiresShipping,
  physicalShippingReadiness,
}: PaymentStepProps) {
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
  const [draftReady, setDraftReady] = useState(false);
  const draftKey = `haggle:checkout-draft:${settlementApprovalId}`;

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
    quoteConfirmation?.display?.rail_label ??
    (quoteConfirmation?.rail === "stripe"
      ? "Card via Stripe"
      : `${HAGGLE_SETTLEMENT_ASSET.symbol} Direct`);
  const buyerTotalLabel = quoteConfirmation?.display?.buyer_total_label ?? "Buyer pays";
  const sellerReceivesLabel =
    quoteConfirmation?.display?.seller_receives_label ?? "Seller receives";
  const feeSummaryLabel =
    quoteConfirmation?.display?.fee_summary_label ??
    (quoteConfirmation?.rail === "stripe"
      ? "Buyer pays the Stripe onramp fee. Haggle fee is deducted from seller proceeds."
      : "No buyer fee. Haggle fee is deducted from seller proceeds.");
  const isWrongNetwork = isConnected && chainId !== HAGGLE_WALLET_CHAIN_ID;
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
      throw new Error(`Switch your wallet to ${HAGGLE_WALLET_CHAIN.name} before continuing.`);
    }
  }

  async function handlePrepare() {
    if (!isConnected || !address) {
      setError("Connect a wallet before continuing.");
      setStep("connect_wallet");
      return;
    }
    if (requiresShipping && !shippingExecutionMode) {
      setError("Choose a fulfillment test before continuing.");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      assertExpectedWalletNetwork();
      const data = await api.post<{ intent?: { id?: string }; order?: { id?: string } }>(
        "/payments/prepare",
        {
          settlement_approval_id: settlementApprovalId,
          ...(requiresShipping && shippingExecutionMode
            ? { shipping_execution_mode: shippingExecutionMode }
            : {}),
          payment_disclosure_ack: createPaymentDisclosureAck({ stripeFallback: method === "card" }),
        },
      );
      const intentId = data.intent?.id;
      const preparedOrderId = data.order?.id;
      if (!intentId || !preparedOrderId) {
        throw new Error("The payment intent or order was not returned.");
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
    try {
      assertExpectedWalletNetwork();
      const quote = await api.post<{ quote_confirmation?: QuoteConfirmation }>(
        `/payments/${paymentIntentId}/quote`,
      );
      const confirmation = quote.quote_confirmation;
      if (!isConfirmedSettlementAmount(confirmation?.amount_confirmation?.settlement_amount)) {
        throw new Error(
          `${HAGGLE_SETTLEMENT_ASSET.symbol} quote did not include a confirmed settlement amount.`,
        );
      }
      setQuoteConfirmation(confirmation);
      const request = await api.post<ConditionalSettlementRequest>(
        `/payments/${paymentIntentId}/x402/conditional-settlement-request`,
        { buyer_wallet_address: address },
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
      setStep("confirm_payment");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("error");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleStripeOnramp(intentId = paymentIntentId) {
    if (!intentId || !address) {
      setError("Connect a wallet before starting card onramp.");
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
                  rail_label: "Card via Stripe",
                  payment_method_label: "Pay by card; Stripe converts to USDC on Base",
                  settlement_asset: "USDC",
                  settlement_network: "Base",
                  buyer_total_label: "Buyer pays",
                  seller_receives_label: "Seller receives",
                  fee_summary_label:
                    "Buyer pays the Stripe onramp fee. Haggle fee is deducted from seller proceeds.",
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
              clearSessionDraft(draftKey);
              setStep("complete");
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
        throw new Error("A verified conditional settlement request is required before funding.");
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
        throw new Error("The wallet did not complete the payment as one atomic transaction.");
      }
      const txHash = callsStatus.receipts?.at(-1)?.transactionHash;
      if (!txHash) {
        throw new Error("The wallet did not return the confirmed payment transaction hash.");
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
          ? "This wallet cannot combine approval and payment into one confirmation. Use a wallet with atomic batch support."
          : message,
      );
      setStep("error");
    } finally {
      setIsLoading(false);
    }
  }

  const progressSteps = ["Method", "Wallet", "Quote", "Pay", "Complete"];
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
      ? "Back to payment options"
      : step === "check_balance"
        ? "Back to wallet"
        : step === "confirm_payment"
          ? "Back to quote"
          : "Back to payment options";

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="font-semibold text-ink text-lg">Secure payment</h2>
        <p className="text-ink-secondary text-sm">
          {quoteConfirmation && <span className="font-medium text-ink">{railLabel}: </span>}
          {formatMinor(buyerPaysDisplay)}
          {buyerFeeDisplay.amount_minor > 0 && (
            <span className="ml-2 text-ink-muted text-xs">
              includes {formatMinor(buyerFeeDisplay)} buyer fee
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
        <Alert tone="info" title="Base Sepolia testnet">
          This checkout accepts test ETH and {HAGGLE_SETTLEMENT_ASSET.symbol} only. These assets
          have no monetary value.
        </Alert>
      )}

      {step === "select_method" && (
        <div className="space-y-6">
          {requiresShipping && (
            <section className="space-y-3" aria-labelledby="fulfillment-test-heading">
              <div>
                <h3 id="fulfillment-test-heading" className="font-medium text-ink text-sm">
                  Choose a fulfillment test
                </h3>
                <p className="mt-1 text-ink-secondary text-xs">
                  This choice is locked when payment preparation starts.
                </p>
              </div>
              <SelectableOptionCard
                selected={shippingExecutionMode === "integration_manual"}
                icon={<FlaskConical className="size-5" />}
                title="Integration test"
                description="Use EasyPost test rates and labels. The team can advance carrier states without moving a parcel."
                onClick={() => setShippingExecutionMode("integration_manual")}
                disabled={hasPreparedPayment}
              />
              <SelectableOptionCard
                selected={shippingExecutionMode === "physical_live"}
                icon={<Truck className="size-5" />}
                title="Physical shipping rehearsal"
                description={`Use real addresses, a paid EasyPost label, and actual carrier scans. Haggle pays up to $${((physicalShippingReadiness?.live_label_max_minor ?? 5000) / 100).toFixed(2)} in staging postage.`}
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
                  <Alert tone="warning" title="Physical shipping setup is incomplete">
                    {physicalShippingReadiness?.missing.length
                      ? physicalShippingReadiness.missing.join(" · ")
                      : "Shipping readiness could not be verified."}
                  </Alert>
                )}
              {shippingExecutionMode === "physical_live" &&
                HAGGLE_WALLET_NETWORK === "base-sepolia" && (
                  <Alert tone="warning" title="Real postage, test settlement">
                    EasyPost charges Haggle's staging payment method in USD. The order settlement
                    still uses {HAGGLE_SETTLEMENT_ASSET.symbol}, which has no monetary value and
                    does not reimburse that postage.
                  </Alert>
                )}
            </section>
          )}

          <section className="space-y-3" aria-labelledby="payment-method-heading">
            <div>
              <h3 id="payment-method-heading" className="font-medium text-ink text-sm">
                Choose a payment method
              </h3>
              <p className="mt-1 text-ink-secondary text-xs">
                Settlement asset: {HAGGLE_SETTLEMENT_ASSET.symbol} on {HAGGLE_WALLET_CHAIN.name}
              </p>
            </div>
            <SelectableOptionCard
              selected={method === "card"}
              icon={<CreditCard className="size-5" />}
              title="Pay with card"
              description="Stripe converts the card payment to USDC. The complete fee is shown before authorization."
              onClick={() => {
                setMethod("card");
                setStep("connect_wallet");
              }}
              disabled={hasPreparedPayment || (requiresShipping && !shippingExecutionMode)}
            />
            <SelectableOptionCard
              selected={method === "crypto"}
              icon={<WalletCards className="size-5" />}
              title={`${HAGGLE_SETTLEMENT_ASSET.symbol} Direct (${formatMinor(fallbackAmount)})`}
              description={`Pay from a ${HAGGLE_WALLET_CHAIN.name} wallet. Haggle shows the settlement and seller fee before authorization.`}
              onClick={() => {
                setMethod("crypto");
                setStep("connect_wallet");
              }}
              disabled={hasPreparedPayment || (requiresShipping && !shippingExecutionMode)}
            />
            {hasPreparedPayment && method && (
              <Alert tone="info" title="Payment choices saved">
                <div className="space-y-3">
                  <p>
                    Shipping mode and payment method are locked after payment preparation. You can
                    review them here, then continue without reconnecting your wallet.
                  </p>
                  <Button onClick={handleResumePreparedPayment} loading={isLoading} fullWidth>
                    Continue payment
                  </Button>
                </div>
              </Alert>
            )}
          </section>
        </div>
      )}

      {step === "onramp_active" && (
        <div className="space-y-3">
          <p className="text-ink-secondary text-sm">Complete the payment in Stripe.</p>
          <div
            id="stripe-onramp-element"
            className="min-h-[400px] rounded-lg border border-line bg-surface-raised"
          />
        </div>
      )}

      {step === "onramp_loading" && (
        <div className="flex flex-col items-center gap-3 py-10 text-ink-secondary">
          <Spinner size="lg" />
          <p className="text-sm">Setting up card payment...</p>
        </div>
      )}

      <div className="space-y-4">
        {step === "connect_wallet" && (
          <div className="space-y-3">
            {!isConnected ? (
              <>
                <p className="text-ink-secondary text-sm">
                  {method === "card"
                    ? "Connect the wallet that should receive USDC after your card payment."
                    : "Connect your wallet to pay with USDC."}
                </p>
                <ConnectButton />
                <p className="text-ink-muted text-xs">You can use any wallet you control.</p>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-sunken p-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-success">Wallet connected</p>
                    <p className="truncate font-mono text-ink-secondary text-xs">{address}</p>
                  </div>
                  <ConnectButton.Custom>
                    {({ openAccountModal }) => (
                      <Button variant="secondary" size="sm" onClick={openAccountModal}>
                        Change
                      </Button>
                    )}
                  </ConnectButton.Custom>
                </div>
                {isWrongNetwork && (
                  <Alert tone="warning" title={`Switch to ${HAGGLE_WALLET_CHAIN.name}`}>
                    <div className="space-y-3">
                      <p>This checkout blocks transactions from every other network.</p>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => switchChain({ chainId: HAGGLE_WALLET_CHAIN_ID })}
                        loading={isSwitchingChain}
                      >
                        Switch network
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
                      ? "Preparing..."
                      : hasPreparedPayment
                        ? "Continue prepared payment"
                        : "Continue"}
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
                <span className="text-ink-secondary">Your address</span>
                <span className="font-mono text-ink text-xs">
                  {address?.slice(0, 6)}...{address?.slice(-4)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-ink-secondary">ETH balance</span>
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
                    <span className="text-ink-secondary">Rail</span>
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
            <Button onClick={handleQuote} loading={isLoading} disabled={isWrongNetwork} fullWidth>
              {isLoading
                ? "Loading..."
                : method === "crypto"
                  ? `Get ${HAGGLE_SETTLEMENT_ASSET.symbol} Quote`
                  : "Get Quote"}
            </Button>
          </div>
        )}

        {step === "confirm_payment" && (
          <div className="space-y-3">
            <p className="text-ink-secondary text-sm">
              Confirm once in your wallet to approve and securely deposit{" "}
              <strong>{formatMinor(settlementAmountDisplay ?? buyerPaysDisplay)}</strong>. The
              seller is paid only after the release conditions are met.
            </p>
            {(buyerFeeDisplay.amount_minor > 0 || sellerFeeDisplay.amount_minor > 0) && (
              <div className="space-y-1 rounded-lg bg-surface-sunken p-3 text-ink-secondary text-xs">
                <div className="flex justify-between font-medium">
                  <span>Rail</span>
                  <span className="text-ink">{railLabel}</span>
                </div>
                {settlementAmountDisplay && (
                  <div className="flex justify-between">
                    <span>Settlement amount</span>
                    <span>{formatMinor(settlementAmountDisplay)}</span>
                  </div>
                )}
                {buyerFeeDisplay.amount_minor > 0 && (
                  <div className="flex justify-between">
                    <span>Buyer fee</span>
                    <span>{formatMinor(buyerFeeDisplay)}</span>
                  </div>
                )}
                {sellerFeeDisplay.amount_minor > 0 && (
                  <div className="flex justify-between">
                    <span>Seller fee</span>
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
            {conditionalSettlement && (
              <p className="text-ink-muted text-xs">
                Approval and deposit run together. If either action fails, neither is applied.
              </p>
            )}
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
                ? "Confirming payment..."
                : `Pay ${formatMinor(settlementAmountDisplay ?? buyerPaysDisplay)} securely`}
            </Button>
          </div>
        )}

        {step === "complete" && (
          <ResultState
            tone="success"
            icon={<CheckCircle2 className="size-7" />}
            title={conditionalSettlement ? "Funding confirmed" : "Payment complete"}
            description={
              conditionalSettlement
                ? `Your ${formatMinor(settlementAmountDisplay ?? buyerPaysDisplay)} funding transaction is confirmed. The funds remain protected by the release and dispute rules.`
                : `Your payment of ${formatMinor(buyerPaysDisplay)} has been submitted.`
            }
            action={
              orderId ? (
                <Link href={`/orders/${orderId}`} className={cn(buttonVariants(), "min-w-44")}>
                  View order
                  <ExternalLink className="size-4" />
                </Link>
              ) : undefined
            }
          />
        )}

        {step === "error" && (
          <div className="space-y-3">
            <Alert tone="error" title="Payment could not continue">
              {error}
            </Alert>
            <Button
              variant="secondary"
              onClick={() => {
                setError(null);
                setStep(
                  method === "crypto" && paymentIntentId ? "check_balance" : "connect_wallet",
                );
              }}
              fullWidth
            >
              <RotateCcw className="size-4" />
              Try Again
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

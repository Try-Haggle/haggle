"use client";

import { formatMoney } from "@haggle/shared";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { CheckCircle2, CreditCard, ExternalLink, RotateCcw, WalletCards } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { Address, Hex } from "viem";
import { useAccount, useBalance, useWriteContract } from "wagmi";
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
import { createPaymentDisclosureAck } from "@/lib/payment-disclosure";

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

type PaymentStepStatus =
  | "select_method"
  | "connect_wallet"
  | "check_balance"
  | "approve_usdc"
  | "sign_x402"
  | "submit"
  | "onramp_loading"
  | "onramp_active"
  | "complete"
  | "error";

interface PaymentStepProps {
  settlementApprovalId: string;
  amountMinor: number;
  currency: string;
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

export function PaymentStep({ settlementApprovalId, amountMinor, currency }: PaymentStepProps) {
  const { address, isConnected } = useAccount();
  const { data: balance } = useBalance({ address });
  const { writeContract, isPending: isWriting } = useWriteContract();

  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [step, setStep] = useState<PaymentStepStatus>("select_method");
  const [error, setError] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [_onrampClientSecret, setOnrampClientSecret] = useState<string | null>(null);
  const [conditionalSettlement, setConditionalSettlement] =
    useState<ConditionalSettlementRequest | null>(null);
  const [quoteConfirmation, setQuoteConfirmation] = useState<QuoteConfirmation | null>(null);

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
    (quoteConfirmation?.rail === "stripe" ? "Card via Stripe" : "USDC Direct");
  const buyerTotalLabel = quoteConfirmation?.display?.buyer_total_label ?? "Buyer pays";
  const sellerReceivesLabel =
    quoteConfirmation?.display?.seller_receives_label ?? "Seller receives";
  const feeSummaryLabel =
    quoteConfirmation?.display?.fee_summary_label ??
    (quoteConfirmation?.rail === "stripe"
      ? "Buyer pays the Stripe onramp fee. Haggle fee is deducted from seller proceeds."
      : "No buyer fee. Haggle fee is deducted from seller proceeds.");

  async function handlePrepare() {
    if (!isConnected || !address) {
      setError("Connect a wallet before continuing.");
      setStep("connect_wallet");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.post<{ intent?: { id?: string }; order?: { id?: string } }>(
        "/payments/prepare",
        {
          settlement_approval_id: settlementApprovalId,
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
    if (!paymentIntentId) return;
    setIsLoading(true);
    setError(null);
    try {
      const quote = await api.post<{ quote_confirmation?: QuoteConfirmation }>(
        `/payments/${paymentIntentId}/quote`,
      );
      const confirmation = quote.quote_confirmation;
      if (!isConfirmedSettlementAmount(confirmation?.amount_confirmation?.settlement_amount)) {
        throw new Error("USDC Direct quote did not include a confirmed settlement amount.");
      }
      setQuoteConfirmation(confirmation);
      if (address) {
        try {
          const request = await api.post<ConditionalSettlementRequest>(
            `/payments/${paymentIntentId}/x402/conditional-settlement-request`,
            { buyer_wallet_address: address },
          );
          setConditionalSettlement(request);
        } catch {
          setConditionalSettlement(null);
        }
      }
      setStep("approve_usdc");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("error");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleApproveUsdc(spenderAddress: `0x${string}`, usdcAddress: `0x${string}`) {
    setIsLoading(true);
    setError(null);
    try {
      if (!isConfirmedSettlementAmount(settlementAmountDisplay)) {
        throw new Error("Approve requires a confirmed USDC settlement amount.");
      }
      const amount = BigInt(settlementAmountDisplay.amount_minor);
      writeContract(
        {
          address: usdcAddress,
          abi: USDC_ABI,
          functionName: "approve",
          args: [spenderAddress, amount],
        },
        {
          onSuccess: () => setStep("sign_x402"),
          onError: (err: Error) => {
            setError(err.message);
            setStep("error");
          },
        },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("error");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleStripeOnramp(intentId = paymentIntentId) {
    if (!intentId || !address) {
      setError("Connect a registered wallet before starting card onramp.");
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

  async function handleSubmitX402() {
    if (!paymentIntentId || !address) return;
    setIsLoading(true);
    setError(null);
    try {
      if (conditionalSettlement) {
        writeContract(
          {
            address: conditionalSettlement.contract.address,
            abi: CONDITIONAL_SETTLEMENT_ABI,
            functionName: "createAndFund",
            args: [
              toConditionalSettlementTuple(conditionalSettlement),
              conditionalSettlement.contract_call.signature,
            ],
          },
          {
            onSuccess: async (txHash) => {
              try {
                await api.post(`/payments/${paymentIntentId}/x402/conditional-settlement-funding`, {
                  tx_hash: txHash,
                  settlement_id: conditionalSettlement.settlement_id,
                  contract_address: conditionalSettlement.contract.address,
                });
                await api
                  .post(`/payments/${paymentIntentId}/x402/conditional-settlement-confirmation`, {
                    tx_hash: txHash,
                  })
                  .catch(() => {
                    // Receipt may not be indexed yet; server keeps FUNDING_SUBMITTED for retry.
                  });
                setStep("complete");
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
                setStep("error");
              }
            },
            onError: (err: Error) => {
              setError(err.message);
              setStep("error");
            },
          },
        );
        return;
      }

      // Get x402 requirements
      const requirements = await api.get<{ accepts?: Array<{ network?: string }> }>(
        `/payments/${paymentIntentId}/x402/requirements`,
      );

      // Build x402 payment payload envelope
      const paymentPayload = {
        x402Version: 1 as const,
        scheme: "exact" as const,
        network: requirements.accepts?.[0]?.network ?? "eip155:8453",
        payload: {
          from: address,
          authorization: requirements.accepts?.[0] ?? {},
        },
        paymentRequirements: requirements,
      };

      await api.post(`/payments/${paymentIntentId}/x402/submit-signature`, {
        payment_payload: paymentPayload,
      });

      setStep("complete");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("error");
    } finally {
      setIsLoading(false);
    }
  }

  const progressSteps = ["Method", "Wallet", "Quote", "Authorize", "Complete"];
  const currentStepIndex: number =
    step === "select_method"
      ? 0
      : step === "connect_wallet"
        ? 1
        : step === "check_balance"
          ? 2
          : step === "complete"
            ? 4
            : 3;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="font-semibold text-ink text-lg">Complete payment</h2>
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

      {step === "select_method" && (
        <div className="space-y-3">
          <p className="text-ink-secondary text-sm">Choose a payment method.</p>
          <SelectableOptionCard
            selected={method === "card"}
            icon={<CreditCard className="size-5" />}
            title="Pay with card"
            description="Stripe converts the card payment to USDC. The complete fee is shown before authorization."
            onClick={() => {
              setMethod("card");
              setStep("connect_wallet");
            }}
          />
          <SelectableOptionCard
            selected={method === "crypto"}
            icon={<WalletCards className="size-5" />}
            title={`USDC Direct (${formatMinor(fallbackAmount)})`}
            description="Pay from a Base wallet. Haggle shows the settlement and seller fee before authorization."
            onClick={() => {
              setMethod("crypto");
              setStep("connect_wallet");
            }}
          />
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
            {method === "card" && !isConnected ? (
              <>
                <p className="text-ink-secondary text-sm">
                  Connect the wallet that should receive USDC after your card payment.
                </p>
                <ConnectButton />
                <p className="text-ink-muted text-xs">
                  The connected wallet must be registered to your Haggle account.
                </p>
              </>
            ) : (
              <>
                <p className="text-ink-secondary text-sm">
                  {method === "crypto"
                    ? "Connect your wallet to pay with USDC."
                    : "Connect your wallet to proceed with payment."}
                </p>
                <ConnectButton />
                {isConnected && (
                  <Button onClick={handlePrepare} loading={isLoading} fullWidth>
                    {isLoading ? "Preparing..." : "Continue"}
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
            <Button onClick={handleQuote} loading={isLoading} fullWidth>
              {isLoading
                ? "Loading..."
                : method === "crypto"
                  ? "Get USDC Direct Quote"
                  : "Get Quote"}
            </Button>
          </div>
        )}

        {step === "approve_usdc" && (
          <div className="space-y-3">
            <p className="text-ink-secondary text-sm">
              Approve USDC Direct to spend{" "}
              <strong>
                {settlementAmountDisplay
                  ? formatMinor(settlementAmountDisplay)
                  : "the confirmed USDC amount"}
              </strong>{" "}
              on your behalf.
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
                This approval is limited to the rules-bound conditional settlement contract.
              </p>
            )}
            <Button
              onClick={() =>
                handleApproveUsdc(
                  (conditionalSettlement?.contract.address ??
                    process.env.NEXT_PUBLIC_SETTLEMENT_ROUTER_ADDRESS ??
                    "0x0") as `0x${string}`,
                  (conditionalSettlement?.contract.asset_address ??
                    process.env.NEXT_PUBLIC_USDC_ADDRESS ??
                    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") as `0x${string}`,
                )
              }
              disabled={isLoading || isWriting || !settlementAmountDisplay}
              loading={isLoading || isWriting}
              fullWidth
            >
              {isLoading || isWriting ? "Approving..." : "Approve USDC"}
            </Button>
          </div>
        )}

        {step === "sign_x402" && (
          <div className="space-y-3">
            <p className="text-ink-secondary text-sm">
              {conditionalSettlement
                ? "Fund the rules-limited USDC Direct settlement contract from your wallet."
                : "Sign the USDC Direct payment authorization to complete the transaction."}
            </p>
            <Button onClick={handleSubmitX402} loading={isLoading} fullWidth>
              {isLoading
                ? "Submitting..."
                : conditionalSettlement
                  ? "Fund Conditional Settlement"
                  : "Sign & Submit Payment"}
            </Button>
          </div>
        )}

        {step === "complete" && (
          <ResultState
            tone="success"
            icon={<CheckCircle2 className="size-7" />}
            title={conditionalSettlement ? "Funding submitted" : "Payment complete"}
            description={
              conditionalSettlement
                ? `Your ${formatMinor(settlementAmountDisplay ?? buyerPaysDisplay)} funding transaction was submitted. Release remains pending until the contract receipt and release conditions are confirmed.`
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

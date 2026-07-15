"use client";

import { formatMoney } from "@haggle/shared";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useState } from "react";
import type { Address, Hex } from "viem";
import { useAccount, useBalance, useWriteContract } from "wagmi";
import { api } from "@/lib/api-client";
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
  sessionId: string;
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

export function PaymentStep({ sessionId, amountMinor, currency }: PaymentStepProps) {
  const { address, isConnected } = useAccount();
  const { data: balance } = useBalance({ address });
  const { writeContract, isPending: isWriting } = useWriteContract();

  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [step, setStep] = useState<PaymentStepStatus>("select_method");
  const [error, setError] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
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
      const data = await api.post<{ intent?: { id?: string } }>("/payments/prepare", {
        settlement_approval_id: sessionId,
        payment_disclosure_ack: createPaymentDisclosureAck({ stripeFallback: method === "card" }),
      });
      const intentId = data.intent?.id;
      if (!intentId) {
        throw new Error("Payment intent was not returned");
      }
      setPaymentIntentId(intentId);
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
        // @ts-expect-error — @stripe/crypto loaded dynamically, types installed separately
        const { loadStripeOnramp } = (await import("@stripe/crypto")) as {
          loadStripeOnramp: (key: string) => Promise<{
            createSession: (opts: { clientSecret: string }) => {
              mount: (el: string) => void;
              addEventListener: (event: string, cb: (e: unknown) => void) => void;
            };
          } | null>;
        };
        const stripeOnramp = await loadStripeOnramp(data.stripe_publishable_key);
        if (stripeOnramp) {
          const session = stripeOnramp.createSession({ clientSecret: data.client_secret });
          session.mount("#stripe-onramp-element");
          session.addEventListener("onramp_session_updated", (e: unknown) => {
            const event = e as { payload?: { session?: { status?: string } } };
            if (event.payload?.session?.status === "fulfillment_complete") {
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

  const steps: { key: PaymentStepStatus; label: string }[] = [
    { key: "connect_wallet", label: "Connect Wallet" },
    { key: "check_balance", label: "Check USDC Balance" },
    { key: "approve_usdc", label: "Approve USDC" },
    { key: "sign_x402", label: "Sign USDC Direct" },
    { key: "submit", label: "Submit" },
    { key: "complete", label: "Complete" },
  ];

  const currentStepIndex = steps.findIndex((s) => s.key === step);

  return (
    <div className="rounded-lg border border-gray-200 p-6 space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Complete Payment</h2>
        <p className="text-sm text-gray-500">
          {quoteConfirmation && <span className="font-medium text-gray-700">{railLabel}: </span>}
          {formatMinor(buyerPaysDisplay)}
          {buyerFeeDisplay.amount_minor > 0 && (
            <span className="ml-2 text-xs text-gray-400">
              includes {formatMinor(buyerFeeDisplay)} buyer fee
            </span>
          )}
        </p>
      </div>

      {/* Payment method selection */}
      {step === "select_method" && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">Choose how to pay:</p>
          <button
            type="button"
            onClick={() => {
              setMethod("card");
              setStep("connect_wallet");
            }}
            className="w-full flex items-center gap-3 rounded-lg border border-gray-200 p-4 hover:border-blue-500 hover:bg-blue-50/50 transition-colors text-left"
          >
            <span className="text-2xl">💳</span>
            <div>
              <div className="font-medium">Pay with Card</div>
              <div className="text-xs text-gray-500">
                Credit/debit card via Stripe. Buyer fee is calculated before the onramp opens.
              </div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => {
              setMethod("crypto");
              setStep("connect_wallet");
            }}
            className="w-full flex items-center gap-3 rounded-lg border border-gray-200 p-4 hover:border-blue-500 hover:bg-blue-50/50 transition-colors text-left"
          >
            <span className="text-2xl">🔗</span>
            <div>
              <div className="font-medium">USDC Direct ({formatMinor(fallbackAmount)})</div>
              <div className="text-xs text-gray-500">
                Pay from your wallet with USDC on Base. Seller fee is shown in the quote. Gas paid
                by Haggle.
              </div>
              <div className="text-xs text-blue-600 mt-1">
                Don&apos;t have a wallet? Create one instantly with Coinbase &mdash; just your email
              </div>
            </div>
          </button>
        </div>
      )}

      {/* Stripe onramp widget container */}
      {step === "onramp_active" && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">Complete payment with your card:</p>
          <div id="stripe-onramp-element" className="min-h-[400px] rounded-lg border" />
        </div>
      )}

      {step === "onramp_loading" && (
        <div className="py-8 text-center text-gray-500">
          <div className="animate-spin inline-block w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full mb-2" />
          <p className="text-sm">Setting up card payment...</p>
        </div>
      )}

      {/* Step indicator */}
      <div className="flex items-center space-x-2 overflow-x-auto pb-2">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center">
            <div
              className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-medium shrink-0 ${
                i < currentStepIndex
                  ? "bg-green-500 text-white"
                  : i === currentStepIndex
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-400"
              }`}
            >
              {i < currentStepIndex ? "✓" : i + 1}
            </div>
            <span
              className={`ml-1 text-xs hidden sm:block ${
                i === currentStepIndex ? "text-blue-600 font-medium" : "text-gray-400"
              }`}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && <div className="mx-2 h-px w-4 bg-gray-200 shrink-0" />}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="space-y-4">
        {step === "connect_wallet" && (
          <div className="space-y-3">
            {method === "card" && !isConnected ? (
              <>
                <p className="text-sm text-gray-600">
                  Connect the wallet that should receive USDC after your card payment.
                </p>
                <ConnectButton />
                <p className="text-xs text-gray-400 text-center">
                  The connected wallet must be registered to your Haggle account.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-600">
                  {method === "crypto"
                    ? "Connect your wallet to pay with USDC."
                    : "Connect your wallet to proceed with payment."}
                </p>
                <ConnectButton />
                {isConnected && (
                  <button
                    type="button"
                    onClick={handlePrepare}
                    disabled={isLoading}
                    className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-blue-700 transition-colors"
                  >
                    {isLoading ? "Preparing..." : "Continue"}
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {step === "check_balance" && (
          <div className="space-y-3">
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Your address</span>
                <span className="font-mono text-xs">
                  {address?.slice(0, 6)}...{address?.slice(-4)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">ETH balance</span>
                <span>{balance ? `${Number(balance.formatted).toFixed(4)} ETH` : "—"}</span>
              </div>
              <div className="flex justify-between text-sm font-medium">
                <span className="text-gray-500">{buyerTotalLabel}</span>
                <span>{formatMinor(buyerPaysDisplay)}</span>
              </div>
              {method === "crypto" && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Rail</span>
                    <span>{railLabel}</span>
                  </div>
                  {quoteConfirmation && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">{sellerReceivesLabel}</span>
                      <span>{formatMinor(sellerReceivesDisplay)}</span>
                    </div>
                  )}
                </>
              )}
            </div>
            <button
              type="button"
              onClick={handleQuote}
              disabled={isLoading}
              className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-blue-700 transition-colors"
            >
              {isLoading
                ? "Loading..."
                : method === "crypto"
                  ? "Get USDC Direct Quote"
                  : "Get Quote"}
            </button>
          </div>
        )}

        {step === "approve_usdc" && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Approve USDC Direct to spend{" "}
              <strong>
                {settlementAmountDisplay
                  ? formatMinor(settlementAmountDisplay)
                  : "the confirmed USDC amount"}
              </strong>{" "}
              on your behalf.
            </p>
            {(buyerFeeDisplay.amount_minor > 0 || sellerFeeDisplay.amount_minor > 0) && (
              <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600 space-y-1">
                <div className="flex justify-between font-medium">
                  <span>Rail</span>
                  <span>{railLabel}</span>
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
                <p className="pt-1 text-gray-500">{feeSummaryLabel}</p>
              </div>
            )}
            {conditionalSettlement && (
              <p className="text-xs text-gray-500">
                This approval is limited to the rules-bound conditional settlement contract.
              </p>
            )}
            <button
              type="button"
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
              className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-blue-700 transition-colors"
            >
              {isLoading || isWriting ? "Approving..." : "Approve USDC"}
            </button>
          </div>
        )}

        {step === "sign_x402" && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              {conditionalSettlement
                ? "Fund the rules-limited USDC Direct settlement contract from your wallet."
                : "Sign the USDC Direct payment authorization to complete the transaction."}
            </p>
            <button
              type="button"
              onClick={handleSubmitX402}
              disabled={isLoading}
              className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-blue-700 transition-colors"
            >
              {isLoading
                ? "Submitting..."
                : conditionalSettlement
                  ? "Fund Conditional Settlement"
                  : "Sign & Submit Payment"}
            </button>
          </div>
        )}

        {step === "complete" && (
          <div className="text-center space-y-3 py-4">
            <div className="text-4xl">✓</div>
            <p className="text-green-600 font-semibold">
              {conditionalSettlement ? "Funding Submitted" : "Payment Complete!"}
            </p>
            <p className="text-sm text-gray-500">
              {conditionalSettlement
                ? `Your ${formatMinor(settlementAmountDisplay ?? buyerPaysDisplay)} funding transaction was submitted. Release remains pending until the contract receipt and release conditions are confirmed.`
                : `Your payment of ${formatMinor(buyerPaysDisplay)} has been submitted.`}
            </p>
          </div>
        )}

        {step === "error" && (
          <div className="space-y-3">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm text-red-600">{error}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStep(isConnected ? "check_balance" : "connect_wallet");
              }}
              className="w-full py-2 px-4 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

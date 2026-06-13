"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useState } from "react";
import { parseUnits } from "viem";
import { useAccount, useBalance, useWriteContract } from "wagmi";
import { api } from "@/lib/api-client";

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

export function PaymentStep({ sessionId, amountMinor, currency }: PaymentStepProps) {
  const { address, isConnected } = useAccount();
  const { data: balance } = useBalance({ address });
  const { writeContract, isPending: isWriting } = useWriteContract();

  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [step, setStep] = useState<PaymentStepStatus>("select_method");
  const [error, setError] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Amount in USDC (6 decimals)
  const amountUsdc = (amountMinor / 100).toFixed(2);

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
      await api.post(`/payments/${paymentIntentId}/quote`);
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
      const amount = parseUnits(amountUsdc, 6);
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
      }>(`/payments/${intentId}/onramp/session`, {
        destination_wallet: address,
      });
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
    { key: "sign_x402", label: "Sign Payment" },
    { key: "submit", label: "Submit" },
    { key: "complete", label: "Complete" },
  ];

  const currentStepIndex = steps.findIndex((s) => s.key === step);

  return (
    <div className="rounded-lg border border-line p-6 space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Complete Payment</h2>
        <p className="text-sm text-ink-muted">
          ${amountUsdc} {currency}
        </p>
      </div>

      {/* Payment method selection */}
      {step === "select_method" && (
        <div className="space-y-3">
          <p className="text-sm text-ink-secondary">Choose how to pay:</p>
          <button
            type="button"
            onClick={() => {
              setMethod("card");
              setStep("connect_wallet");
            }}
            className="w-full flex items-center gap-3 rounded-lg border border-line p-4 hover:border-focus hover:bg-surface-sunken transition-colors text-left"
          >
            <span className="text-2xl">💳</span>
            <div>
              <div className="font-medium">Pay with Card (${amountUsdc} + Stripe fee)</div>
              <div className="text-xs text-ink-muted">
                Credit/debit card via Stripe. 3% total fee. No wallet needed &mdash; Stripe handles
                everything.
              </div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => {
              setMethod("crypto");
              setStep("connect_wallet");
            }}
            className="w-full flex items-center gap-3 rounded-lg border border-line p-4 hover:border-focus hover:bg-surface-sunken transition-colors text-left"
          >
            <span className="text-2xl">🔗</span>
            <div>
              <div className="font-medium">Pay with USDC (${amountUsdc})</div>
              <div className="text-xs text-ink-muted">
                Direct USDC from your wallet on Base. 1.5% fee. Gas paid by Haggle.
              </div>
              <div className="text-xs text-action-primary mt-1">
                Don&apos;t have a wallet? Create one instantly with Coinbase &mdash; just your email
              </div>
            </div>
          </button>
        </div>
      )}

      {/* Stripe onramp widget container */}
      {step === "onramp_active" && (
        <div className="space-y-3">
          <p className="text-sm text-ink-secondary">Complete payment with your card:</p>
          <div id="stripe-onramp-element" className="min-h-[400px] rounded-lg border border-line" />
        </div>
      )}

      {step === "onramp_loading" && (
        <div className="py-8 text-center text-ink-muted">
          <div className="animate-spin inline-block w-6 h-6 border-2 border-line border-t-action-primary rounded-full mb-2" />
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
                  ? "bg-success-500 text-on-accent"
                  : i === currentStepIndex
                    ? "bg-action-primary text-on-accent"
                    : "bg-surface-sunken text-ink-muted"
              }`}
            >
              {i < currentStepIndex ? "✓" : i + 1}
            </div>
            <span
              className={`ml-1 text-xs hidden sm:block ${
                i === currentStepIndex ? "text-action-primary font-medium" : "text-ink-muted"
              }`}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && <div className="mx-2 h-px w-4 bg-line shrink-0" />}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="space-y-4">
        {step === "connect_wallet" && (
          <div className="space-y-3">
            {method === "card" && !isConnected ? (
              <>
                <p className="text-sm text-ink-secondary">
                  Connect the wallet that should receive USDC after your card payment.
                </p>
                <ConnectButton />
                <p className="text-xs text-ink-muted text-center">
                  The connected wallet must be registered to your Haggle account.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-ink-secondary">
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
                    className="w-full py-2 px-4 bg-action-primary text-on-accent rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-action-primary-hover transition-colors"
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
            <div className="bg-surface-sunken rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-ink-muted">Your address</span>
                <span className="font-mono text-xs">
                  {address?.slice(0, 6)}...{address?.slice(-4)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-ink-muted">ETH balance</span>
                <span>{balance ? `${Number(balance.formatted).toFixed(4)} ETH` : "—"}</span>
              </div>
              <div className="flex justify-between text-sm font-medium">
                <span className="text-ink-muted">Payment amount</span>
                <span>
                  {amountUsdc} {currency}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleQuote}
              disabled={isLoading}
              className="w-full py-2 px-4 bg-action-primary text-on-accent rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-action-primary-hover transition-colors"
            >
              {isLoading ? "Loading..." : "Get Quote"}
            </button>
          </div>
        )}

        {step === "approve_usdc" && (
          <div className="space-y-3">
            <p className="text-sm text-ink-secondary">
              Approve the payment contract to spend <strong>{amountUsdc} USDC</strong> on your
              behalf.
            </p>
            <button
              type="button"
              onClick={() =>
                handleApproveUsdc(
                  (process.env.NEXT_PUBLIC_SETTLEMENT_ROUTER_ADDRESS ?? "0x0") as `0x${string}`,
                  (process.env.NEXT_PUBLIC_USDC_ADDRESS ??
                    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") as `0x${string}`,
                )
              }
              disabled={isLoading || isWriting}
              className="w-full py-2 px-4 bg-action-primary text-on-accent rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-action-primary-hover transition-colors"
            >
              {isLoading || isWriting ? "Approving..." : "Approve USDC"}
            </button>
          </div>
        )}

        {step === "sign_x402" && (
          <div className="space-y-3">
            <p className="text-sm text-ink-secondary">
              Sign the x402 payment authorization to complete the transaction.
            </p>
            <button
              type="button"
              onClick={handleSubmitX402}
              disabled={isLoading}
              className="w-full py-2 px-4 bg-action-primary text-on-accent rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-action-primary-hover transition-colors"
            >
              {isLoading ? "Submitting..." : "Sign & Submit Payment"}
            </button>
          </div>
        )}

        {step === "complete" && (
          <div className="text-center space-y-3 py-4">
            <div className="text-4xl">✓</div>
            <p className="text-success font-semibold">Payment Complete!</p>
            <p className="text-sm text-ink-muted">
              Your payment of {amountUsdc} {currency} has been submitted.
            </p>
          </div>
        )}

        {step === "error" && (
          <div className="space-y-3">
            <div className="bg-error-soft border border-error/30 rounded-lg p-4">
              <p className="text-sm text-error">{error}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStep(isConnected ? "check_balance" : "connect_wallet");
              }}
              className="w-full py-2 px-4 bg-surface-sunken text-ink-secondary rounded-lg text-sm font-medium hover:bg-surface-overlay transition-colors"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

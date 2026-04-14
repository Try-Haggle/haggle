"use client";

import { useState } from "react";
import { useAccount, useBalance, useWriteContract } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { parseUnits } from "viem";

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
  const [onrampClientSecret, setOnrampClientSecret] = useState<string | null>(null);

  // Amount in USDC (6 decimals)
  const amountUsdc = (amountMinor / 100).toFixed(2);

  async function handlePrepare() {
    if (!isConnected || !address) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/payments/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to prepare payment");
      }
      const data = await res.json();
      setPaymentIntentId(data.intent?.id ?? null);
      // Route based on payment method
      if (method === "card") {
        setStep("onramp_loading");
        // Trigger onramp after setting paymentIntentId
        setTimeout(() => handleStripeOnramp(), 0);
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
      const res = await fetch(`/api/payments/${paymentIntentId}/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to get quote");
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

  async function handleStripeOnramp() {
    if (!paymentIntentId || !address) return;
    setIsLoading(true);
    setStep("onramp_loading");
    setError(null);
    try {
      const res = await fetch(`/api/payments/${paymentIntentId}/onramp/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination_wallet: address,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to create onramp session");
      }
      const data = await res.json();
      setOnrampClientSecret(data.client_secret);
      setStep("onramp_active");

      // Load Stripe onramp widget
      if (typeof window !== "undefined" && data.client_secret) {
        // @ts-expect-error — @stripe/crypto loaded dynamically, types installed separately
        const { loadStripeOnramp } = await import("@stripe/crypto") as { loadStripeOnramp: (key: string) => Promise<{ createSession: (opts: { clientSecret: string }) => { mount: (el: string) => void; addEventListener: (event: string, cb: (e: unknown) => void) => void } } | null> };
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
      const reqRes = await fetch(`/api/payments/${paymentIntentId}/x402/requirements`);
      if (!reqRes.ok) {
        const data = await reqRes.json();
        throw new Error(data.error ?? "Failed to get payment requirements");
      }
      const requirements = await reqRes.json();

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

      const submitRes = await fetch(`/api/payments/${paymentIntentId}/x402/submit-signature`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_payload: paymentPayload }),
      });

      if (!submitRes.ok) {
        const data = await submitRes.json();
        throw new Error(data.error ?? "Payment submission failed");
      }

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
    <div className="rounded-lg border border-gray-200 p-6 space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Complete Payment</h2>
        <p className="text-sm text-gray-500">
          ${amountUsdc} {currency}
        </p>
      </div>

      {/* Payment method selection */}
      {step === "select_method" && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">Choose how to pay:</p>
          <button
            onClick={() => { setMethod("card"); setStep("connect_wallet"); }}
            className="w-full flex items-center gap-3 rounded-lg border border-gray-200 p-4 hover:border-blue-500 hover:bg-blue-50/50 transition-colors text-left"
          >
            <span className="text-2xl">💳</span>
            <div>
              <div className="font-medium">Pay with Card</div>
              <div className="text-xs text-gray-500">Credit/debit card via Stripe → USDC on Base. 3% total fee.</div>
            </div>
          </button>
          <button
            onClick={() => { setMethod("crypto"); setStep("connect_wallet"); }}
            className="w-full flex items-center gap-3 rounded-lg border border-gray-200 p-4 hover:border-blue-500 hover:bg-blue-50/50 transition-colors text-left"
          >
            <span className="text-2xl">🔗</span>
            <div>
              <div className="font-medium">Pay with USDC</div>
              <div className="text-xs text-gray-500">Direct USDC from your wallet on Base. 1.5% fee.</div>
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
            <p className="text-sm text-gray-600">
              Connect your wallet to proceed with payment.
            </p>
            <ConnectButton />
            {isConnected && (
              <button
                onClick={handlePrepare}
                disabled={isLoading}
                className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-blue-700 transition-colors"
              >
                {isLoading ? "Preparing..." : "Continue"}
              </button>
            )}
          </div>
        )}

        {step === "check_balance" && (
          <div className="space-y-3">
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Your address</span>
                <span className="font-mono text-xs">{address?.slice(0, 6)}...{address?.slice(-4)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">ETH balance</span>
                <span>{balance ? `${Number(balance.formatted).toFixed(4)} ETH` : "—"}</span>
              </div>
              <div className="flex justify-between text-sm font-medium">
                <span className="text-gray-500">Payment amount</span>
                <span>{amountUsdc} {currency}</span>
              </div>
            </div>
            <button
              onClick={handleQuote}
              disabled={isLoading}
              className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-blue-700 transition-colors"
            >
              {isLoading ? "Loading..." : "Get Quote"}
            </button>
          </div>
        )}

        {step === "approve_usdc" && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Approve the payment contract to spend{" "}
              <strong>{amountUsdc} USDC</strong> on your behalf.
            </p>
            <button
              onClick={() =>
                handleApproveUsdc(
                  (process.env.NEXT_PUBLIC_SETTLEMENT_ROUTER_ADDRESS ?? "0x0") as `0x${string}`,
                  (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") as `0x${string}`,
                )
              }
              disabled={isLoading || isWriting}
              className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-blue-700 transition-colors"
            >
              {isLoading || isWriting ? "Approving..." : "Approve USDC"}
            </button>
          </div>
        )}

        {step === "sign_x402" && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Sign the x402 payment authorization to complete the transaction.
            </p>
            <button
              onClick={handleSubmitX402}
              disabled={isLoading}
              className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-blue-700 transition-colors"
            >
              {isLoading ? "Submitting..." : "Sign & Submit Payment"}
            </button>
          </div>
        )}

        {step === "complete" && (
          <div className="text-center space-y-3 py-4">
            <div className="text-4xl">✓</div>
            <p className="text-green-600 font-semibold">Payment Complete!</p>
            <p className="text-sm text-gray-500">
              Your payment of {amountUsdc} {currency} has been submitted.
            </p>
          </div>
        )}

        {step === "error" && (
          <div className="space-y-3">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm text-red-600">{error}</p>
            </div>
            <button
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

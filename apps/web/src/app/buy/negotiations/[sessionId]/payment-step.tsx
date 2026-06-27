"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useState } from "react";
import { parseUnits } from "viem";
import { useAccount, useBalance, useWriteContract } from "wagmi";
import {
  Alert,
  Button,
  ResultState,
  SelectableOptionCard,
  Spinner,
  Stepper,
} from "@/components/ui";
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
          <SelectableOptionCard
            icon={<span className="text-2xl">💳</span>}
            title={`Pay with Card ($${amountUsdc} + Stripe fee)`}
            description="Credit/debit card via Stripe. 3% total fee. No wallet needed — Stripe handles everything."
            onClick={() => {
              setMethod("card");
              setStep("connect_wallet");
            }}
          />
          <SelectableOptionCard
            icon={<span className="text-2xl">🔗</span>}
            title={`Pay with USDC ($${amountUsdc})`}
            description={
              <>
                Direct USDC from your wallet on Base. 1.5% fee. Gas paid by Haggle.
                <span className="mt-1 block text-action-primary">
                  Don&apos;t have a wallet? Create one instantly with Coinbase — just your email
                </span>
              </>
            }
            onClick={() => {
              setMethod("crypto");
              setStep("connect_wallet");
            }}
          />
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
          <Spinner className="mb-2 text-action-primary" />
          <p className="text-sm">Setting up card payment...</p>
        </div>
      )}

      {/* Step indicator */}
      <Stepper
        steps={steps.map((s) => s.label)}
        current={currentStepIndex}
        className="overflow-x-auto pb-2"
      />

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
                  <Button fullWidth loading={isLoading} onClick={handlePrepare}>
                    {isLoading ? "Preparing..." : "Continue"}
                  </Button>
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
            <Button fullWidth loading={isLoading} onClick={handleQuote}>
              {isLoading ? "Loading..." : "Get Quote"}
            </Button>
          </div>
        )}

        {step === "approve_usdc" && (
          <div className="space-y-3">
            <p className="text-sm text-ink-secondary">
              Approve the payment contract to spend <strong>{amountUsdc} USDC</strong> on your
              behalf.
            </p>
            <Button
              fullWidth
              loading={isLoading || isWriting}
              onClick={() =>
                handleApproveUsdc(
                  (process.env.NEXT_PUBLIC_SETTLEMENT_ROUTER_ADDRESS ?? "0x0") as `0x${string}`,
                  (process.env.NEXT_PUBLIC_USDC_ADDRESS ??
                    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") as `0x${string}`,
                )
              }
            >
              {isLoading || isWriting ? "Approving..." : "Approve USDC"}
            </Button>
          </div>
        )}

        {step === "sign_x402" && (
          <div className="space-y-3">
            <p className="text-sm text-ink-secondary">
              Sign the x402 payment authorization to complete the transaction.
            </p>
            <Button fullWidth loading={isLoading} onClick={handleSubmitX402}>
              {isLoading ? "Submitting..." : "Sign & Submit Payment"}
            </Button>
          </div>
        )}

        {step === "complete" && (
          <ResultState
            tone="success"
            title="Payment Complete!"
            description={`Your payment of ${amountUsdc} ${currency} has been submitted.`}
          />
        )}

        {step === "error" && (
          <div className="space-y-3">
            <Alert tone="error">{error}</Alert>
            <Button
              variant="secondary"
              fullWidth
              onClick={() => {
                setError(null);
                setStep(isConnected ? "check_balance" : "connect_wallet");
              }}
            >
              Try Again
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

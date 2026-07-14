"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Alert, BackLink, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api-client";

const REASON_CODES = [
  { value: "ITEM_NOT_RECEIVED", label: "Item Not Received" },
  { value: "ITEM_NOT_AS_DESCRIBED", label: "Item Not As Described" },
  { value: "ITEM_DAMAGED", label: "Item Damaged" },
  { value: "UNAUTHORIZED_TRANSACTION", label: "Unauthorized Transaction" },
  { value: "DUPLICATE_CHARGE", label: "Duplicate Charge" },
  { value: "OTHER", label: "Other" },
] as const;

function NewDisputeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [orderId, setOrderId] = useState(searchParams.get("orderId") ?? "");
  const [reasonCode, setReasonCode] = useState<string>(REASON_CODES[0].value);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const oid = searchParams.get("orderId");
    if (oid) setOrderId(oid);
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!orderId.trim()) {
      setError("Order ID is required");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const result = await api.post<{ dispute: { id: string } }>("/disputes", {
        order_id: orderId.trim(),
        reason_code: reasonCode,
        opened_by: "buyer",
        evidence: description.trim()
          ? [
              {
                submitted_by: "buyer",
                type: "text",
                text: description.trim(),
              },
            ]
          : [],
      });
      router.push(`/disputes/${result.dispute.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open dispute");
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:p-6 max-w-xl mx-auto">
      <BackLink href="/buy/dashboard" className="mb-6">
        Dashboard
      </BackLink>

      <div className="mb-6">
        <h1 className="text-xl font-bold text-ink mb-1">Report an Issue</h1>
        <p className="text-sm text-ink-secondary">Open a dispute for a completed order</p>
      </div>

      <div className="rounded-xl border border-line bg-surface-raised/50 overflow-hidden">
        <form onSubmit={handleSubmit} className="p-5">
          <Field label="Order ID" required htmlFor="dispute-order-id">
            <Input
              id="dispute-order-id"
              type="text"
              placeholder="e.g. order_abc123"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              required
            />
          </Field>

          <Field label="Reason" required htmlFor="dispute-reason">
            <Select
              id="dispute-reason"
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
            >
              {REASON_CODES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Description" htmlFor="dispute-description">
            <Textarea
              id="dispute-description"
              rows={4}
              placeholder="Describe what happened in detail..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="resize-none"
            />
          </Field>

          {error && (
            <Alert tone="error" className="mb-4">
              {error}
            </Alert>
          )}

          <Button type="submit" fullWidth loading={submitting} disabled={!orderId.trim()}>
            {submitting ? "Opening dispute..." : "Open Dispute"}
          </Button>
        </form>
      </div>

      <p className="text-xs text-ink-muted text-center mt-4">
        Disputes are reviewed within 3–5 business days.
      </p>
    </main>
  );
}

export default function NewDisputePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-ink-secondary text-sm">
          Loading...
        </div>
      }
    >
      <NewDisputeForm />
    </Suspense>
  );
}

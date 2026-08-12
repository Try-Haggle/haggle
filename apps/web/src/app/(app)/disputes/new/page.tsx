"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Alert, BackLink, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api-client";
import { clearSessionDraft, readSessionDraft, writeSessionDraft } from "@/lib/session-draft";

interface EligibilityReason {
  code: string;
  label: string;
  eligible: boolean;
  error?: string;
  message: string;
  available_at?: string;
}

interface DisputeEligibility {
  order_id: string;
  order_status: string;
  opened_by: "buyer" | "seller";
  shipment_status: string | null;
  reasons: EligibilityReason[];
}

interface NewDisputeDraft {
  reasonCode: string;
  description: string;
}

function isNewDisputeDraft(value: unknown): value is NewDisputeDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<NewDisputeDraft>;
  return typeof draft.reasonCode === "string" && typeof draft.description === "string";
}

function NewDisputeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [orderId, setOrderId] = useState(searchParams.get("orderId") ?? "");
  const [reasonCode, setReasonCode] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [eligibility, setEligibility] = useState<DisputeEligibility | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const sourceOrderId = searchParams.get("orderId")?.trim() ?? "";
  const draftKey = `haggle:new-dispute-draft:${sourceOrderId || "new"}`;

  useEffect(() => {
    const draft = readSessionDraft(draftKey, isNewDisputeDraft);
    if (draft) {
      setReasonCode(draft.reasonCode);
      setDescription(draft.description);
    }
    setDraftReady(true);
  }, [draftKey]);

  useEffect(() => {
    if (!draftReady) return;
    if (!reasonCode && !description) {
      clearSessionDraft(draftKey);
      return;
    }
    writeSessionDraft(draftKey, { reasonCode, description } satisfies NewDisputeDraft);
  }, [description, draftKey, draftReady, reasonCode]);

  useEffect(() => {
    const oid = searchParams.get("orderId");
    if (oid) setOrderId(oid);
  }, [searchParams]);

  useEffect(() => {
    const normalizedOrderId = orderId.trim();
    if (!normalizedOrderId) {
      setEligibility(null);
      setReasonCode("");
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setChecking(true);
      setError(null);
      try {
        const result = await api.get<DisputeEligibility>(
          `/orders/${encodeURIComponent(normalizedOrderId)}/dispute-eligibility`,
          { signal: controller.signal },
        );
        setEligibility(result);
        setReasonCode((current) => {
          if (result.reasons.some((reason) => reason.code === current && reason.eligible)) {
            return current;
          }
          return result.reasons.find((reason) => reason.eligible)?.code ?? "";
        });
      } catch (err) {
        if (!controller.signal.aborted) {
          setEligibility(null);
          setReasonCode("");
          setError(err instanceof Error ? err.message : "Failed to check dispute eligibility");
        }
      } finally {
        if (!controller.signal.aborted) setChecking(false);
      }
    }, 300);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [orderId]);

  const selectedReason = eligibility?.reasons.find((reason) => reason.code === reasonCode) ?? null;
  const eligibleReasons = eligibility?.reasons.filter((reason) => reason.eligible) ?? [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!orderId.trim()) {
      setError("Order ID is required");
      return;
    }
    if (!selectedReason?.eligible) {
      setError("Select an issue that is currently available for this order");
      return;
    }
    if (!description.trim()) {
      setError("Describe what happened before opening the dispute");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const result = await api.post<{ dispute: { id: string } }>(
        `/orders/${encodeURIComponent(orderId.trim())}/disputes`,
        {
          reason_code: reasonCode,
          summary: description.trim(),
          client_request_id: crypto.randomUUID(),
        },
      );
      clearSessionDraft(draftKey);
      router.push(`/disputes/${result.dispute.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open dispute");
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:p-6 max-w-xl mx-auto">
      <BackLink
        href={orderId.trim() ? `/orders/${encodeURIComponent(orderId.trim())}` : "/orders"}
        className="mb-6"
      >
        {orderId.trim() ? "Back to order" : "All orders"}
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
              disabled={checking || eligibleReasons.length === 0}
            >
              {checking && <option value="">Checking order status...</option>}
              {!checking && eligibleReasons.length === 0 && (
                <option value="">No issues are available yet</option>
              )}
              {eligibility?.reasons.map((reason) => (
                <option key={reason.code} value={reason.code} disabled={!reason.eligible}>
                  {reason.label}
                  {reason.eligible ? "" : " — not available yet"}
                </option>
              ))}
            </Select>
          </Field>

          {eligibility && (
            <Alert tone={eligibleReasons.length > 0 ? "info" : "neutral"} className="mb-4">
              <p>
                Order: {eligibility.order_status}
                {eligibility.shipment_status
                  ? ` · Shipping: ${eligibility.shipment_status.replace(/_/g, " ")}`
                  : ""}
              </p>
              {selectedReason ? (
                <p className="mt-1">{selectedReason.message}</p>
              ) : (
                <div className="mt-2 space-y-1">
                  {eligibility.reasons
                    .filter((reason) => !reason.eligible)
                    .slice(0, 3)
                    .map((reason) => (
                      <p key={reason.code}>
                        {reason.label}: {reason.message}
                        {reason.available_at
                          ? ` Available after ${new Date(reason.available_at).toLocaleString()}.`
                          : ""}
                      </p>
                    ))}
                </div>
              )}
            </Alert>
          )}

          <Field label="Description" required htmlFor="dispute-description">
            <Textarea
              id="dispute-description"
              rows={4}
              placeholder="Describe what happened in detail..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="resize-none"
              required
            />
          </Field>

          {error && (
            <Alert tone="error" className="mb-4">
              {error}
            </Alert>
          )}

          <Button
            type="submit"
            fullWidth
            loading={submitting}
            disabled={
              !orderId.trim() || !description.trim() || !selectedReason?.eligible || checking
            }
          >
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

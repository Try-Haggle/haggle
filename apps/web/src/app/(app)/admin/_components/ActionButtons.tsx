"use client";

import { useState } from "react";
import { adminApi, type AdminInboxDetail } from "@/lib/admin-api";
import { MergeDialog } from "./MergeDialog";

interface Props {
  detail: AdminInboxDetail;
  /**
   * Called after a successful mutation. `removedId` is the id of the
   * inbox row to remove/refresh in the parent list.
   */
  onDone: (removedId: string) => void;
}

const BTN_BASE =
  "rounded border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const BTN_PRIMARY =
  BTN_BASE + " border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800";
const BTN_DANGER =
  BTN_BASE + " border-red-300 bg-white text-red-700 hover:bg-red-50";
const BTN_NEUTRAL =
  BTN_BASE + " border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50";

export function ActionButtons({ detail, onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);

  async function run(fn: () => Promise<unknown>, removedId: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone(removedId);
    } catch (e) {
      // Rollback: do NOT call onDone so the row stays visible.
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-2">
      {detail.type === "tag" && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            data-testid="action-tag-approve"
            className={BTN_PRIMARY}
            onClick={() =>
              run(
                () =>
                  adminApi.actions.tagApprove({
                    suggestionId: detail.item.id,
                  }),
                detail.item.id,
              )
            }
          >
            Approve
          </button>
          <button
            type="button"
            disabled={busy}
            data-testid="action-tag-reject"
            className={BTN_DANGER}
            onClick={() =>
              run(
                () =>
                  adminApi.actions.tagReject({ suggestionId: detail.item.id }),
                detail.item.id,
              )
            }
          >
            Reject
          </button>
          <button
            type="button"
            disabled={busy}
            data-testid="action-tag-merge"
            className={BTN_NEUTRAL}
            onClick={() => setMergeOpen(true)}
          >
            Merge…
          </button>

          <MergeDialog
            open={mergeOpen}
            onClose={() => setMergeOpen(false)}
            onSubmit={async (targetTagId) => {
              await adminApi.actions.tagMerge({
                suggestionId: detail.item.id,
                targetTagId,
              });
              onDone(detail.item.id);
            }}
          />
        </div>
      )}

      {detail.type === "dispute" && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            data-testid="action-dispute-escalate"
            className={BTN_NEUTRAL}
            onClick={() =>
              run(
                () =>
                  adminApi.actions.disputeEscalate({
                    disputeId: detail.item.id,
                    // TODO(step59-followup): replace hardcoded toTier=2 with
                    // a tier picker once dispute tier UX is designed.
                    toTier: 2,
                  }),
                detail.item.id,
              )
            }
          >
            Escalate to Tier 2
          </button>
          <button
            type="button"
            disabled={busy}
            data-testid="action-dispute-resolve-buyer"
            className={BTN_PRIMARY}
            onClick={() =>
              run(
                () =>
                  adminApi.actions.disputeResolve({
                    disputeId: detail.item.id,
                    outcome: "buyer_favor",
                  }),
                detail.item.id,
              )
            }
          >
            Resolve — Buyer
          </button>
          <button
            type="button"
            disabled={busy}
            data-testid="action-dispute-resolve-seller"
            className={BTN_NEUTRAL}
            onClick={() =>
              run(
                () =>
                  adminApi.actions.disputeResolve({
                    disputeId: detail.item.id,
                    outcome: "seller_favor",
                  }),
                detail.item.id,
              )
            }
          >
            Resolve — Seller
          </button>
        </div>
      )}

      {detail.type === "payment" && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            data-testid="action-payment-mark-review"
            className={BTN_PRIMARY}
            onClick={() =>
              run(
                () =>
                  adminApi.actions.paymentMarkReview({
                    paymentIntentId: detail.item.id,
                    note: "Flagged for manual review by admin",
                  }),
                detail.item.id,
              )
            }
          >
            Mark for Review
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          data-testid="action-error"
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {error}
        </div>
      )}
    </div>
  );
}

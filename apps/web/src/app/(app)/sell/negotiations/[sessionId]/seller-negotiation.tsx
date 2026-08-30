"use client";

import { useCallback, useMemo, useState } from "react";
import {
  isTerminalNegotiationStatus,
  type SessionResponse,
  transformNegotiationPlayback,
} from "@/app/buy/negotiations/[sessionId]/negotiation-session-data";
import { PlaybackArena } from "@/app/buy/negotiations/[sessionId]/playback/playback-arena";
import { OpenConversationButton } from "@/components/messaging/open-conversation-button";
import { Alert, Button, Input } from "@/components/ui";
import { useNegotiationWs } from "@/hooks/use-negotiation-ws";
import { api } from "@/lib/api-client";

/**
 * Statuses where the seller has nothing left to do.
 *
 * Deliberately narrower than the buyer's terminal set: the buyer's round loop
 * stops at NEAR_DEAL and STALLED, but the seller can still close or counter
 * there — which is exactly what the seller console did before this screen
 * replaced it. Reusing the buyer's definition here would quietly take away the
 * seller's ability to accept a near-deal.
 */
const SELLER_CLOSED_STATUSES = new Set(["ACCEPTED", "REJECTED", "EXPIRED", "SUPERSEDED"]);

/**
 * Seller view of a negotiation.
 *
 * Same arena the buyer sees — one negotiation should not look like two
 * different products depending on which side you are on. What differs is the
 * controls: the buyer's side drives the agent loop, the seller's side responds
 * to it.
 */
export function SellerNegotiation({ initialPayload }: { initialPayload: SessionResponse }) {
  const [payload, setPayload] = useState(initialPayload);
  const sessionId = payload.session.id;
  // Two different questions: has the transcript stopped moving (presentation),
  // and can this seller still act (controls).
  const isSettled = isTerminalNegotiationStatus(payload.session.status);
  const sellerCanAct = !SELLER_CLOSED_STATUSES.has(payload.session.status);

  const reload = useCallback(async () => {
    try {
      const next = await api.get<SessionResponse>(`/negotiations/sessions/${sessionId}`);
      setPayload(next);
    } catch {
      // A failed refresh leaves the last good state on screen.
    }
  }, [sessionId]);

  const { connectionMode } = useNegotiationWs({
    sessionId,
    onUpdate: reload,
    // Keep updates flowing while the seller can still act, even if the buyer's
    // loop has stopped.
    isTerminal: !sellerCanAct,
  });

  const data = useMemo(() => transformNegotiationPlayback(payload), [payload]);

  return (
    <>
      <PlaybackArena
        data={data}
        mode="live"
        liveTerminal={isSettled}
        connectionLabel={connectionMode === "ws" ? "Live updates" : "Checking for updates"}
        backHref="/sell/dashboard"
        backLabel="Dashboard"
        headerAction={
          // Same rule as the buyer's side: the thread opens once the rounds
          // have stopped, not while the agents are mid-negotiation.
          isSettled ? (
            <OpenConversationButton
              sessionId={sessionId}
              label="Message buyer"
              className="animate-rise-in"
            />
          ) : undefined
        }
        noDealCta={{ href: "/sell/dashboard", label: "Back to dashboard" }}
      />
      {sellerCanAct && <SellerActionBar sessionId={sessionId} onDone={reload} />}
    </>
  );
}

/**
 * The seller's three moves. Pinned to the bottom of the viewport because the
 * arena is a full screen tall — controls parked under it would never be seen.
 */
function SellerActionBar({ sessionId, onDone }: { sessionId: string; onDone: () => void }) {
  const [offer, setOffer] = useState("");
  const [busy, setBusy] = useState<"offer" | "accept" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "offer" | "accept" | "reject") {
    setError(null);

    if (kind === "offer") {
      const priceUsd = Number.parseFloat(offer);
      if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
        setError("Enter a valid price.");
        return;
      }
      setBusy("offer");
      try {
        await api.post(`/negotiations/sessions/${sessionId}/offers`, {
          price_minor: Math.round(priceUsd * 100),
          sender_role: "SELLER",
          idempotency_key: `manual_${sessionId}_${Date.now()}`,
        });
        setOffer("");
        onDone();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not send the offer.");
      } finally {
        setBusy(null);
      }
      return;
    }

    setBusy(kind);
    try {
      await api.patch(`/negotiations/sessions/${sessionId}/${kind}`);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${kind} — try again in a moment.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="sticky bottom-16 z-30 border-line border-t bg-surface/95 backdrop-blur md:bottom-0">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-3 py-3 sm:px-6">
        {error && (
          <Alert tone="error" className="text-sm">
            {error}
          </Alert>
        )}
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run("offer");
          }}
        >
          <Input
            value={offer}
            onChange={(e) => setOffer(e.target.value)}
            inputMode="decimal"
            placeholder="Your counter price"
            aria-label="Counter price"
            className="min-w-40 flex-1"
          />
          <Button type="submit" disabled={busy !== null || offer.trim() === ""}>
            {busy === "offer" ? "Sending…" : "Send counter"}
          </Button>
          <Button
            type="button"
            variant="success"
            disabled={busy !== null}
            onClick={() => run("accept")}
          >
            {busy === "accept" ? "Accepting…" : "Accept deal"}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy !== null}
            onClick={() => run("reject")}
          >
            {busy === "reject" ? "Rejecting…" : "Reject"}
          </Button>
        </form>
      </div>
    </div>
  );
}

"use client";

/**
 * Post-signup landing for buyer guest sessions.
 *
 * The result page CTA redirects here after sign-up. We pick up the guest
 * buyer UUIDs that buyer-landing stashed in localStorage and POST them to
 * /claim/negotiation-sessions so the new user owns the sessions.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api-client";

const STORAGE_KEY = "haggle:guest-buyer-ids";

type State =
  | { kind: "idle" }
  | { kind: "claiming" }
  | { kind: "done"; count: number; redirect: string }
  | { kind: "error"; message: string };

export default function ClaimBuyerPage() {
  const router = useRouter();
  const search = useSearchParams();
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    if (state.kind !== "idle") return;
    setState({ kind: "claiming" });

    const sessionId = search?.get("session_id") ?? null;
    const redirectTo = sessionId ? `/buy/negotiations/${sessionId}` : "/buy/dashboard";

    let guestIds: string[] = [];
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      guestIds = raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      guestIds = [];
    }

    if (guestIds.length === 0) {
      setState({ kind: "done", count: 0, redirect: redirectTo });
      return;
    }

    api
      .post<{ ok: boolean; claimed_count: number }>("/claim/negotiation-sessions", {
        guest_buyer_ids: guestIds,
      })
      .then((res) => {
        try {
          window.localStorage.removeItem(STORAGE_KEY);
        } catch {
          // ignore
        }
        setState({
          kind: "done",
          count: res.claimed_count ?? 0,
          redirect: redirectTo,
        });
      })
      .catch((err) => {
        const apiErr = err instanceof ApiError ? err : null;
        setState({
          kind: "error",
          message:
            apiErr?.message ?? apiErr?.code ?? "Couldn't link your guest sessions. Try refreshing.",
        });
      });
  }, [state.kind, search]);

  useEffect(() => {
    if (state.kind !== "done") return;
    const t = window.setTimeout(() => router.replace(state.redirect), 800);
    return () => window.clearTimeout(t);
  }, [state, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg-primary px-4">
      <div className="w-full max-w-md rounded-2xl border border-border-default bg-bg-card p-6 text-center">
        {state.kind === "claiming" && (
          <>
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-slate-600 border-t-cyan-500" />
            <p className="text-sm text-slate-300">
              Linking your guest negotiations to your new account…
            </p>
          </>
        )}
        {state.kind === "done" && (
          <>
            <p className="mb-2 text-base font-semibold text-emerald-400">✓ Account linked</p>
            <p className="text-sm text-slate-400">
              {state.count > 0
                ? `Claimed ${state.count} guest session${state.count === 1 ? "" : "s"}. Redirecting…`
                : "Nothing to claim. Redirecting…"}
            </p>
          </>
        )}
        {state.kind === "error" && (
          <>
            <p className="mb-2 text-base font-semibold text-rose-400">Couldn't finish linking</p>
            <p className="mb-4 text-sm text-slate-400">{state.message}</p>
            <button
              type="button"
              onClick={() => setState({ kind: "idle" })}
              className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-600"
            >
              Try again
            </button>
          </>
        )}
      </div>
    </main>
  );
}

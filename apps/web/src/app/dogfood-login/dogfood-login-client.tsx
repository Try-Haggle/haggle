"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, SelectableOptionCard } from "@/components/ui";
import type { DogfoodPersona } from "@/lib/dogfood-auth-gate";
import { T1_API_NOT_LIVE_MESSAGE } from "@/lib/dogfood-auth-session";
import { createClient } from "@/lib/supabase/client";

type PersonaChoice = DogfoodPersona | null;

export function DogfoodLoginClient() {
  const router = useRouter();
  const [persona, setPersona] = useState<PersonaChoice>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEnter() {
    if (!persona || loading) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/dogfood-auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona }),
      });

      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        access_token?: string;
        refresh_token?: string;
      };

      if (!res.ok || !body.ok) {
        if (body.error === "T1_API_NOT_LIVE" || res.status === 503) {
          setError(body.message || T1_API_NOT_LIVE_MESSAGE);
        } else if (res.status === 404) {
          setError("Dogfood login is not available in this environment.");
        } else {
          setError(body.message || body.error || "Could not mint dogfood session.");
        }
        setLoading(false);
        return;
      }

      if (!body.access_token || !body.refresh_token) {
        // Never invent tokens client-side either.
        setError(T1_API_NOT_LIVE_MESSAGE);
        setLoading(false);
        return;
      }

      const supabase = createClient();
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: body.access_token,
        refresh_token: body.refresh_token,
      });

      if (sessionError) {
        setError(sessionError.message || "Failed to apply dogfood session.");
        setLoading(false);
        return;
      }

      const next = persona === "seller" ? "/sell/dashboard" : "/buy/dashboard";
      router.replace(next);
      router.refresh();
    } catch {
      setError("Something went wrong minting the dogfood session.");
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            Staging / local only
          </p>
          <h1 className="text-h2 text-ink">Dogfood login</h1>
          <p className="text-sm text-ink-secondary">
            Pick a fixed persona to exercise buyer ≠ seller on staging. No real money, no PAN.
          </p>
        </div>

        <div className="space-y-3">
          <SelectableOptionCard
            data-testid="dogfood-persona-buyer"
            selected={persona === "buyer"}
            title="Buyer"
            description="Start negotiation / checkout (dogfood_buyer)"
            onClick={() => setPersona("buyer")}
          />
          <SelectableOptionCard
            data-testid="dogfood-persona-seller"
            selected={persona === "seller"}
            title="Seller"
            description="Create / own listing (dogfood_seller)"
            onClick={() => setPersona("seller")}
          />
        </div>

        {error && (
          <Alert tone="error" data-testid="dogfood-login-error">
            {error}
          </Alert>
        )}

        <Button
          data-testid="dogfood-login-enter"
          fullWidth
          loading={loading}
          disabled={!persona}
          onClick={handleEnter}
        >
          {loading ? "Minting session…" : "Enter app"}
        </Button>

        <p className="text-center text-xs text-ink-muted">
          Prefer the server BFF so the browser never holds the dogfood secret.{" "}
          <Link href="/sign-in" className="underline hover:text-ink-secondary">
            Normal sign-in
          </Link>
        </p>
      </div>
    </main>
  );
}

"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api-client";
import { createClient } from "@/lib/supabase/client";

const ALLOWED_SCOPES = new Set([
  "agents",
  "listings",
  "negotiate",
  "orders",
  "disputes",
  "offline_access",
]);

const SCOPE_LABELS: Record<string, string> = {
  agents: "Build and update your negotiation agents",
  listings: "Create and publish listings as you",
  negotiate: "Start and play negotiations as you",
  orders: "Read orders, shipments, and checkout URLs",
  disputes: "Open disputes on your orders",
  offline_access: "Stay connected after you close the chat",
};

type PublicOauthClient = {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
};

export default function ConnectPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center p-4">
          <div className="text-ink-muted">Loading...</div>
        </main>
      }
    >
      <ConnectForm />
    </Suspense>
  );
}

function ConnectForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [isConsenting, setIsConsenting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [client, setClient] = useState<PublicOauthClient | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  const request = useMemo(() => {
    const clientId = searchParams.get("client_id") ?? "";
    const redirectUri = searchParams.get("redirect_uri") ?? "";
    const codeChallenge = searchParams.get("code_challenge") ?? "";
    const codeChallengeMethod = searchParams.get("code_challenge_method") ?? "S256";
    const state = searchParams.get("state") ?? undefined;
    const scope = (searchParams.get("scope") ?? "agents listings negotiate orders disputes")
      .split(/[\s+,]+/)
      .filter((item) => ALLOWED_SCOPES.has(item));
    return { clientId, redirectUri, codeChallenge, codeChallengeMethod, state, scope };
  }, [searchParams]);

  const connectPath = `/connect?${searchParams.toString()}`;
  const redirectAllowed = Boolean(
    client && request.redirectUri && client.redirect_uris.includes(request.redirectUri),
  );

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setSignedIn(Boolean(user));
      setCheckingAuth(false);
    });
  }, [supabase.auth]);

  useEffect(() => {
    if (!request.clientId) {
      setClient(null);
      setClientError("This connect link is missing a client id.");
      return;
    }
    let cancelled = false;
    setClientError(null);
    api
      .get<PublicOauthClient>(`/oauth/clients/${encodeURIComponent(request.clientId)}`, {
        skipAuth: true,
      })
      .then((data) => {
        if (!cancelled) setClient(data);
      })
      .catch(() => {
        if (!cancelled) {
          setClient(null);
          setClientError("Unknown or unregistered client.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [request.clientId]);

  async function handleConsent() {
    if (!request.clientId || !request.redirectUri || !request.codeChallenge) {
      setError("This connect link is missing OAuth parameters.");
      return;
    }
    if (!client || !redirectAllowed) {
      setError("This client is not allowed to use that redirect URL.");
      return;
    }
    if (request.scope.length === 0) {
      setError("This connect link did not request any valid permissions.");
      return;
    }
    if (request.codeChallengeMethod !== "S256") {
      setError("Only PKCE S256 is supported.");
      return;
    }
    setIsConsenting(true);
    setError(null);
    try {
      const result = await api.post<{ redirect_to: string }>("/oauth/consent", {
        client_id: request.clientId,
        redirect_uri: request.redirectUri,
        code_challenge: request.codeChallenge,
        code_challenge_method: "S256",
        scope: request.scope.join(" "),
        state: request.state,
      });
      window.location.assign(result.redirect_to);
    } catch (err) {
      setIsConsenting(false);
      setError(err instanceof ApiError ? err.code : "Could not complete the connection.");
    }
  }

  if (checkingAuth) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="text-ink-muted">Loading...</div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-h2 text-ink">Connect Haggle</h1>
          <p className="text-ink-secondary">
            Grok Bot and other agents use this page like a bank connection. Sign in or create an
            account, then allow them to negotiate, list, and read orders as you.
          </p>
        </div>

        {error || clientError ? (
          <p className="text-center text-sm text-red-400">{error ?? clientError}</p>
        ) : null}

        {!signedIn ? (
          <div className="space-y-3">
            <Button
              className="w-full"
              onClick={() => router.push(`/sign-in?next=${encodeURIComponent(connectPath)}`)}
            >
              Sign in
            </Button>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => router.push(`/sign-up?next=${encodeURIComponent(connectPath)}`)}
            >
              Create a Haggle account
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-line p-4 text-sm text-ink-secondary">
              <p className="mb-1 font-medium text-ink">{client?.client_name ?? "MCP client"}</p>
              <p className="mb-3 break-all text-xs text-ink-muted">
                After you allow, the code goes to {request.redirectUri || "(missing redirect)"}
              </p>
              <p className="mb-2 font-medium text-ink">This client is asking to:</p>
              <ul className="list-disc space-y-1 pl-5">
                {request.scope.map((scope) => (
                  <li key={scope}>{SCOPE_LABELS[scope] ?? scope}</li>
                ))}
                <li>Never move money or sign a wallet</li>
              </ul>
              {!redirectAllowed && client ? (
                <p className="mt-3 text-sm text-red-400">
                  This redirect URL is not registered for the client.
                </p>
              ) : null}
            </div>
            <Button
              className="w-full"
              disabled={isConsenting || !redirectAllowed || request.scope.length === 0}
              onClick={() => void handleConsent()}
            >
              {isConsenting ? "Connecting..." : "Allow access"}
            </Button>
            <p className="text-center text-xs text-ink-muted">
              You can keep watching the live chat on the web while the agent plays.
            </p>
          </div>
        )}

        <p className="text-center text-xs text-ink-muted">
          <Link href="/buy/dashboard" className="underline">
            Back to Haggle
          </Link>
        </p>
      </div>
    </main>
  );
}

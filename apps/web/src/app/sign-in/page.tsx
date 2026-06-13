"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center p-4">
          <div className="text-ink-muted">Loading...</div>
        </main>
      }
    >
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const error = searchParams.get("error");
  const token = searchParams.get("token");
  const nextParam = searchParams.get("next");

  // Safety: only honour same-origin relative paths to prevent open redirect.
  const safeNext = nextParam?.startsWith("/") && !nextParam.startsWith("//") ? nextParam : null;
  const defaultNext = safeNext ?? "/buy/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(
    error === "auth_failed" ? "Authentication failed. Please try again." : null,
  );
  const [checkingAuth, setCheckingAuth] = useState(true);

  // biome-ignore lint/correctness/useExhaustiveDependencies: run the auth check once on mount
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        const redirectTo = token ? `/sell/dashboard?claim=${token}` : defaultNext;
        router.replace(redirectTo);
      } else {
        setCheckingAuth(false);
      }
    });
  }, []);

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;

    setIsLoading(true);
    setAuthError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setIsLoading(false);

    if (error) {
      setAuthError(error.message);
    } else {
      const nextPath = token ? `/sell/dashboard?claim=${token}` : "/buy/dashboard";
      router.replace(nextPath);
    }
  }

  async function handleGoogleLogin() {
    setAuthError(null);

    const nextPath = token ? `/sell/dashboard?claim=${token}` : defaultNext;
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: { prompt: "select_account" },
      },
    });

    if (error) {
      setAuthError(error.message);
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
      <div className="w-full max-w-md space-y-6 sm:space-y-8">
        {/* Header */}
        <div className="space-y-2 text-center">
          <h1 className="text-h2 text-ink">Haggle</h1>
          <p className="text-ink-secondary">Sign in to your account</p>
        </div>

        {/* Google OAuth */}
        <Button
          variant="secondary"
          onClick={handleGoogleLogin}
          className="w-full gap-3 font-medium"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          Continue with Google
        </Button>

        {/* Divider */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-line border-t" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-surface px-3 text-ink-muted">or</span>
          </div>
        </div>

        {/* Email / Password */}
        <form onSubmit={handleEmailLogin} className="space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                className="pr-11"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="-translate-y-1/2 absolute top-1/2 right-3 cursor-pointer text-ink-muted transition-colors hover:text-ink"
              >
                {showPassword ? (
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>
          <div className="flex justify-end">
            <Link
              href="/forgot-password"
              className="text-xs text-ink-muted transition-colors hover:text-ink"
            >
              Forgot password?
            </Link>
          </div>
          {/* Error */}
          {authError && <p className="-mb-1 text-center text-error text-sm">{authError}</p>}
          <Button
            type="submit"
            disabled={isLoading || !email.trim() || !password}
            className="mt-4 w-full"
          >
            {isLoading ? "Signing in..." : "Sign In"}
          </Button>

          {/* Sign up link */}
          <p className="text-center text-ink-secondary text-sm">
            Don&apos;t have an account?{" "}
            <Link
              href={(() => {
                const params = new URLSearchParams();
                if (token) params.set("token", token);
                if (safeNext) params.set("next", safeNext);
                const qs = params.toString();
                return qs ? `/sign-up?${qs}` : "/sign-up";
              })()}
              className="font-medium text-action-primary transition-colors hover:text-action-primary-hover"
            >
              Sign up
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}

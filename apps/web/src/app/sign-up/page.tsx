"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ShippingAddressFields } from "@/components/shipping/shipping-address-fields";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import {
  EMPTY_SHIPPING_ADDRESS,
  isCompleteShippingAddress,
  type ShippingAddressInput,
  writePendingDefaultAddress,
} from "@/lib/shipping-address";
import { createClient } from "@/lib/supabase/client";

export default function SignUpPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center p-4">
          <div className="text-ink-muted">Loading...</div>
        </main>
      }
    >
      <SignUpForm />
    </Suspense>
  );
}

function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const token = searchParams.get("token");
  const nextParam = searchParams.get("next");

  // Safety: only honour same-origin relative paths to prevent open redirect.
  const safeNext = nextParam?.startsWith("/") && !nextParam.startsWith("//") ? nextParam : null;
  const defaultNext = safeNext ?? "/buy/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [showAddress, setShowAddress] = useState(false);
  const [address, setAddress] = useState<ShippingAddressInput>(EMPTY_SHIPPING_ADDRESS);

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

  const passwordChecks = {
    minLength: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    number: /\d/.test(password),
    special: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password),
  };
  const passedChecks = Object.values(passwordChecks).filter(Boolean).length;
  const allChecksPassed = passedChecks === 4;

  const strengthLabel =
    passedChecks === 0 ? "" : passedChecks <= 2 ? "Weak" : passedChecks === 3 ? "Fair" : "Strong";
  const strengthColor =
    passedChecks <= 2 ? "bg-error-500" : passedChecks === 3 ? "bg-warning-500" : "bg-success-500";
  const strengthTextColor =
    passedChecks <= 2 ? "text-error" : passedChecks === 3 ? "text-warning" : "text-success";

  async function handleEmailSignUp(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;

    if (!allChecksPassed) {
      setAuthError("Password does not meet requirements.");
      return;
    }

    if (password !== confirmPassword) {
      setAuthError("Passwords do not match.");
      return;
    }

    if (isCompleteShippingAddress(address)) {
      writePendingDefaultAddress(address);
    }

    setIsLoading(true);
    setAuthError(null);

    const nextPath = token ? `/sell/dashboard?claim=${token}` : defaultNext;
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectTo },
    });

    setIsLoading(false);

    if (error) {
      setAuthError(error.message);
    } else {
      setEmailSent(true);
    }
  }

  async function handleGoogleLogin() {
    if (isCompleteShippingAddress(address)) {
      writePendingDefaultAddress(address);
    }
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

  if (emailSent) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-success/20 bg-success-soft">
              <svg
                viewBox="0 0 24 24"
                width="28"
                height="28"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-success"
                aria-hidden="true"
              >
                <rect width="20" height="16" x="2" y="4" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
            </div>
            <h1 className="text-h2 text-ink">Check your email</h1>
            <p className="text-ink-secondary">
              We sent a confirmation link to <span className="font-medium text-ink">{email}</span>.
              Click the link to verify your account and sign in.
            </p>
          </div>
          <Button variant="primary" onClick={() => setEmailSent(false)} className="w-full">
            Use a different email
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6 sm:space-y-8">
        {/* Header */}
        <div className="space-y-2 text-center">
          <h1 className="text-h2 text-ink">Haggle</h1>
          <p className="text-ink-secondary">
            {token
              ? "Sign up to claim your listing and start receiving offers."
              : "Create your account"}
          </p>
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
        <form onSubmit={handleEmailSignUp} className="space-y-4">
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
                placeholder="Create a password"
                required
                minLength={8}
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
            {/* Password strength */}
            {password && (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                    <div
                      className={`h-full rounded-full transition-all ${strengthColor}`}
                      style={{ width: `${(passedChecks / 4) * 100}%` }}
                    />
                  </div>
                  <span className={`text-xs ${strengthTextColor}`}>{strengthLabel}</span>
                </div>
                <ul className="space-y-1">
                  <li
                    className={`flex items-center gap-1.5 text-xs ${passwordChecks.minLength ? "text-success" : "text-ink-muted"}`}
                  >
                    <span>{passwordChecks.minLength ? "✓" : "○"}</span> At least 8 characters
                  </li>
                  <li
                    className={`flex items-center gap-1.5 text-xs ${passwordChecks.uppercase ? "text-success" : "text-ink-muted"}`}
                  >
                    <span>{passwordChecks.uppercase ? "✓" : "○"}</span> One uppercase letter
                  </li>
                  <li
                    className={`flex items-center gap-1.5 text-xs ${passwordChecks.number ? "text-success" : "text-ink-muted"}`}
                  >
                    <span>{passwordChecks.number ? "✓" : "○"}</span> One number
                  </li>
                  <li
                    className={`flex items-center gap-1.5 text-xs ${passwordChecks.special ? "text-success" : "text-ink-muted"}`}
                  >
                    <span>{passwordChecks.special ? "✓" : "○"}</span> One special character
                  </li>
                </ul>
              </div>
            )}
          </div>
          <div>
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <div className="relative">
              <Input
                id="confirmPassword"
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
                required
                minLength={8}
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
          <div className="rounded-xl border border-line bg-surface-raised p-4 text-left">
            <button
              type="button"
              className="flex w-full items-center justify-between text-sm font-medium text-ink"
              onClick={() => setShowAddress((open) => !open)}
            >
              Default delivery address
              <span className="text-ink-muted">{showAddress ? "Hide" : "Optional"}</span>
            </button>
            <p className="mt-1 text-xs text-ink-muted">
              Saved after you confirm your email. You can also add this later in settings or before
              a negotiation.
            </p>
            {showAddress && (
              <div className="mt-3">
                <ShippingAddressFields
                  idPrefix="signup-address"
                  value={address}
                  onChange={setAddress}
                />
              </div>
            )}
          </div>

          {/* Error */}
          {authError && <p className="-mb-1 text-center text-error text-sm">{authError}</p>}

          <Button
            type="submit"
            disabled={isLoading || !email.trim() || !allChecksPassed || !confirmPassword}
            className="mt-4 w-full"
          >
            {isLoading ? "Creating account..." : "Sign Up"}
          </Button>

          {/* Sign in link */}
          <p className="text-center text-ink-secondary text-sm">
            Already have an account?{" "}
            <Link
              href={(() => {
                const params = new URLSearchParams();
                if (token) params.set("token", token);
                if (safeNext) params.set("next", safeNext);
                const qs = params.toString();
                return qs ? `/sign-in?${qs}` : "/sign-in";
              })()}
              className="font-medium text-action-primary transition-colors hover:text-action-primary-hover"
            >
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}

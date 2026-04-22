"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function SignUpPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center p-4">
          <div className="text-slate-500">Loading...</div>
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
  const safeNext =
    nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")
      ? nextParam
      : null;
  const defaultNext = safeNext ?? "/buy/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        router.replace(defaultNext);
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

  const strengthLabel = passedChecks === 0 ? "" : passedChecks <= 2 ? "Weak" : passedChecks === 3 ? "Fair" : "Strong";
  const strengthColor = passedChecks <= 2 ? "bg-red-500" : passedChecks === 3 ? "bg-yellow-500" : "bg-emerald-500";

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

    setIsLoading(true);
    setAuthError(null);

    const nextPath = token
      ? `/sell/dashboard?claim=${token}`
      : defaultNext;
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
    setAuthError(null);

    const nextPath = token
      ? `/sell/dashboard?claim=${token}`
      : defaultNext;
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
        <div className="text-slate-500">Loading...</div>
      </main>
    );
  }

  if (emailSent) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/12 border border-emerald-500/30">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
                <rect width="20" height="16" x="2" y="4" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold">Check your email</h1>
            <p className="text-slate-400">
              We sent a confirmation link to <span className="text-slate-200 font-medium">{email}</span>.
              Click the link to verify your account and sign in.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEmailSent(false)}
            className="w-full rounded-lg bg-emerald-500 px-4 py-3 text-sm font-medium text-white hover:bg-emerald-600 transition-colors cursor-pointer"
          >
            Use a different email
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6 sm:space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold">Haggle</h1>
          <p className="text-slate-400">
            {token
              ? "Sign up to claim your listing and start receiving offers."
              : "Create your account"}
          </p>
        </div>

        {/* Google OAuth */}
        <button
          type="button"
          onClick={handleGoogleLogin}
          className="flex w-full items-center justify-center gap-3 rounded-lg border border-slate-700 bg-bg-card px-4 py-3 text-sm font-medium hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
          </svg>
          Continue with Google
        </button>

        {/* Divider */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-800" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-bg-primary px-3 text-slate-500">or</span>
          </div>
        </div>

        {/* Email / Password */}
        <form onSubmit={handleEmailSignUp} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-400 mb-1.5">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="w-full rounded-lg border border-slate-700 bg-bg-card px-4 py-3 text-sm placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 transition-colors"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-400 mb-1.5">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Create a password"
                required
                minLength={8}
                className="w-full rounded-lg border border-slate-700 bg-bg-card px-4 py-3 pr-11 text-sm placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
                  <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${strengthColor}`}
                      style={{ width: `${(passedChecks / 4) * 100}%` }}
                    />
                  </div>
                  <span className={`text-xs ${passedChecks <= 2 ? "text-red-400" : passedChecks === 3 ? "text-yellow-400" : "text-emerald-400"}`}>
                    {strengthLabel}
                  </span>
                </div>
                <ul className="space-y-1">
                  <li className={`text-xs flex items-center gap-1.5 ${passwordChecks.minLength ? "text-emerald-400" : "text-slate-500"}`}>
                    <span>{passwordChecks.minLength ? "✓" : "○"}</span> At least 8 characters
                  </li>
                  <li className={`text-xs flex items-center gap-1.5 ${passwordChecks.uppercase ? "text-emerald-400" : "text-slate-500"}`}>
                    <span>{passwordChecks.uppercase ? "✓" : "○"}</span> One uppercase letter
                  </li>
                  <li className={`text-xs flex items-center gap-1.5 ${passwordChecks.number ? "text-emerald-400" : "text-slate-500"}`}>
                    <span>{passwordChecks.number ? "✓" : "○"}</span> One number
                  </li>
                  <li className={`text-xs flex items-center gap-1.5 ${passwordChecks.special ? "text-emerald-400" : "text-slate-500"}`}>
                    <span>{passwordChecks.special ? "✓" : "○"}</span> One special character
                  </li>
                </ul>
              </div>
            )}
          </div>
          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-400 mb-1.5">
              Confirm Password
            </label>
            <div className="relative">
              <input
                id="confirmPassword"
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
                required
                minLength={8}
                className="w-full rounded-lg border border-slate-700 bg-bg-card px-4 py-3 pr-11 text-sm placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>
          {/* Error */}
          {authError && (
            <p className="-mb-1 text-center text-sm text-red-400">{authError}</p>
          )}

          <button
            type="submit"
            disabled={isLoading || !email.trim() || !allChecksPassed || !confirmPassword}
            className="mt-4 w-full rounded-lg bg-emerald-500 px-4 py-3 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {isLoading ? "Creating account..." : "Sign Up"}
          </button>

          {/* Sign in link */}
          <p className="text-center text-sm text-slate-400">
            Already have an account?{" "}
            <Link href={(() => {
              const params = new URLSearchParams();
              if (token) params.set("token", token);
              if (safeNext) params.set("next", safeNext);
              const qs = params.toString();
              return qs ? `/sign-in?${qs}` : "/sign-in";
            })()} className="text-cyan-400 hover:text-cyan-300 transition-colors">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}

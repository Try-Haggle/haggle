"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AuthHeading } from "@/components/auth/auth-heading";
import { GoogleIcon } from "@/components/auth/google-icon";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Divider } from "@/components/ui/divider";
import { FieldError, Input, Label } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { TextLink } from "@/components/ui/text-link";
import { isLikelyEmail, useFieldErrors } from "@/hooks/use-field-errors";
import { friendlyAuthError } from "@/lib/auth-errors";
import { postSignInPath, safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/client";

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const error = searchParams.get("error");
  const token = searchParams.get("token");
  const nextParam = searchParams.get("next");

  const safeNext = safeNextPath(nextParam);
  const nextPath = postSignInPath(token, nextParam);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const fieldErrors = useFieldErrors<"email" | "password">();
  // Where an error shows depends on what raised it: next to the control the
  // person just used. "redirect" = Google or the auth callback (top of the
  // page); "email" = the password form (right above its submit button).
  const [authError, setAuthError] = useState<AuthError | null>(
    error === "auth_failed"
      ? { source: "redirect", message: "Authentication failed. Please try again." }
      : null,
  );

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    const valid = fieldErrors.report({
      ...(!email.trim()
        ? { email: "Enter your email." }
        : !isLikelyEmail(email)
          ? { email: "Enter a valid email address." }
          : {}),
      ...(!password ? { password: "Enter your password." } : {}),
    });
    if (!valid) return;

    setIsLoading(true);
    setAuthError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setIsLoading(false);
      setAuthError({ source: "email", message: friendlyAuthError(error.message) });
    } else {
      // Stay busy through the redirect so the button cannot be pressed twice.
      router.replace(nextPath);
    }
  }

  async function handleGoogleLogin() {
    setAuthError(null);
    setIsGoogleLoading(true);

    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: { prompt: "select_account" },
      },
    });

    if (error) {
      setIsGoogleLoading(false);
      setAuthError({ source: "redirect", message: friendlyAuthError(error.message) });
    }
    // On success the browser is leaving for Google; stay busy until it does.
  }

  const isBusy = isLoading || isGoogleLoading;

  return (
    <main className="flex min-h-[calc(100dvh-var(--spacing-header))] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-8">
        {/* Header */}
        <AuthHeading title="Sign in" />

        {/* Form-level errors, not field borders or a toast: "wrong email or
            password" cannot honestly be pinned to either field, and a toast
            vanishes from where the person is looking. */}
        {authError?.source === "redirect" && <Alert tone="error">{authError.message}</Alert>}

        {/* Google OAuth */}
        <Button
          variant="secondary"
          size="lg"
          onClick={handleGoogleLogin}
          loading={isGoogleLoading}
          disabled={isBusy}
          className="w-full gap-3"
        >
          <GoogleIcon className={isGoogleLoading ? "hidden" : undefined} />
          Continue with Google
        </Button>

        <Divider label="or" />

        {/* Email / Password */}
        {/* noValidate: the browser's own bubbles name one field at a time and
            cannot be styled; the form reports every missing field itself. */}
        <form onSubmit={handleEmailLogin} noValidate className="space-y-5">
          <div>
            <Label htmlFor="email" required>
              Email
            </Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                fieldErrors.clear("email");
              }}
              invalid={!!fieldErrors.errors.email}
              aria-describedby={fieldErrors.errors.email ? "email-error" : undefined}
              size="lg"
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
            {fieldErrors.errors.email && (
              <FieldError id="email-error">{fieldErrors.errors.email}</FieldError>
            )}
          </div>
          <div>
            {/* "Forgot password?" sits on the label row, where people look for
                it the moment they are stuck on this field. */}
            <div className="mb-2 flex items-baseline justify-between">
              <Label htmlFor="password" className="mb-0" required>
                Password
              </Label>
              <TextLink href="/forgot-password" variant="subtle" className="text-sm">
                Forgot password?
              </TextLink>
            </div>
            <PasswordInput
              id="password"
              size="lg"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                fieldErrors.clear("password");
              }}
              invalid={!!fieldErrors.errors.password}
              aria-describedby={fieldErrors.errors.password ? "password-error" : undefined}
              placeholder="Enter your password"
              autoComplete="current-password"
              required
            />
            {fieldErrors.errors.password && (
              <FieldError id="password-error">{fieldErrors.errors.password}</FieldError>
            )}
          </div>
          {authError?.source === "email" && <Alert tone="error">{authError.message}</Alert>}
          <Button
            type="submit"
            size="lg"
            loading={isLoading}
            disabled={isBusy}
            className="mt-2 w-full"
          >
            {isLoading ? "Signing in…" : "Sign in"}
          </Button>

          {/* Sign up link */}
          <p className="text-center text-base text-ink-secondary">
            Don&apos;t have an account?{" "}
            <TextLink
              href={(() => {
                const params = new URLSearchParams();
                if (token) params.set("token", token);
                if (safeNext) params.set("next", safeNext);
                const qs = params.toString();
                return qs ? `/sign-up?${qs}` : "/sign-up";
              })()}
            >
              Sign up
            </TextLink>
          </p>
        </form>
      </div>
    </main>
  );
}

type AuthError = { source: "redirect" | "email"; message: string };

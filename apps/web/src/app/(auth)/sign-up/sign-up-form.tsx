"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { AuthHeading } from "@/components/auth/auth-heading";
import { GoogleIcon } from "@/components/auth/google-icon";
import { MailCheckIcon } from "@/components/auth/mail-check-icon";
import {
  meetsPasswordRequirements,
  PasswordRequirements,
} from "@/components/auth/password-requirements";
import { ProductShowcase } from "@/components/auth/product-showcase";
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

export function SignUpForm() {
  const searchParams = useSearchParams();
  const supabase = createClient();

  const token = searchParams.get("token");
  const nextParam = searchParams.get("next");
  const safeNext = safeNextPath(nextParam);
  const nextPath = postSignInPath(token, nextParam);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const fieldErrors = useFieldErrors<"name" | "email" | "password" | "confirmPassword">();
  const [emailSent, setEmailSent] = useState(false);
  // Shown next to the control that raised it, as on the sign-in page:
  // "redirect" = Google (top of the page), "email" = this form (above submit).
  const [authError, setAuthError] = useState<AuthError | null>(null);

  const allChecksPassed = meetsPasswordRequirements(password);

  function callbackUrl() {
    return `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
  }

  async function handleEmailSignUp(e: React.FormEvent) {
    e.preventDefault();
    const valid = fieldErrors.report({
      ...(!name.trim() ? { name: "Enter your name." } : {}),
      ...(!email.trim()
        ? { email: "Enter your email." }
        : !isLikelyEmail(email)
          ? { email: "Enter a valid email address." }
          : {}),
      ...(!password
        ? { password: "Create a password." }
        : !allChecksPassed
          ? { password: "Meet all four requirements below." }
          : {}),
      ...(!confirmPassword
        ? { confirmPassword: "Confirm your password." }
        : password !== confirmPassword
          ? { confirmPassword: "Passwords do not match." }
          : {}),
    });
    if (!valid) return;
    setIsLoading(true);
    setAuthError(null);

    const { error } = await supabase.auth.signUp({
      email,
      password,
      // Stored as `display_name`, the key the settings page edits and
      // getUserDisplayName reads first.
      options: { emailRedirectTo: callbackUrl(), data: { display_name: name.trim() } },
    });

    setIsLoading(false);

    if (error) {
      setAuthError({ source: "email", message: friendlyAuthError(error.message) });
    } else {
      setEmailSent(true);
    }
  }

  async function handleGoogleSignUp() {
    setAuthError(null);
    setIsGoogleLoading(true);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callbackUrl(),
        queryParams: { prompt: "select_account" },
      },
    });

    if (error) {
      setIsGoogleLoading(false);
      setAuthError({ source: "redirect", message: friendlyAuthError(error.message) });
    }
    // On success the browser is leaving for Google; stay busy until it does.
  }

  if (emailSent) {
    return (
      <main className="flex min-h-[calc(100dvh-var(--spacing-header))] items-center justify-center px-4 py-12">
        <div className="w-full max-w-md space-y-8 text-center">
          <div className="space-y-4">
            <MailCheckIcon />
            <h1 className="font-bold text-3xl text-ink tracking-tight">Check your email</h1>
            <p className="text-base text-ink-secondary">
              We sent a confirmation link to <span className="font-medium text-ink">{email}</span>.
              Click the link to verify your account and sign in.
            </p>
          </div>
          <Button size="lg" onClick={() => setEmailSent(false)} className="w-full">
            Use a different email
          </Button>
        </div>
      </main>
    );
  }

  const isBusy = isLoading || isGoogleLoading;

  return (
    <main className="flex min-h-[calc(100dvh-var(--spacing-header))] items-center justify-center px-4 py-12">
      {/* Wide screens: what Haggle does on the left, the form on the right.
          Below lg the showcase is dropped — the form alone fits a phone. At
          lg (1024–1279px) the showcase and gap shrink so neither column
          touches the window edge. */}
      <div className="grid w-full max-w-6xl items-center justify-center gap-10 lg:grid-cols-[27rem_28rem] xl:gap-20 xl:grid-cols-[30rem_28rem]">
        <div className="hidden lg:block">
          <ProductShowcase />
        </div>
        <div className="mx-auto w-full max-w-md space-y-8">
          <AuthHeading
            title="Create an account"
            description={
              token ? "Sign up to claim your listing and start receiving offers." : undefined
            }
          />

          {authError?.source === "redirect" && <Alert tone="error">{authError.message}</Alert>}

          {/* Google OAuth */}
          <Button
            variant="secondary"
            size="lg"
            onClick={handleGoogleSignUp}
            loading={isGoogleLoading}
            disabled={isBusy}
            className="w-full gap-3"
          >
            <GoogleIcon className={isGoogleLoading ? "hidden" : undefined} />
            Continue with Google
          </Button>

          <Divider label="or" />

          {/* Email / Password */}
          {/* noValidate: the form reports every missing field itself, in our
            styling, instead of the browser's one-at-a-time bubbles. */}
          <form onSubmit={handleEmailSignUp} noValidate className="space-y-5">
            {/* One field, not first/last: name formats vary too much to split
              reliably, and nothing downstream needs the parts — shipping
              carriers take a single recipient name. */}
            <div>
              <Label htmlFor="name" required>
                Name
              </Label>
              <Input
                id="name"
                size="lg"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  fieldErrors.clear("name");
                }}
                invalid={!!fieldErrors.errors.name}
                aria-describedby={fieldErrors.errors.name ? "name-error" : undefined}
                placeholder="Your name"
                autoComplete="name"
                required
                maxLength={80}
              />
              {fieldErrors.errors.name && (
                <FieldError id="name-error">{fieldErrors.errors.name}</FieldError>
              )}
            </div>
            <div>
              <Label htmlFor="email" required>
                Email
              </Label>
              <Input
                id="email"
                type="email"
                size="lg"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  fieldErrors.clear("email");
                }}
                invalid={!!fieldErrors.errors.email}
                aria-describedby={fieldErrors.errors.email ? "email-error" : undefined}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
              {fieldErrors.errors.email && (
                <FieldError id="email-error">{fieldErrors.errors.email}</FieldError>
              )}
            </div>
            <div>
              <Label htmlFor="password" required>
                Password
              </Label>
              <PasswordInput
                id="password"
                size="lg"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  fieldErrors.clear("password");
                }}
                invalid={!!fieldErrors.errors.password}
                aria-describedby={
                  fieldErrors.errors.password
                    ? "password-error password-requirements"
                    : "password-requirements"
                }
                visible={showPasswords}
                onVisibleChange={setShowPasswords}
                placeholder="Create a password"
                autoComplete="new-password"
                required
                minLength={8}
              />
              {fieldErrors.errors.password && (
                <FieldError id="password-error">{fieldErrors.errors.password}</FieldError>
              )}
              <PasswordRequirements
                id="password-requirements"
                password={password}
                className="pt-3"
              />
            </div>
            <div>
              <Label htmlFor="confirmPassword" required>
                Confirm password
              </Label>
              <PasswordInput
                id="confirmPassword"
                size="lg"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  fieldErrors.clear("confirmPassword");
                }}
                invalid={!!fieldErrors.errors.confirmPassword}
                aria-describedby={
                  fieldErrors.errors.confirmPassword ? "confirmPassword-error" : undefined
                }
                visible={showPasswords}
                onVisibleChange={setShowPasswords}
                placeholder="Confirm your password"
                autoComplete="new-password"
                required
                minLength={8}
              />
              {fieldErrors.errors.confirmPassword && (
                <FieldError id="confirmPassword-error">
                  {fieldErrors.errors.confirmPassword}
                </FieldError>
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
              {isLoading ? "Creating account…" : "Sign up"}
            </Button>

            {/* Sign in link */}
            <p className="text-center text-base text-ink-secondary">
              Already have an account?{" "}
              <TextLink
                href={(() => {
                  const params = new URLSearchParams();
                  if (token) params.set("token", token);
                  if (safeNext) params.set("next", safeNext);
                  const qs = params.toString();
                  return qs ? `/sign-in?${qs}` : "/sign-in";
                })()}
              >
                Sign in
              </TextLink>
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}

type AuthError = { source: "redirect" | "email"; message: string };

"use client";

import { useState } from "react";
import { AuthHeading } from "@/components/auth/auth-heading";
import { MailCheckIcon } from "@/components/auth/mail-check-icon";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { TextLink } from "@/components/ui/text-link";
import { isLikelyEmail, useFieldErrors } from "@/hooks/use-field-errors";
import { friendlyAuthError } from "@/lib/auth-errors";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldErrors = useFieldErrors<"email">();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const valid = fieldErrors.report(
      !email.trim()
        ? { email: "Enter your email." }
        : !isLikelyEmail(email)
          ? { email: "Enter a valid email address." }
          : {},
    );
    if (!valid) return;

    setIsLoading(true);
    setError(null);

    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent("/reset-password")}`;
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });

    setIsLoading(false);

    if (error) {
      setError(friendlyAuthError(error.message));
    } else {
      setEmailSent(true);
    }
  }

  if (emailSent) {
    return (
      <main className="flex min-h-[calc(100dvh-var(--spacing-header))] items-center justify-center px-4 py-12">
        <div className="w-full max-w-md space-y-8 text-center">
          <div className="space-y-4">
            <MailCheckIcon />
            <h1 className="font-bold text-3xl text-ink tracking-tight">Check your email</h1>
            {/* Worded "if an account exists" on purpose: the reset request
                succeeds for any address, so the page must not confirm which
                emails have accounts. */}
            <p className="text-base text-ink-secondary">
              If an account exists for <span className="font-medium text-ink">{email.trim()}</span>,
              we sent a link to reset your password.
            </p>
          </div>
          <div className="space-y-4">
            <Button size="lg" onClick={() => setEmailSent(false)} className="w-full">
              Use a different email
            </Button>
            <p className="text-base text-ink-secondary">
              Back to <TextLink href="/sign-in">Sign in</TextLink>
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-[calc(100dvh-var(--spacing-header))] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-8">
        <AuthHeading
          title="Reset your password"
          description="Enter your email and we'll send you a link to reset it."
        />

        <form onSubmit={handleSubmit} noValidate className="space-y-5">
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
          {error && <Alert tone="error">{error}</Alert>}
          <Button type="submit" size="lg" loading={isLoading} className="mt-2 w-full">
            {isLoading ? "Sending…" : "Send reset link"}
          </Button>

          {/* Same footer pattern as sign-in / sign-up, instead of a separate
              "← Back" link above the title. */}
          <p className="text-center text-base text-ink-secondary">
            Remember your password? <TextLink href="/sign-in">Sign in</TextLink>
          </p>
        </form>
      </div>
    </main>
  );
}

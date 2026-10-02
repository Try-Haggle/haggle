"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthHeading } from "@/components/auth/auth-heading";
import {
  meetsPasswordRequirements,
  PasswordRequirements,
} from "@/components/auth/password-requirements";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldError, Label } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { useFieldErrors } from "@/hooks/use-field-errors";
import { friendlyAuthError } from "@/lib/auth-errors";
import { createClient } from "@/lib/supabase/client";

export function ResetPasswordForm() {
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldErrors = useFieldErrors<"password" | "confirmPassword">();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const valid = fieldErrors.report({
      ...(!password
        ? { password: "Create a new password." }
        : !meetsPasswordRequirements(password)
          ? { password: "Meet all four requirements below." }
          : {}),
      ...(!confirmPassword
        ? { confirmPassword: "Confirm your new password." }
        : password !== confirmPassword
          ? { confirmPassword: "Passwords do not match." }
          : {}),
    });
    if (!valid) return;

    setIsLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setIsLoading(false);
      setError(friendlyAuthError(error.message));
    } else {
      // Stay busy through the redirect so the button cannot be pressed twice.
      router.replace("/buy/dashboard");
    }
  }

  return (
    <main className="flex min-h-[calc(100dvh-var(--spacing-header))] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-8">
        <AuthHeading title="Set a new password" description="Enter your new password below." />

        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          <div>
            <Label htmlFor="password" required>
              New password
            </Label>
            <PasswordInput
              id="password"
              size="lg"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                fieldErrors.clear("password");
              }}
              visible={showPasswords}
              onVisibleChange={setShowPasswords}
              invalid={!!fieldErrors.errors.password}
              aria-describedby={
                fieldErrors.errors.password
                  ? "password-error password-requirements"
                  : "password-requirements"
              }
              placeholder="Create a new password"
              autoComplete="new-password"
              required
            />
            {fieldErrors.errors.password && (
              <FieldError id="password-error">{fieldErrors.errors.password}</FieldError>
            )}
            <PasswordRequirements id="password-requirements" password={password} className="pt-3" />
          </div>
          <div>
            <Label htmlFor="confirmPassword" required>
              Confirm new password
            </Label>
            <PasswordInput
              id="confirmPassword"
              size="lg"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                fieldErrors.clear("confirmPassword");
              }}
              visible={showPasswords}
              onVisibleChange={setShowPasswords}
              invalid={!!fieldErrors.errors.confirmPassword}
              aria-describedby={
                fieldErrors.errors.confirmPassword ? "confirmPassword-error" : undefined
              }
              placeholder="Confirm your new password"
              autoComplete="new-password"
              required
            />
            {fieldErrors.errors.confirmPassword && (
              <FieldError id="confirmPassword-error">
                {fieldErrors.errors.confirmPassword}
              </FieldError>
            )}
          </div>
          {error && <Alert tone="error">{error}</Alert>}
          <Button type="submit" size="lg" loading={isLoading} className="mt-2 w-full">
            {isLoading ? "Updating…" : "Update password"}
          </Button>
        </form>
      </div>
    </main>
  );
}

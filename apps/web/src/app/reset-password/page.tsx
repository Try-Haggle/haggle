"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;

    if (!allChecksPassed) {
      setError("Password does not meet requirements.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    setIsLoading(false);

    if (error) {
      setError(error.message);
    } else {
      router.replace("/buy/dashboard");
    }
  }

  const eyeOpenIcon = (
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
  );

  const eyeClosedIcon = (
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
  );

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6 sm:space-y-8">
        {/* Header */}
        <div className="space-y-6">
          <div className="space-y-2 text-center">
            <h1 className="text-h2 text-ink">Set new password</h1>
            <p className="text-ink-secondary">Enter your new password below.</p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="password">New password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter new password"
                required
                minLength={8}
                className="pr-11"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="-translate-y-1/2 absolute top-1/2 right-3 cursor-pointer text-ink-muted transition-colors hover:text-ink"
              >
                {showPassword ? eyeClosedIcon : eyeOpenIcon}
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
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <div className="relative">
              <Input
                id="confirmPassword"
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                required
                minLength={8}
                className="pr-11"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="-translate-y-1/2 absolute top-1/2 right-3 cursor-pointer text-ink-muted transition-colors hover:text-ink"
              >
                {showPassword ? eyeClosedIcon : eyeOpenIcon}
              </button>
            </div>
          </div>
          {/* Error */}
          {error && <p className="-mb-1 text-center text-error text-sm">{error}</p>}
          <Button
            type="submit"
            disabled={isLoading || !allChecksPassed || !confirmPassword}
            className="mt-4 w-full"
          >
            {isLoading ? "Updating..." : "Update Password"}
          </Button>
        </form>
      </div>
    </main>
  );
}

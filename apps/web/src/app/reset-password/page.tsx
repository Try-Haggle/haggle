"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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

  const strengthLabel = passedChecks === 0 ? "" : passedChecks <= 2 ? "Weak" : passedChecks === 3 ? "Fair" : "Strong";
  const strengthColor = passedChecks <= 2 ? "bg-red-500" : passedChecks === 3 ? "bg-yellow-500" : "bg-emerald-500";

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
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );

  const eyeClosedIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6 sm:space-y-8">
        {/* Back + Header */}
        <div className="space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-2xl sm:text-3xl font-bold">Set new password</h1>
            <p className="text-slate-400">
              Enter your new password below.
            </p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-400 mb-1.5">
              New password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter new password"
                required
                minLength={8}
                className="w-full rounded-lg border border-slate-700 bg-bg-card px-4 py-3 pr-11 text-sm placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
              >
                {showPassword ? eyeClosedIcon : eyeOpenIcon}
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
              Confirm password
            </label>
            <div className="relative">
              <input
                id="confirmPassword"
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                required
                minLength={8}
                className="w-full rounded-lg border border-slate-700 bg-bg-card px-4 py-3 pr-11 text-sm placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
              >
                {showPassword ? eyeClosedIcon : eyeOpenIcon}
              </button>
            </div>
          </div>
          {/* Error */}
          {error && (
            <p className="-mb-1 text-center text-sm text-red-400">{error}</p>
          )}
          <button
            type="submit"
            disabled={isLoading || !allChecksPassed || !confirmPassword}
            className="mt-4 w-full rounded-lg bg-emerald-500 px-4 py-3 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {isLoading ? "Updating..." : "Update Password"}
          </button>
        </form>

      </div>
    </main>
  );
}

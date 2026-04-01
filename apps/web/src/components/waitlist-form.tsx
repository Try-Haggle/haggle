"use client";

import { useState } from "react";

interface WaitlistFormProps {
  source?: string;
  compact?: boolean;
}

export function WaitlistForm({ source = "landing", compact = false }: WaitlistFormProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [count, setCount] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes("@")) return;

    setStatus("loading");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source }),
      });
      const data = await res.json();
      if (data.success) {
        setStatus("success");
        setCount(data.count ?? null);
      } else {
        setStatus("error");
        setErrorMsg(data.error || "Something went wrong");
      }
    } catch {
      setStatus("error");
      setErrorMsg("Network error. Please try again.");
    }
  };

  if (status === "success") {
    return (
      <div className={`rounded-xl border border-emerald-500/30 bg-emerald-500/10 ${compact ? "px-4 py-3" : "px-6 py-5"}`}>
        <p className="text-emerald-400 font-medium">You&apos;re on the list!</p>
        {count && (
          <p className="text-sm text-slate-400 mt-1">
            You&apos;re #{count} on the waitlist
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={`flex ${compact ? "flex-row gap-2" : "flex-col sm:flex-row gap-3"}`}>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="your@email.com"
        required
        className={`flex-1 rounded-xl border border-slate-700 bg-bg-input px-4 text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 ${compact ? "py-2.5 text-sm" : "py-3"}`}
      />
      <button
        type="submit"
        disabled={status === "loading"}
        className={`rounded-xl bg-cyan-600 font-medium text-white hover:bg-cyan-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${compact ? "px-5 py-2.5 text-sm" : "px-8 py-3"}`}
      >
        {status === "loading" ? "Joining..." : "Join Waitlist"}
      </button>
      {status === "error" && (
        <p className="text-sm text-red-400 mt-1">{errorMsg}</p>
      )}
    </form>
  );
}

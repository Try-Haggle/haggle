"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

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
    if (!email?.includes("@")) return;

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
      <div
        className={`rounded-xl border border-success/20 bg-success-soft ${compact ? "px-4 py-3" : "px-6 py-5"}`}
      >
        <p className="font-medium text-success">You&apos;re on the list!</p>
        {count && (
          <p className="mt-1 text-ink-secondary text-sm">You&apos;re #{count} on the waitlist</p>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={`flex ${compact ? "flex-row gap-2" : "flex-col gap-3 sm:flex-row"}`}
    >
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="your@email.com"
        required
        className={`flex-1 rounded-xl border border-line bg-surface-overlay px-4 text-ink outline-none transition placeholder:text-ink-muted focus:border-focus focus:ring-2 focus:ring-action-primary/20 ${compact ? "py-2.5 text-sm" : "py-3"}`}
      />
      <Button
        type="submit"
        size={compact ? "sm" : "md"}
        disabled={status === "loading"}
        className={`rounded-xl ${compact ? "" : "px-8"}`}
      >
        {status === "loading" ? "Joining..." : "Join Waitlist"}
      </Button>
      {status === "error" && <p className="mt-1 text-error text-sm">{errorMsg}</p>}
    </form>
  );
}

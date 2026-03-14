"use client";

export function DashboardContent({
  userEmail,
  claimResult,
}: {
  userEmail: string;
  claimResult: { ok: boolean; error?: string } | null;
}) {
  return (
    <main className="min-h-screen p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-zinc-500 mt-1">{userEmail}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="text-sm text-zinc-400">Connected</span>
        </div>
      </div>

      {/* Claim Result Banner */}
      {claimResult && (
        <div
          className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
            claimResult.ok
              ? "border-emerald-500/30 bg-emerald-500/8 text-emerald-300"
              : "border-red-500/30 bg-red-500/8 text-red-300"
          }`}
        >
          {claimResult.ok ? (
            <div className="flex items-center gap-2">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              Listing claimed successfully! It&apos;s now linked to your account.
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              {claimResult.error === "expired"
                ? "This claim link has expired. Listings must be claimed within 24 hours."
                : claimResult.error === "already_claimed"
                  ? "This listing has already been claimed."
                  : claimResult.error === "invalid_token"
                    ? "Invalid claim link. Please check your link and try again."
                    : "Failed to process claim. Please try again."}
            </div>
          )}
        </div>
      )}

      {/* Empty State — Slice 6에서 실제 리스팅 목록으로 교체 예정 */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500">
            <path d="M20 7h-9" />
            <path d="M14 17H5" />
            <circle cx="17" cy="17" r="3" />
            <circle cx="7" cy="7" r="3" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-zinc-300 mb-1">Your Listings</h2>
        <p className="text-sm text-zinc-500 mb-6">
          Listings you claim will appear here. Create one with <span className="text-cyan-400 font-mono">/haggle</span> in ChatGPT.
        </p>
      </div>
    </main>
  );
}

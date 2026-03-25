"use client";

export function BuyerDashboardContent({
  userEmail,
}: {
  userEmail: string;
}) {
  return (
    <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cyan-400 shrink-0">
              <circle cx="8" cy="21" r="1" />
              <circle cx="19" cy="21" r="1" />
              <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
            </svg>
            <h1 className="text-2xl font-bold text-white">Buyer Dashboard</h1>
          </div>
          <p className="text-sm text-slate-400">Browse listings and track your negotiations</p>
        </div>
      </div>

      {/* Recently Viewed Listings */}
      <h2 className="text-lg font-bold text-white mb-4">Recently Viewed</h2>
      <div className="rounded-xl border border-slate-800 bg-bg-card/50 p-12 text-center mb-8">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-800">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-slate-300 mb-1">No recently viewed listings</h3>
        <p className="text-sm text-slate-500">
          When you visit a seller&apos;s listing link, it will appear here.
        </p>
      </div>

      {/* Active Negotiations */}
      <h2 className="text-lg font-bold text-white mb-4">Active Negotiations</h2>
      <div className="rounded-xl border border-slate-800 bg-bg-card/50 p-12 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-800">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-slate-300 mb-1">No active negotiations</h3>
        <p className="text-sm text-slate-500">
          Start a negotiation on a listing to track it here.
        </p>
      </div>
    </main>
  );
}

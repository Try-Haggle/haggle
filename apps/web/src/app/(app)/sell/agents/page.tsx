import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function SellAgentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cyan-400 shrink-0">
          <path d="M12 8V4H8" />
          <rect width="16" height="12" x="4" y="8" rx="2" />
          <path d="M2 14h2" />
          <path d="M20 14h2" />
          <path d="M15 13v2" />
          <path d="M9 13v2" />
        </svg>
        <h1 className="text-2xl font-bold text-white">Selling Agents</h1>
      </div>
      <p className="text-sm text-slate-400 mb-8">Configure AI agents for your listings</p>

      <div className="rounded-xl border border-slate-800 bg-bg-card/50 p-8 sm:p-12 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-full bg-slate-800">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500">
            <path d="M12 8V4H8" />
            <rect width="16" height="12" x="4" y="8" rx="2" />
            <path d="M2 14h2" />
            <path d="M20 14h2" />
            <path d="M15 13v2" />
            <path d="M9 13v2" />
          </svg>
        </div>
        <h3 className="text-base sm:text-lg font-semibold text-slate-300 mb-1">Coming Soon</h3>
        <p className="text-sm text-slate-500">
          Manage and customize your selling agents here. For now, agents are configured per listing during creation.
        </p>
      </div>
    </main>
  );
}

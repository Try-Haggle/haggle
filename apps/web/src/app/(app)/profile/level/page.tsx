import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { serverApi } from "@/lib/api-server";

interface LevelInfo {
  userId: string;
  level: number;
  xp: number;
  totalTrades: number;
  totalDeals: number;
  totalVolume: string;
  totalSaved: string;
  avgSavingPct: string;
  bestSavingPct: string;
  consecutiveDeals: number;
  nextLevelXp: number | null;
}

export default async function LevelPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/claim");

  let levelInfo: LevelInfo;
  try {
    const data = await serverApi.get<{ level_info: LevelInfo }>("/me/level");
    levelInfo = data.level_info;
  } catch {
    levelInfo = {
      userId: user.id,
      level: 1,
      xp: 0,
      totalTrades: 0,
      totalDeals: 0,
      totalVolume: "0",
      totalSaved: "0",
      avgSavingPct: "0",
      bestSavingPct: "0",
      consecutiveDeals: 0,
      nextLevelXp: 2000,
    };
  }

  const xpProgress =
    levelInfo.nextLevelXp != null
      ? Math.min(100, Math.round((levelInfo.xp / levelInfo.nextLevelXp) * 100))
      : 100;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">Agent Level</h1>

      {/* Level badge */}
      <div className="mb-8 rounded-xl border border-zinc-700 bg-zinc-900 p-6 text-center">
        <div className="mb-2 text-5xl font-black text-emerald-400">
          Lv. {levelInfo.level}
        </div>
        <div className="text-sm text-zinc-400">Negotiation Agent</div>
      </div>

      {/* XP progress */}
      <div className="mb-8">
        <div className="mb-2 flex justify-between text-sm">
          <span className="text-zinc-400">XP</span>
          <span className="text-zinc-300">
            {levelInfo.xp.toLocaleString()}
            {levelInfo.nextLevelXp != null && (
              <span className="text-zinc-500">
                {" "}
                / {levelInfo.nextLevelXp.toLocaleString()}
              </span>
            )}
          </span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${xpProgress}%` }}
          />
        </div>
        {levelInfo.nextLevelXp == null && (
          <div className="mt-1 text-center text-xs text-amber-400">MAX LEVEL</div>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4">
        <StatCard label="Total Trades" value={levelInfo.totalTrades} />
        <StatCard label="Deals Closed" value={levelInfo.totalDeals} />
        <StatCard
          label="Volume"
          value={`$${(Number(levelInfo.totalVolume) / 100).toLocaleString()}`}
        />
        <StatCard
          label="Total Saved"
          value={`$${(Number(levelInfo.totalSaved) / 100).toLocaleString()}`}
        />
        <StatCard
          label="Avg Savings"
          value={`${Number(levelInfo.avgSavingPct).toFixed(1)}%`}
        />
        <StatCard
          label="Best Savings"
          value={`${Number(levelInfo.bestSavingPct).toFixed(1)}%`}
        />
        <StatCard label="Win Streak" value={levelInfo.consecutiveDeals} />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-zinc-100">{value}</div>
    </div>
  );
}

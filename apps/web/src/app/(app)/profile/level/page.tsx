import { redirect } from "next/navigation";
import { ProgressBar, StatTile } from "@/components/ui";
import { serverApi } from "@/lib/api-server";
import { createClient } from "@/lib/supabase/server";

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
      <div className="mb-8 rounded-xl border border-line bg-surface-raised p-6 text-center">
        <div className="mb-2 text-5xl font-black text-success">Lv. {levelInfo.level}</div>
        <div className="text-sm text-ink-secondary">Negotiation Agent</div>
      </div>

      {/* XP progress */}
      <div className="mb-8">
        <div className="mb-2 flex justify-between text-sm">
          <span className="text-ink-secondary">XP</span>
          <span className="text-ink-secondary">
            {levelInfo.xp.toLocaleString()}
            {levelInfo.nextLevelXp != null && (
              <span className="text-ink-muted"> / {levelInfo.nextLevelXp.toLocaleString()}</span>
            )}
          </span>
        </div>
        <ProgressBar value={xpProgress} tone="success" />
        {levelInfo.nextLevelXp == null && (
          <div className="mt-1 text-center text-xs text-action-primary">MAX LEVEL</div>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4">
        <StatTile label="Total Trades" value={levelInfo.totalTrades} />
        <StatTile label="Deals Closed" value={levelInfo.totalDeals} />
        <StatTile
          label="Volume"
          value={`$${(Number(levelInfo.totalVolume) / 100).toLocaleString()}`}
        />
        <StatTile
          label="Total Saved"
          value={`$${(Number(levelInfo.totalSaved) / 100).toLocaleString()}`}
        />
        <StatTile label="Avg Savings" value={`${Number(levelInfo.avgSavingPct).toFixed(1)}%`} />
        <StatTile label="Best Savings" value={`${Number(levelInfo.bestSavingPct).toFixed(1)}%`} />
        <StatTile label="Win Streak" value={levelInfo.consecutiveDeals} />
      </div>
    </div>
  );
}

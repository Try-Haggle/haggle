import { redirect } from "next/navigation";
import { BackLink, Badge, StatTile, TierBadge } from "@/components/ui";
import { serverApi } from "@/lib/api-server";
import { createClient } from "@/lib/supabase/server";

const SPECIES_EMOJI: Record<string, string> = {
  FOX: "🦊",
  RABBIT: "🐰",
  BEAR: "🐻",
  CAT: "🐱",
  OWL: "🦉",
  DRAGON: "🐉",
  EAGLE: "🦅",
  WOLF: "🐺",
};

interface Buddy {
  id: string;
  name: string;
  species: string;
  rarity: string;
  level: number;
  ability: string | null;
  dna: Record<string, unknown> | null;
  createdAt: string;
}

interface TradeSummary {
  deals: number;
  rejects: number;
  timeouts: number;
  walkaways: number;
  total: number;
}

interface Trade {
  id: string;
  outcome: string;
  savingPct: string | null;
  rounds: number;
  category: string | null;
  createdAt: string;
}

export default async function BuddyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/claim");

  const { id } = await params;

  let buddy: Buddy;
  let tradeSummary: TradeSummary;
  let trades: Trade[];

  try {
    const [detailData, tradesData] = await Promise.all([
      serverApi.get<{ buddy: Buddy; trade_summary: TradeSummary }>(`/buddies/${id}`),
      serverApi.get<{ trades: Trade[] }>(`/buddies/${id}/trades`),
    ]);
    buddy = detailData.buddy;
    tradeSummary = detailData.trade_summary;
    trades = tradesData.trades;
  } catch {
    redirect("/profile/buddies");
  }

  const winRate =
    tradeSummary.total > 0 ? Math.round((tradeSummary.deals / tradeSummary.total) * 100) : 0;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <BackLink href="/profile/buddies" className="mb-6">
        Back to Buddies
      </BackLink>

      {/* Buddy header */}
      <div className="mb-8 rounded-xl border border-line bg-surface-raised p-6 text-center">
        <div className="mb-2 text-7xl">{SPECIES_EMOJI[buddy.species] ?? "🐾"}</div>
        <h1 className="mb-1 text-2xl font-bold text-ink">{buddy.name}</h1>
        <div className="flex items-center justify-center gap-3">
          <TierBadge tier={buddy.rarity} palette="rarity" size="sm" />
          <span className="text-sm text-ink-muted">
            {buddy.species} &middot; Lv. {buddy.level}
          </span>
        </div>
        {buddy.ability && (
          <div className="mt-3 rounded-lg bg-surface-sunken px-4 py-2 text-sm text-ink-secondary">
            Ability: {buddy.ability}
          </div>
        )}
      </div>

      {/* Trade summary */}
      <h2 className="mb-4 text-lg font-semibold">Trade Stats</h2>
      <div className="mb-8 grid grid-cols-3 gap-3">
        <StatTile align="center" tone="success" value={tradeSummary.deals} label="Deals" />
        <StatTile align="center" value={tradeSummary.total} label="Total" />
        <StatTile align="center" tone="accent" value={`${winRate}%`} label="Win Rate" />
      </div>

      {/* Trade history */}
      <h2 className="mb-4 text-lg font-semibold">Recent Trades</h2>
      {trades.length === 0 ? (
        <p className="text-sm text-ink-muted">No trades yet with this buddy.</p>
      ) : (
        <div className="space-y-2">
          {trades.map((trade) => (
            <div
              key={trade.id}
              className="flex items-center justify-between rounded-lg border border-line bg-surface-raised px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <Badge
                  tone={
                    trade.outcome === "DEAL"
                      ? "success"
                      : trade.outcome === "REJECT"
                        ? "error"
                        : "neutral"
                  }
                  size="sm"
                >
                  {trade.outcome}
                </Badge>
                {trade.category && <span className="text-xs text-ink-muted">{trade.category}</span>}
              </div>
              <div className="flex items-center gap-4 text-sm">
                {trade.savingPct && (
                  <span className="text-success">{Number(trade.savingPct).toFixed(1)}% saved</span>
                )}
                <span className="text-ink-muted">{trade.rounds}R</span>
                <span className="text-xs text-ink-muted">
                  {new Date(trade.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

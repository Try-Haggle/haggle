import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { serverApi } from "@/lib/api-server";

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

const RARITY_COLORS: Record<string, string> = {
  COMMON: "text-zinc-400",
  UNCOMMON: "text-green-400",
  RARE: "text-blue-400",
  EPIC: "text-purple-400",
  LEGENDARY: "text-orange-400",
  MYTHIC: "text-red-400",
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

export default async function BuddyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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
      serverApi.get<{ buddy: Buddy; trade_summary: TradeSummary }>(
        `/buddies/${id}`,
      ),
      serverApi.get<{ trades: Trade[] }>(`/buddies/${id}/trades`),
    ]);
    buddy = detailData.buddy;
    tradeSummary = detailData.trade_summary;
    trades = tradesData.trades;
  } catch {
    redirect("/profile/buddies");
  }

  const winRate =
    tradeSummary.total > 0
      ? Math.round((tradeSummary.deals / tradeSummary.total) * 100)
      : 0;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link
        href="/profile/buddies"
        className="mb-6 inline-block text-sm text-zinc-400 hover:text-zinc-200"
      >
        &larr; Back to Buddies
      </Link>

      {/* Buddy header */}
      <div className="mb-8 rounded-xl border border-zinc-700 bg-zinc-900 p-6 text-center">
        <div className="mb-2 text-7xl">
          {SPECIES_EMOJI[buddy.species] ?? "🐾"}
        </div>
        <h1 className="mb-1 text-2xl font-bold text-zinc-100">{buddy.name}</h1>
        <div className="flex items-center justify-center gap-3">
          <span
            className={`text-sm font-semibold ${
              RARITY_COLORS[buddy.rarity] ?? "text-zinc-400"
            }`}
          >
            {buddy.rarity}
          </span>
          <span className="text-sm text-zinc-500">
            {buddy.species} &middot; Lv. {buddy.level}
          </span>
        </div>
        {buddy.ability && (
          <div className="mt-3 rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-300">
            Ability: {buddy.ability}
          </div>
        )}
      </div>

      {/* Trade summary */}
      <h2 className="mb-4 text-lg font-semibold">Trade Stats</h2>
      <div className="mb-8 grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-center">
          <div className="text-2xl font-bold text-emerald-400">
            {tradeSummary.deals}
          </div>
          <div className="text-xs text-zinc-500">Deals</div>
        </div>
        <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-center">
          <div className="text-2xl font-bold text-zinc-200">
            {tradeSummary.total}
          </div>
          <div className="text-xs text-zinc-500">Total</div>
        </div>
        <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-center">
          <div className="text-2xl font-bold text-amber-400">{winRate}%</div>
          <div className="text-xs text-zinc-500">Win Rate</div>
        </div>
      </div>

      {/* Trade history */}
      <h2 className="mb-4 text-lg font-semibold">Recent Trades</h2>
      {trades.length === 0 ? (
        <p className="text-sm text-zinc-500">No trades yet with this buddy.</p>
      ) : (
        <div className="space-y-2">
          {trades.map((trade) => (
            <div
              key={trade.id}
              className="flex items-center justify-between rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span
                  className={`text-sm font-medium ${
                    trade.outcome === "DEAL"
                      ? "text-emerald-400"
                      : trade.outcome === "REJECT"
                        ? "text-red-400"
                        : "text-zinc-400"
                  }`}
                >
                  {trade.outcome}
                </span>
                {trade.category && (
                  <span className="text-xs text-zinc-500">{trade.category}</span>
                )}
              </div>
              <div className="flex items-center gap-4 text-sm">
                {trade.savingPct && (
                  <span className="text-emerald-400">
                    {Number(trade.savingPct).toFixed(1)}% saved
                  </span>
                )}
                <span className="text-zinc-500">{trade.rounds}R</span>
                <span className="text-xs text-zinc-600">
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

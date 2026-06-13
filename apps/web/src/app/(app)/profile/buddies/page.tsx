import Link from "next/link";
import { redirect } from "next/navigation";
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

// Rarity tiers are a deliberate distinct-hue palette (not feedback states),
// kept readable in both themes via dark: variants.
const RARITY_COLORS: Record<string, string> = {
  COMMON: "text-ink-secondary border-line",
  UNCOMMON: "text-green-600 border-green-500 dark:text-green-400 dark:border-green-600",
  RARE: "text-blue-600 border-blue-500 dark:text-blue-400 dark:border-blue-600",
  EPIC: "text-purple-600 border-purple-500 dark:text-purple-400 dark:border-purple-600",
  LEGENDARY: "text-orange-600 border-orange-500 dark:text-orange-400 dark:border-orange-600",
  MYTHIC: "text-red-600 border-red-500 dark:text-red-400 dark:border-red-600",
};

interface Buddy {
  id: string;
  name: string;
  species: string;
  rarity: string;
  level: number;
  ability: string | null;
  createdAt: string;
}

export default async function BuddiesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/claim");

  let buddyList: Buddy[] = [];
  try {
    const data = await serverApi.get<{ buddies: Buddy[] }>("/buddies");
    buddyList = data.buddies;
  } catch {
    // Empty state
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Buddies</h1>
        <Link href="/profile/level" className="text-sm text-success hover:underline">
          View Level &rarr;
        </Link>
      </div>

      {buddyList.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface-raised p-12 text-center">
          <div className="mb-4 text-6xl">🥚</div>
          <h2 className="mb-2 text-lg font-semibold text-ink">No Buddies Yet</h2>
          <p className="text-sm text-ink-secondary">
            Complete your first negotiation to earn a buddy companion!
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {buddyList.map((buddy) => (
            <Link
              key={buddy.id}
              href={`/profile/buddies/${buddy.id}`}
              className="group rounded-xl border border-line bg-surface-raised p-5 transition-colors hover:border-line-strong"
            >
              <div className="mb-3 text-center text-5xl">
                {SPECIES_EMOJI[buddy.species] ?? "🐾"}
              </div>
              <div className="mb-1 text-center text-lg font-semibold text-ink group-hover:text-ink">
                {buddy.name}
              </div>
              <div className="flex items-center justify-center gap-2">
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                    RARITY_COLORS[buddy.rarity] ?? "text-ink-secondary border-line"
                  }`}
                >
                  {buddy.rarity}
                </span>
                <span className="text-xs text-ink-muted">Lv. {buddy.level}</span>
              </div>
              {buddy.ability && (
                <div className="mt-2 text-center text-xs text-ink-muted">{buddy.ability}</div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

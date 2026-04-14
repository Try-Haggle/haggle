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
  COMMON: "text-zinc-400 border-zinc-600",
  UNCOMMON: "text-green-400 border-green-600",
  RARE: "text-blue-400 border-blue-600",
  EPIC: "text-purple-400 border-purple-600",
  LEGENDARY: "text-orange-400 border-orange-600",
  MYTHIC: "text-red-400 border-red-600",
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
        <Link
          href="/profile/level"
          className="text-sm text-emerald-400 hover:underline"
        >
          View Level &rarr;
        </Link>
      </div>

      {buddyList.length === 0 ? (
        <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-12 text-center">
          <div className="mb-4 text-6xl">🥚</div>
          <h2 className="mb-2 text-lg font-semibold text-zinc-200">
            No Buddies Yet
          </h2>
          <p className="text-sm text-zinc-400">
            Complete your first negotiation to earn a buddy companion!
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {buddyList.map((buddy) => (
            <Link
              key={buddy.id}
              href={`/profile/buddies/${buddy.id}`}
              className="group rounded-xl border border-zinc-700 bg-zinc-900 p-5 transition-colors hover:border-zinc-500"
            >
              <div className="mb-3 text-center text-5xl">
                {SPECIES_EMOJI[buddy.species] ?? "🐾"}
              </div>
              <div className="mb-1 text-center text-lg font-semibold text-zinc-100 group-hover:text-white">
                {buddy.name}
              </div>
              <div className="flex items-center justify-center gap-2">
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                    RARITY_COLORS[buddy.rarity] ?? "text-zinc-400 border-zinc-600"
                  }`}
                >
                  {buddy.rarity}
                </span>
                <span className="text-xs text-zinc-500">
                  Lv. {buddy.level}
                </span>
              </div>
              {buddy.ability && (
                <div className="mt-2 text-center text-xs text-zinc-500">
                  {buddy.ability}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

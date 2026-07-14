import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, TierBadge } from "@/components/ui";
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
        <EmptyState
          icon={<span className="text-3xl">🥚</span>}
          title="No Buddies Yet"
          description="Complete your first negotiation to earn a buddy companion!"
        />
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
                <TierBadge tier={buddy.rarity} palette="rarity" size="sm" />
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

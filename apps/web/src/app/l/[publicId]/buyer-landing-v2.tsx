"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  type AgentSelection,
  type ListingDetail,
  ListingDetailV2,
  type SavedAgentOption,
  type StrategyOverride,
  type ViewerInfo,
} from "@/components/listing-detail";
import { Nav } from "@/components/nav";
import { BackLink } from "@/components/ui/back-link";
import { ApiError, api } from "@/lib/api-client";
import { listNegotiationAgents, rowToNegotiationAgent } from "@/lib/negotiation-agents-api";
import { storeNegotiationRunToken } from "@/lib/negotiation-auto-play-token";
import { useAmplitude } from "@/providers/amplitude-provider";
import {
  NegotiationAgentBuilderChat,
  type NegotiationAgentBuilderMemory,
} from "./negotiation-agent-builder-chat";

/**
 * Live host for Listing Detail v2.
 *
 * The v2 component tree is presentation only — it knows how a negotiation gets
 * set up, not where any of it comes from. Everything that touches the platform
 * is wired here: the buyer's saved agents, the real briefing chat, and the
 * POST that opens a session. Keeping that split is what let v2 be designed
 * against fixtures at /preview/listing-detail and adopted without a rewrite.
 *
 * v1 (`buyer-landing.tsx`) stays reachable at `?v=1` and is untouched, so the
 * swap is reversible by URL while v2 is in front of real buyers.
 */

type Origin = "browse" | "buy-dashboard" | "sell-dashboard";

const ORIGIN_HREF: Record<Origin, string> = {
  browse: "/browse",
  "buy-dashboard": "/buy",
  "sell-dashboard": "/sell",
};

const ORIGIN_LABEL: Record<Origin, string> = {
  browse: "Back to browse",
  "buy-dashboard": "Back to my purchases",
  "sell-dashboard": "Back to my listings",
};

/** Hints the briefing produced, shown on the picker as progress. */
function countHints(memory: NegotiationAgentBuilderMemory | null): number {
  if (!memory) return 0;
  return (
    (memory.mustHave?.length ?? 0) +
    (memory.avoid?.length ?? 0) +
    (memory.dealBreakers?.length ?? 0) +
    (memory.categoryCriteria?.filter((c) => c.stance).length ?? 0) +
    (memory.budgetMax ? 1 : 0) +
    (memory.targetPrice ? 1 : 0)
  );
}

interface StartResponse {
  session_id: string;
  run_token: string;
  guest_buyer_id?: string;
}

/**
 * POST /negotiations/start, with the error normalized to something a person
 * can read. `ApiError` carries a machine `code` that is sometimes the only
 * populated field; v2's CTA renders `err.message`, so the fallback has to be
 * resolved before it leaves here.
 */
async function startNegotiation(body: Record<string, unknown>): Promise<StartResponse> {
  try {
    return await api.post<StartResponse>("/negotiations/start", body);
  } catch (err) {
    if (err instanceof ApiError && !err.message) {
      throw new Error(err.code ?? "Couldn't start the negotiation. Try again.");
    }
    throw err;
  }
}

interface BuyerLandingV2Props {
  listing: ListingDetail;
  user: ViewerInfo | null;
  isOwner: boolean;
  from?: Origin;
  /** Rendered below the fold, inside the page — so it clears the sticky bar. */
  footerSlot?: React.ReactNode;
}

export function BuyerLandingV2({ listing, user, isOwner, from, footerSlot }: BuyerLandingV2Props) {
  const router = useRouter();
  const { track } = useAmplitude();
  const [savedAgents, setSavedAgents] = useState<SavedAgentOption[]>([]);
  /**
   * Durable memory saved ON each agent, kept beside the picker options rather
   * than inside them: the picker has no use for it, but `onStart` does — a
   * reused agent has to carry the deal-breakers it was saved with even when
   * this visit's chat was never opened.
   */
  const [savedMemory, setSavedMemory] = useState<
    Record<string, NegotiationAgentBuilderMemory | undefined>
  >({});
  const [briefMemory, setBriefMemory] = useState<NegotiationAgentBuilderMemory | null>(null);

  // Guests have no saved agents; skipping the call also avoids a guaranteed 401.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    listNegotiationAgents("buyer")
      .then((rows) => {
        if (!alive) return;
        const options: SavedAgentOption[] = [];
        const memory: Record<string, NegotiationAgentBuilderMemory | undefined> = {};
        for (const row of rows) {
          // System rows are the presets themselves — the panel already offers
          // those. This section is only the buyer's own agents.
          if (row.isSystem) continue;
          const agent = rowToNegotiationAgent(row);
          // Same fallback chain as `resolveEffectivePreset`, default included:
          // an agent saved without a base preset must still be offerable, not
          // silently missing from the buyer's own list.
          const presetId = agent.negotiationAgentPresetId ?? agent.basePresetId ?? "balancer";
          options.push({
            id: agent.id,
            name: agent.name,
            emoji: agent.emoji ?? null,
            presetId,
            // Only a customized agent carries weights; without them the
            // selection resolves to the bare preset, which is correct.
            strategy: agent.weights
              ? ({
                  weights: { ...agent.weights },
                  ...(agent.engineParams ?? {}),
                } as StrategyOverride)
              : undefined,
          });
          memory[agent.id] = agent.builderChatMemory as NegotiationAgentBuilderMemory | undefined;
        }
        setSavedAgents(options);
        setSavedMemory(memory);
      })
      .catch(() => {
        // Non-fatal: the panel's presets still let a buyer start.
      });
    return () => {
      alive = false;
    };
  }, [user]);

  async function handleStart(selection: AgentSelection, strategy: StrategyOverride | null) {
    const presetId = selection.kind === "preset" ? selection.id : selection.presetId;
    const savedId = selection.kind === "saved" ? selection.id : null;

    const res = await startNegotiation({
      listing_public_id: listing.publicId,
      negotiation_agent_preset_id: presetId,
      agent_weights: strategy?.weights,
      // Sparse by design: absent knobs resolve from the preset server-side, so
      // an untuned pick sends no overrides at all rather than a full copy of
      // the preset's own numbers.
      agent_overrides: strategy ? { ...strategy } : undefined,
      // This visit's briefing wins; otherwise the memory saved on the reused
      // agent, so picking "My iPhone hunter" still carries its deal-breakers.
      negotiation_agent_builder_memory:
        briefMemory ?? (savedId ? savedMemory[savedId] : undefined) ?? undefined,
    });

    // Stash the guest buyer id for the post-signup claim step. Logged-in
    // callers never receive one, so this is a no-op for them.
    if (res.guest_buyer_id) {
      try {
        const KEY = "haggle:guest-buyer-ids";
        const raw = window.localStorage.getItem(KEY);
        const list: string[] = raw ? JSON.parse(raw) : [];
        if (!list.includes(res.guest_buyer_id)) {
          list.push(res.guest_buyer_id);
          window.localStorage.setItem(KEY, JSON.stringify(list));
        }
      } catch {
        // localStorage full or disabled — fall through.
      }
    }

    track("Negotiation Started", {
      public_id: listing.publicId,
      agent_preset: presetId,
      has_negotiation_agent_builder_memory: !!briefMemory,
    });

    storeNegotiationRunToken(res.session_id, res.run_token);
    router.push(`/buy/negotiations/${res.session_id}`);
  }

  return (
    <ListingDetailV2
      listing={listing}
      viewer={user}
      isOwner={isOwner}
      footerSlot={footerSlot}
      savedAgents={savedAgents}
      briefHintCount={countHints(briefMemory)}
      headerSlot={
        <>
          {user ? (
            <Nav userEmail={user.email} userName={user.name} userAvatarUrl={user.avatarUrl} />
          ) : (
            <nav className="fixed inset-x-0 top-0 z-50 h-14 border-line border-b bg-surface/80 backdrop-blur-md">
              <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-4 sm:px-6">
                <span className="font-bold text-ink text-lg">Haggle</span>
                <a
                  href="/sign-in"
                  className="font-medium text-ink-secondary text-sm transition-colors hover:text-ink"
                >
                  Sign in
                </a>
              </div>
            </nav>
          )}
          {/* Clears the fixed nav. Always rendered, back link or not: without
              it the photo starts underneath the bar. Matches v1's offsets —
              the app nav is desktop-only, the guest bar is not. */}
          <div className={`mx-auto max-w-7xl px-4 sm:px-6 ${user ? "pt-8 md:pt-24" : "pt-[88px]"}`}>
            {/* mb-6 matches v1 — the wrapper's padding only clears the fixed
                nav, so without this the link sits flush against the photo. */}
            {from && (
              <BackLink href={ORIGIN_HREF[from]} className="mb-6">
                {ORIGIN_LABEL[from]}
              </BackLink>
            )}
          </div>
        </>
      }
      chatSlot={({ preset, onStrategyUpdate }) => (
        // biome-ignore lint/a11y/useValidAriaRole: "role" is a NegotiationAgentBuilderChat prop (buyer/seller), not an ARIA role
        <NegotiationAgentBuilderChat
          agent={preset}
          listingPublicId={listing.publicId}
          listingTitle={listing.title}
          listingCategory={listing.category}
          listingPrice={listing.targetPrice}
          listingCondition={listing.condition}
          listingTags={listing.tags ?? undefined}
          listingDescription={listing.description}
          sellerRequiredCriteria={listing.sellerRequiredCriteria ?? undefined}
          role="buyer"
          variant="bare"
          density="compact"
          onNegotiationAgentBuilderMemoryUpdate={setBriefMemory}
          // ChatStrategy is a superset of StrategyOverride (weights + the four
          // behaviour curves), so an LLM turn feeds the page override directly
          // and morphs the drawer's dials.
          onStrategyUpdate={onStrategyUpdate}
        />
      )}
      onStart={handleStart}
    />
  );
}

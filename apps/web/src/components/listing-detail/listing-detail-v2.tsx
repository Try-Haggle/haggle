"use client";

import type { NegotiationAgentPreset } from "@haggle/shared";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { ArrowRight, Info } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button, Drawer } from "@/components/ui";
import { buttonVariants } from "@/components/ui/button";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/cn";
import { formatPrice, formatTimeAgo } from "@/lib/format";
import type { SavedAgentOption } from "./agent-picker";
import { AgentPicker, type AgentSelection, resolveSelectedPreset } from "./agent-picker";
import { AskingPrice } from "./asking-price";
import { Countdown } from "./countdown";
import { ItemFacts, ItemPhoto } from "./item-evidence";
import { DURATION, EASE, riseIn, staggerGroup } from "./motion";
import { NegotiatorPanel } from "./negotiator-panel";
import { OpponentCard } from "./opponent-card";
import { RequiredQuestions } from "./required-questions";
import type { ListingDetail, StrategyOverride, ViewerInfo } from "./types";

/**
 * Listing Detail v2.
 *
 * The page's job is not "show a product" — it is "set up a negotiation". Three
 * things have to be legible together for that to land: what is being contested,
 * who is on the other side, and who fights for you. In v1 those sat roughly two
 * thousand pixels apart, so the matchup was never visible as a matchup and the
 * CTA lived below four screens of agent-builder.
 *
 * Here the two columns get one job each — the item on the left, the
 * negotiation on the right:
 *
 *   LEFT  · the item          photo → title & deadline → specs & description
 *   RIGHT · the negotiation   asking price → who you're up against
 *                             → who you're sending → go
 *
 * The asking price sits on the right, not with the item: it is a negotiation
 * fact — an opening position — so it belongs at the top of the same rail
 * whose bottom is the button that acts on it. That rail also reads as a
 * sibling of the Agent Studio's identity panel — same job, same grammar.
 *
 * Layout is an asymmetric two-column grid with explicit placement, so the
 * reading order can differ per breakpoint while DOM order still matches what
 * is on screen:
 *
 *   desktop   col 1: item, then facts       col 2: negotiation (rows 1–2)
 *   mobile    photo → title → facts → negotiation rail
 */

interface ListingDetailV2Props {
  listing: ListingDetail;
  viewer: ViewerInfo | null;
  isOwner?: boolean;
  savedAgents?: SavedAgentOption[];
  /** Rendered above the content — the app nav, or a minimal guest header. */
  headerSlot?: React.ReactNode;
  /** Rendered below the fold (similar listings, etc). */
  footerSlot?: React.ReactNode;
  /**
   * The briefing conversation (the LLM agent-builder chat).
   *
   * Rendered inside a drawer rather than inline in the decision column: it
   * carries a message list, quick replies and a budget slider, none of which
   * survive a 400px column, and its own scroll would fight the page's. The
   * consumer owns the chat because it owns what the chat produces — the
   * builder memory that gets posted with the negotiation.
   *
   * A render prop rather than a node: the chat is briefing a *specific* agent,
   * and the selection lives here. Only called once one is picked. Wire the
   * chat's strategy callback into `onStrategyUpdate` — that is what lets the
   * conversation morph the radar and the drawer's weight dials.
   */
  chatSlot?: (args: {
    preset: NegotiationAgentPreset;
    onStrategyUpdate: (strategy: StrategyOverride) => void;
  }) => React.ReactNode;
  /** Hints captured by the chat so far; drives the picker's briefed state. */
  briefHintCount?: number;
  /** Delivery address / carrier setup, rendered in the decision rail. */
  setupSlot?: React.ReactNode;
  /** When false, Start scrolls to the delivery setup instead of posting. */
  canStart?: boolean;
  /** Starts the negotiation with whatever the buyer tuned on top of the
   *  preset (drawer dials or chat) — null when the preset is untouched. */
  onStart?: (selection: AgentSelection, strategy: StrategyOverride | null) => Promise<void>;
}

/** Stable key for per-selection override storage. */
function selectionOverrideKey(selection: AgentSelection): string {
  return `${selection.kind}:${selection.id}`;
}

/** Preset with this page's strategy overrides merged on top. The spread order
 *  does the sparseness: any knob absent from the override resolves from the
 *  preset, so the merged object stays a complete NegotiationAgentPreset. */
function mergeOverride(
  preset: NegotiationAgentPreset,
  override: StrategyOverride | undefined,
): NegotiationAgentPreset {
  if (!override) return preset;
  const { weights, ...knobs } = override;
  const defined = Object.fromEntries(
    Object.entries(knobs).filter(([, value]) => value !== undefined),
  );
  return { ...preset, ...defined, weights: { ...weights } };
}

export function ListingDetailV2({
  listing,
  viewer,
  isOwner = false,
  savedAgents = [],
  headerSlot,
  footerSlot,
  chatSlot,
  briefHintCount = 0,
  setupSlot,
  canStart = true,
  onStart,
}: ListingDetailV2Props) {
  const [selection, setSelection] = useState<AgentSelection | null>(null);
  const [status, setStatus] = useState<"idle" | "starting" | "error">("idle");
  const [message, setMessage] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  /**
   * The panel edits a DRAFT selection, committed when it closes.
   *
   * With one shared selection, picking agents inside the drawer visibly
   * re-arranged the dimmed page behind it — tiles re-highlighting, the card
   * swapping — which read as the page moving on its own. An open overlay is
   * its own workspace; the page behind should update exactly once, when you
   * land back on it. Closing always commits (no cancel semantics): nothing
   * done in the panel is destructive, so a discard step would only add a
   * question nobody asked.
   */
  const [panelDraft, setPanelDraft] = useState<AgentSelection | null>(null);
  // Strategy tuned on this page (drawer dials or briefing chat), kept per
  // selection so switching agents and back never loses a tune.
  const [overrides, setOverrides] = useState<Record<string, StrategyOverride>>({});
  // Matches the `lg:` breakpoint the two-column layout switches on.
  const isCompact = useMediaQuery("(max-width: 1023px)");

  /**
   * The sticky bar's real height, so the page can end above it.
   *
   * It was a hardcoded `pb-*` before, which is a guess at something that
   * changes: the bar grows a line for the chosen agent, another for the
   * guest note, another for an error. The guess was 64px against a 69px bar,
   * so the last line of the description sat 5px behind it — and any new line
   * in the bar would have broken it again, silently. Measuring is the only
   * version of this that cannot drift.
   */
  const barRef = useRef<HTMLDivElement | null>(null);
  const [barHeight, setBarHeight] = useState(0);
  useEffect(() => {
    const node = barRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setBarHeight(Math.ceil(entry.contentRect.height)),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  /**
   * Everything a surface needs to present a selection, derived in one place.
   * The rail/sticky/CTA read the COMMITTED selection; the panel (and the chat
   * inside it) read the draft while open. `named` is the preset re-labeled
   * with a saved agent's own name/emoji — without it, picking "Careful
   * checker" produced a chat introducing itself as "Cautious Verifier". The
   * rail card still uses `merged` (un-renamed): its "Based on …" line needs
   * the base archetype's name.
   */
  function deriveView(sel: AgentSelection | null) {
    const key = sel ? selectionOverrideKey(sel) : null;
    const saved0 = sel?.kind === "saved" ? savedAgents.find((a) => a.id === sel.id) : undefined;
    // A saved agent starts from the tuning it was saved with; page edits layer
    // on top. "Reset to preset" then means the bare archetype, which is the
    // meaning the label promises.
    const override = key ? (overrides[key] ?? saved0?.strategy ?? null) : null;
    const base = resolveSelectedPreset(sel);
    const merged = base ? mergeOverride(base, override ?? undefined) : undefined;
    const saved = sel?.kind === "saved" ? savedAgents.find((a) => a.id === sel.id) : undefined;
    const named =
      merged && saved
        ? {
            ...merged,
            emoji: saved.emoji ?? merged.emoji,
            copy: { ...merged.copy, buyer: { ...merged.copy.buyer, name: saved.name } },
          }
        : merged;
    return { key, override, merged, named };
  }

  const committed = deriveView(selection);
  const panelSelection = panelOpen ? panelDraft : selection;
  const panel = panelOpen ? deriveView(panelDraft) : committed;
  const askingPrice = Number(listing.targetPrice ?? 0);
  const sold = listing.holdState === "sold";

  function openPanel() {
    setPanelDraft(selection);
    setPanelOpen(true);
  }

  function closePanel() {
    setSelection(panelDraft);
    setPanelOpen(false);
    if (status === "error") setStatus("idle");
  }

  /** Panel edits write to the DRAFT's override slot. */
  function applyOverride(next: StrategyOverride) {
    if (!panel.key) return;
    const key = panel.key;
    setOverrides((prev) => ({ ...prev, [key]: next }));
  }

  function clearOverride() {
    if (!panel.key) return;
    const key = panel.key;
    setOverrides((prev) => {
      const { [key]: _dropped, ...rest } = prev;
      return rest;
    });
  }

  /** Tile taps toggle: picking a different agent switches, tapping the
   *  current one deselects. The rail commits immediately; the panel edits its
   *  draft — same feel, different target. */
  function handleSelectToggle(next: AgentSelection) {
    setSelection((current) =>
      current && current.kind === next.kind && current.id === next.id ? null : next,
    );
    if (status === "error") setStatus("idle");
  }

  function handlePanelToggle(next: AgentSelection) {
    setPanelDraft((current) =>
      current && current.kind === next.kind && current.id === next.id ? null : next,
    );
  }

  function focusSetup() {
    document.getElementById("delivery-setup")?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }

  async function handleStart() {
    if (sold || !selection || !onStart) return;
    if (!canStart) {
      focusSetup();
      return;
    }
    setStatus("starting");
    setMessage("Preparing your agent…");
    try {
      await onStart(selection, committed.override);
    } catch (err) {
      setStatus("error");
      setMessage(
        err instanceof Error
          ? err.message
          : "Couldn't reach Haggle. Check your connection and try again.",
      );
    }
  }

  return (
    /**
     * `reducedMotion="user"` is the whole reduced-motion strategy for this
     * subtree, and it replaced a hand-rolled one that was subtly broken:
     * branching `initial` on `useReducedMotion()` reads a media query the
     * server cannot see, so a reduced-motion visitor hydrated against markup
     * that assumed full motion and React reported a mismatch. Framer strips
     * transform and layout animation for those users on its own, after mount,
     * which keeps the first render identical on both sides.
     */
    <MotionConfig reducedMotion="user">
      {/* The bar's clearance lives here, not on the content column: whatever a
          host hangs off `footerSlot` (similar listings) renders after that
          column and would otherwise end up behind the bar. */}
      <main
        className="min-h-screen bg-surface"
        style={isOwner ? undefined : { paddingBottom: `calc(${barHeight}px + 1.5rem)` }}
      >
        {headerSlot}

        {/* Owners get plain padding — no bar renders for them, so reserving
            room for one would only be dead space. */}
        <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
          {/* Two columns, two jobs: the LEFT column is the item (photo first —
              the marketplace instinct — then title, then the evidence), the
              RIGHT rail is the negotiation (price and its room to move, the
              opponent, your agent, go). The asking price lives on the right
              because it is a negotiation fact, not an item fact: it sits at
              the top of the same column whose bottom is the button that acts
              on it. `grid-rows-[auto_1fr]` keeps the facts cell snug under
              the item cell while the rail spans both rows. */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-[auto_1fr] lg:gap-x-12 lg:gap-y-8">
            {/* ── The item (desktop col 1 row 1) ── */}
            <motion.div
              className="lg:col-start-1 lg:row-start-1 lg:self-start"
              variants={staggerGroup(0.08)}
              initial="hidden"
              animate="visible"
            >
              <motion.div variants={riseIn}>
                <ItemPhoto listing={listing} />
              </motion.div>

              <motion.header variants={riseIn} className="mt-5">
                <h1 className="font-bold text-2xl text-ink leading-tight tracking-tight sm:text-3xl">
                  {listing.title}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-muted">
                  <span>Listed {formatTimeAgo(listing.publishedAt)}</span>
                  {listing.sellingDeadline && (
                    <>
                      <span aria-hidden="true">·</span>
                      <Countdown deadline={listing.sellingDeadline} />
                    </>
                  )}
                </div>
              </motion.header>
            </motion.div>

            {/* ── Evidence · facts ──
                Sits before the rail in the DOM so a phone reads item → facts →
                negotiation: what is being sold, then what to do about it. On
                desktop the cell is placed explicitly (col 1, row 2), so its
                position there does not depend on this order. Moving it with an
                `order-*` class instead would leave keyboard and screen-reader
                users on the old sequence. */}
            <ItemFacts listing={listing} className="lg:col-start-1 lg:row-start-2 lg:self-start" />

            {/* ── The negotiation rail (desktop col 2, spanning both rows) ── */}
            <motion.aside
              className="lg:col-start-2 lg:row-span-2 lg:row-start-1"
              variants={staggerGroup(0.08)}
              initial="hidden"
              animate="visible"
            >
              {/* ① The seller's opening position — desktop only.
                  On a phone the sticky bar carries the price from the moment
                  the page opens, so printing it again at the top of the rail
                  put the same number on screen twice. The bar is the mobile
                  home for it; the rail keeps it where there is no bar. */}
              <div className="hidden lg:block">
                <motion.div variants={riseIn}>
                  <AskingPrice
                    amount={askingPrice}
                    isOwner={isOwner}
                    holdState={listing.holdState}
                  />
                </motion.div>
              </div>

              {/* Outside the hidden block on purpose. On desktop it closes the
                  asking-price section; on mobile, where that section is gone,
                  it is what separates the item's facts from the negotiation —
                  without it the rail's first section ran straight on from the
                  seller's description. Every rail section is divided the same
                  way, so this one should not be the exception.

                  `mt-0` on mobile because there it is the rail's first child,
                  so the grid's own row gap already sits above it — keeping the
                  default top margin stacked the two into 48px above the line
                  against 24px below, which is what made it read as adrift. */}
              <Divider className="mt-0 lg:mt-6" />

              {/* ② Who you're up against — or, for the owner, who represents them */}
              <motion.div variants={riseIn}>
                <OpponentCard presetId={listing.sellerAgentPreset} isOwner={isOwner} />
              </motion.div>

              {/* ②½ What must be settled — a fact about the deal, not the
                  opponent, so it gets its own section and divider like every
                  other rail section. Renders nothing when the seller set no
                  required checks. */}
              {(listing.sellerRequiredCriteria?.length ?? 0) > 0 && (
                <>
                  <Divider />
                  <motion.div variants={riseIn}>
                    <RequiredQuestions
                      criteria={listing.sellerRequiredCriteria ?? []}
                      isOwner={isOwner}
                    />
                  </motion.div>
                </>
              )}

              {/* ③ Who you're sending — buyers only. An owner cannot start a
                  negotiation on their own listing, so a buyer-agent picker
                  here is a control that leads nowhere: it opens a panel, takes
                  a configuration, and the CTA below still refuses. Saved
                  agents are account-level and belong on /buy/agents. */}
              {!isOwner && (
                <>
                  <Divider />
                  <motion.div variants={riseIn}>
                    <AgentPicker
                      selection={selection}
                      // Committed view only — while the panel is open its draft
                      // stays inside; the rail updates once, on close.
                      presetOverride={committed.merged}
                      onSelect={handleSelectToggle}
                      savedAgents={savedAgents}
                      onOpenPanel={openPanel}
                      briefHintCount={briefHintCount}
                      openRequirementCount={
                        briefHintCount > 0 ? 0 : (listing.sellerRequiredCriteria?.length ?? 0)
                      }
                    />
                  </motion.div>
                </>
              )}

              {!isOwner && setupSlot && (
                <>
                  <Divider />
                  <motion.div variants={riseIn} id="delivery-setup">
                    {setupSlot}
                  </motion.div>
                </>
              )}

              {/* ④ Go — owners only.
                  A buyer's action lives in the sticky bar on every breakpoint
                  now, so putting a second Start button in the rail would have
                  meant two controls for one deal. It also retires a button
                  that could only ever appear disabled here: before an agent is
                  picked there is nothing to start, and a greyed-out primary is
                  a dead end at exactly the moment the user needs the picker.
                  The bar says "Pick an agent" instead and opens it.

                  Owners keep theirs: no bar renders for them, so hiding this
                  would leave them with no action at all. */}
              {isOwner && (
                <motion.div variants={riseIn} className="mt-6">
                  <Link
                    href={`/sell/listings/${listing.publicId}`}
                    className={buttonVariants({ size: "lg", fullWidth: true })}
                  >
                    Manage this listing
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>

                  <p className="mt-2.5 flex items-center justify-center gap-1.5 text-center text-[11.5px] text-ink-muted">
                    <Info className="size-3 shrink-0" aria-hidden="true" />
                    Your listing — buyers negotiate against the agent above.
                  </p>
                </motion.div>
              )}
            </motion.aside>
          </div>
        </div>

        {footerSlot}

        {/* The negotiator panel — a right drawer on desktop, a bottom sheet on
            mobile, both from the shared Drawer (focus trap, Escape, scroll
            lock). ALL agent configuration lives here — base preset, saved
            agents, weight dials, the advanced knobs, and the briefing chat —
            so the rail stays minimal. Closing lands back on the rail card as
            its radar morphs to whatever was just tuned. */}
        <Drawer
          open={panelOpen}
          onClose={closePanel}
          side={isCompact ? "bottom" : "right"}
          title="Your negotiator"
        >
          <div className="h-full">
            <NegotiatorPanel
              selection={panelSelection}
              onSelect={handlePanelToggle}
              savedAgents={savedAgents}
              effective={panel.named}
              override={panel.override}
              onOverrideChange={applyOverride}
              onResetOverride={clearOverride}
              chatSlot={
                panel.named && chatSlot
                  ? chatSlot({ preset: panel.named, onStrategyUpdate: applyOverride })
                  : undefined
              }
            />
          </div>
        </Drawer>

        {/* Sticky action bar — the answer to a CTA that scrolls away. */}
        <AnimatePresence>
          {!isOwner && (
            <motion.div
              ref={barRef}
              initial={{ y: "100%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0 }}
              transition={{ duration: DURATION.base, ease: EASE.standard }}
              className="fixed inset-x-0 bottom-0 z-40 border-line border-t bg-surface-overlay/92 backdrop-blur-md"
            >
              {/* On mobile the rail's CTA — and the error line under it — is
                  gone, so a failed start would otherwise say nothing at all. */}
              {status === "error" && (
                <p
                  role="alert"
                  className="mx-auto max-w-7xl px-4 pt-2.5 text-center text-[12px] text-error sm:px-6"
                >
                  {message}
                </p>
              )}
              <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
                {/* The price and who you are sending — nothing else. The title
                    used to sit under the price, but it is the one fact a reader
                    on this page already has, and it pushed the agent (which
                    changes with your choice) into a cramped inline append. */}
                <div className="min-w-0 flex-1">
                  {/* On a page whose whole premise is that this number moves, a
                      bare figure next to a Start button is ambiguous — asking
                      price, current offer, or what you pay? The rail's own
                      label answers that above the fold; the bar repeats it. */}
                  <p className="truncate text-label text-ink-muted">Asking price</p>
                  <p className="truncate font-semibold text-[15px] text-ink">
                    {formatPrice(askingPrice)}
                  </p>
                  {/* Guests arriving from a shared link are the most common
                      first impression here, and "do I need an account?" is the
                      first thing that stops them. It used to sit under the
                      rail's CTA; the bar inherited the answer with it.
                      Signed-in buyers get nothing extra — the chosen agent is
                      already named on the button's own side of the page. */}
                  {!viewer && (
                    <p className="truncate text-[11.5px] text-ink-muted">
                      No account needed to start.
                    </p>
                  )}
                </div>
                {/* With no agent chosen the bar's job is to hand you the
                    negotiator panel, not to sit there greyed out. A disabled
                    button here is a dead end at exactly the moment the user is
                    furthest from the control they need. */}
                <Button
                  loading={status === "starting"}
                  disabled={sold}
                  onClick={
                    sold ? undefined : !selection ? openPanel : canStart ? handleStart : focusSetup
                  }
                  className="shrink-0"
                >
                  {sold
                    ? "Sold"
                    : !selection
                      ? "Pick an agent"
                      : canStart
                        ? "Start negotiation"
                        : "Add a delivery address"}
                  {!sold && <ArrowRight className="size-4" aria-hidden="true" />}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </MotionConfig>
  );
}

/** Hairline between decision-column steps. Keeps the narrative sectioned
 *  without boxing every step in its own card, which would flatten hierarchy. */
function Divider({ className }: { className?: string }) {
  return <div className={cn("my-6 h-px bg-line-subtle", className)} />;
}

"use client";

import type {
  CategoryChoiceQuestion,
  ChatStrategy,
  CheckAnswerOption,
  NegotiationAgentPreset,
} from "@haggle/shared";
import { buildBuyerChoiceQuestions, buildSellerChoiceQuestions } from "@haggle/shared";
import { ChevronLeft, ChevronRight, RotateCcw, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import {
  Badge,
  Button,
  ChatBubble,
  IconButton,
  MessageList,
  Slider,
  TypingIndicator,
} from "@/components/ui";
import { ApiError, apiClient } from "@/lib/api-client";
import { isSubmitEnter } from "@/lib/keyboard";
import { fetchBuilderThread, saveBuilderThread } from "@/lib/negotiation-agents-api";

/* ─── Types ───────────────────────────────────────────────── */

interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  timestamp: number;
  widget?: "budget-slider";
  /**
   * Set on a failed turn: the message to send again. The builder turn is stateless —
   * the whole conversation is re-sent each time — so a retry recovers completely.
   * Without it a failure forced the user to retype what they had just said.
   */
  retryText?: string;
}

export interface NegotiationAgentBuilderMemory {
  categoryInterest: string;
  budgetMax?: number;
  targetPrice?: number;
  mustHave: string[];
  avoid: string[];
  /** Negotiation-facing signals (seller side primarily). Optional for back-compat. */
  dealBreakers?: string[];
  mustEmphasize?: string[];
  notes?: string[];
  /** Phase G taxonomy-keyed criteria (deterministic layer). Optional for back-compat. */
  categoryCriteria?: Array<{
    checkId: string;
    questionKo: string;
    buyerAskKo?: string;
    enforcement: "hard" | "soft";
    requirement: "required" | "optional";
    stance?: string;
  }>;
  urgency?: string;
  riskStyle: "safe_first" | "balanced" | "lowest_price";
  negotiationStyle: "defensive" | "balanced" | "aggressive";
  openingTactic: "condition_anchor" | "fair_market_anchor" | "speed_close";
  questions: string[];
  source: string[];
}

interface StrategyChip {
  label: string;
  value: string;
  category: "pricing" | "style" | "preference" | "constraint";
}

interface NegotiationAgentBuilderChatProps {
  agent: NegotiationAgentPreset | null;
  /**
   * Persist the conversation server-side under this key, and restore it from
   * there. The Agent Studio passes its thread key; the listing page leaves it
   * off, since a buyer tuning an agent for one listing is mid-flow and the
   * local copy is enough. Requires a signed-in user — the endpoint is
   * authenticated, and the calls fail soft when it is not.
   */
  serverThreadKey?: string;
  /** Stable key used for localStorage isolation. On listing pages this is the
   *  listing's publicId; on agent design pages it is an agent-scoped key like
   *  `agent-design:<agentId>`. */
  listingPublicId: string;
  listingTitle: string;
  listingCategory: string | null;
  /** Decimal-dollar string. Null on agent-design pages — the advisor then
   *  receives an empty `listings` array. */
  listingPrice: string | null;
  /** Seller-side floor (decimal string). Omitted on buyer pages — a buyer's
   *  budget is gathered through the chat instead. */
  listingFloorPrice?: string | null;
  /** Listing condition (e.g. "like_new"). */
  listingCondition?: string | null;
  /** Listing tags. */
  listingTags?: string[];
  /** Listing description — passed to the advisor as a seller note for grounding. */
  listingDescription?: string | null;
  /**
   * Phase G Flow 2: the seller's REQUIRED category criteria (buyer-safe: check id +
   * ask). Passed to the buyer builder so it surfaces "the seller requires X" and the
   * buyer mirrors it. Undefined on seller/agent-design pages.
   */
  sellerRequiredCriteria?: Array<{ checkId: string; ask: string }>;
  /** Market median reference (decimal string), when known. */
  listingMarketMedian?: string | null;
  /** Which side the user is on. Drives copy + LLM prompt direction. Default "buyer". */
  role?: "buyer" | "seller";
  /**
   * How the chat frames itself.
   *
   * "card" (default) is the inline form used by the listing page and the seller
   * wizard: its own border, rounded corners, raised background and a top margin,
   * sized by `minHeight`. "bare" drops all of that and fills its parent instead —
   * for when the chat already sits inside a surface that provides the frame, such
   * as a drawer, where the card would read as a box inside a box and would stop
   * short of the panel's height.
   */
  variant?: "card" | "bare";
  /**
   * Type scale + spacing. "compact" shrinks bubbles, the budget widget, and
   * list padding for narrow hosts (the listing page's negotiator drawer);
   * "comfortable" (default) keeps the sizes the wide surfaces use.
   */
  density?: "comfortable" | "compact";
  onNegotiationAgentBuilderMemoryUpdate?: (memory: NegotiationAgentBuilderMemory) => void;
  /** Called when the chat adjusts the radar numbers (4 weights + 4 curves). */
  onStrategyUpdate?: (strategy: ChatStrategy) => void;
}

/* ─── localStorage persistence ───────────────────────────── */

const STORAGE_PREFIX = "haggle:strategy";
const EXPIRY_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

interface PersistedSession {
  memory: NegotiationAgentBuilderMemory;
  messages: ChatMessage[];
  agentId: string;
  updatedAt: number;
}

function storageKey(listingId: string, agentId: string): string {
  return `${STORAGE_PREFIX}:${listingId}:${agentId}`;
}

function agentKey(listingId: string): string {
  return `${STORAGE_PREFIX}:agent:${listingId}`;
}

export function saveSelectedAgent(listingId: string, agentId: string): void {
  try {
    localStorage.setItem(agentKey(listingId), JSON.stringify({ agentId, updatedAt: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function loadSelectedAgentId(listingId: string): string | null {
  try {
    const raw = localStorage.getItem(agentKey(listingId));
    if (!raw) return null;
    const data = JSON.parse(raw) as { agentId: string; updatedAt: number };
    if (Date.now() - data.updatedAt > EXPIRY_MS) {
      localStorage.removeItem(agentKey(listingId));
      return null;
    }
    return data.agentId;
  } catch {
    return null;
  }
}

export function clearSelectedAgent(listingId: string): void {
  try {
    localStorage.removeItem(agentKey(listingId));
  } catch {
    /* ignore */
  }
}

function saveSession(listingId: string, agentId: string, session: PersistedSession): void {
  try {
    localStorage.setItem(storageKey(listingId, agentId), JSON.stringify(session));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

function loadSession(listingId: string, agentId: string): PersistedSession | null {
  try {
    const raw = localStorage.getItem(storageKey(listingId, agentId));
    if (!raw) return null;
    const session: PersistedSession = JSON.parse(raw);
    // Auto-expire after 2 days
    if (Date.now() - session.updatedAt > EXPIRY_MS) {
      localStorage.removeItem(storageKey(listingId, agentId));
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

/**
 * Move every stored conversation from one storage namespace to another.
 *
 * The Agent Studio names a thread's namespace after the roster selection, and
 * a preset thread is re-keyed the moment Save turns it into a real agent. The
 * build and the distilled memory are carried across in React state; without
 * this the transcript would be left behind under the old name and the chat
 * would come back empty right after a successful save — the one moment the
 * user is most sure their work was kept.
 *
 * Namespace-wide rather than per-agent so the caller does not have to know how
 * the inner key is composed. Keys are read up front because the loop writes to
 * the same storage it is walking.
 */
export function moveStoredSessions(fromListingId: string, toListingId: string): void {
  if (fromListingId === toListingId) return;
  try {
    const prefix = `${STORAGE_PREFIX}:${fromListingId}:`;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(prefix)) keys.push(k);
    }
    for (const k of keys) {
      const value = localStorage.getItem(k);
      if (value === null) continue;
      localStorage.setItem(`${STORAGE_PREFIX}:${toListingId}:${k.slice(prefix.length)}`, value);
      localStorage.removeItem(k);
    }
  } catch {
    // Storage unavailable or full: the conversation is a convenience, and the
    // agent's saved memory — the part that changes how it negotiates — is
    // already in the database by the time this runs.
  }
}

/**
 * The conversation stored under a namespace, longest first.
 *
 * Save hands a preset thread's conversation to the agent it just became, and
 * the database write for that hand-off has to happen right then: a preset
 * thread is browser-only while it is being built, so nothing else has a copy.
 * Reading the moved session back is what lets that write be one deliberate
 * call instead of a race with the chat's own debounced mirror.
 *
 * A namespace can hold more than one entry (the inner key is the agent being
 * talked to), so the longest transcript wins rather than whichever the browser
 * happens to enumerate first.
 */
export function readStoredMessages(listingId: string): ChatMessage[] {
  try {
    const prefix = `${STORAGE_PREFIX}:${listingId}:`;
    let longest: ChatMessage[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(prefix)) continue;
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const session = JSON.parse(raw) as PersistedSession;
      if (Array.isArray(session.messages) && session.messages.length > longest.length) {
        longest = session.messages;
      }
    }
    return longest;
  } catch {
    return [];
  }
}

/**
 * Drop every stored conversation past the expiry.
 *
 * `loadSession` expires an entry when it reads one, which is enough for a
 * namespace that gets read again — a listing, a saved agent. A preset thread's
 * namespace is unique to its visit and so is never read again once abandoned,
 * and without a sweep those would be the one thing here that only accumulates.
 */
export function sweepExpiredSessions(): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(`${STORAGE_PREFIX}:`)) continue;
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      try {
        const { updatedAt } = JSON.parse(raw) as { updatedAt?: number };
        if (typeof updatedAt !== "number" || Date.now() - updatedAt > EXPIRY_MS) stale.push(k);
      } catch {
        stale.push(k);
      }
    }
    for (const k of stale) localStorage.removeItem(k);
  } catch {
    // Storage unavailable: nothing to sweep.
  }
}

function clearSession(listingId: string, agentId: string): void {
  try {
    localStorage.removeItem(storageKey(listingId, agentId));
  } catch {
    // silently ignore
  }
}

/* ─── Constants ───────────────────────────────────────────── */

/** Synthetic opener sent once on agent-select so the builder LLM leads with its first
 * question instead of a static greeting. Not shown as a user message. */
const AUTO_OPEN_MESSAGE = "Let's set up this agent for my listing — what should I decide first?";

function buildInitialMemory(
  agent: NegotiationAgentPreset | null,
  category: string | null,
): NegotiationAgentBuilderMemory {
  const negotiationStyle =
    agent?.id === "hunter" ? "aggressive" : agent?.id === "closer" ? "defensive" : "balanced";
  const riskStyle =
    agent?.id === "hunter" ? "lowest_price" : agent?.id === "verifier" ? "safe_first" : "balanced";
  const openingTactic =
    agent?.id === "verifier"
      ? "condition_anchor"
      : agent?.id === "closer"
        ? "speed_close"
        : "fair_market_anchor";

  return {
    categoryInterest: category || "electronics",
    mustHave: [],
    avoid: [],
    riskStyle,
    negotiationStyle,
    openingTactic,
    questions: [],
    source: [],
  };
}

function extractChips(memory: NegotiationAgentBuilderMemory): StrategyChip[] {
  const chips: StrategyChip[] = [];

  if (memory.budgetMax) {
    chips.push({
      label: `Budget $${memory.budgetMax.toLocaleString()}`,
      value: String(memory.budgetMax),
      category: "pricing",
    });
  }
  if (memory.targetPrice) {
    chips.push({
      label: `Target $${memory.targetPrice.toLocaleString()}`,
      value: String(memory.targetPrice),
      category: "pricing",
    });
  }
  for (const item of memory.mustHave) {
    chips.push({ label: `✅ ${item}`, value: item, category: "preference" });
  }
  for (const item of memory.mustEmphasize ?? []) {
    chips.push({ label: `📣 ${item}`, value: item, category: "preference" });
  }
  for (const item of memory.avoid) {
    chips.push({ label: `❌ ${item}`, value: item, category: "constraint" });
  }
  for (const item of memory.dealBreakers ?? []) {
    chips.push({ label: `⛔ ${item}`, value: item, category: "constraint" });
  }

  const styleLabels: Record<string, string> = {
    aggressive: "Aggressive",
    balanced: "Balanced",
    defensive: "Defensive",
  };
  if (memory.negotiationStyle !== "balanced") {
    chips.push({
      label: styleLabels[memory.negotiationStyle] ?? memory.negotiationStyle,
      value: memory.negotiationStyle,
      category: "style",
    });
  }

  return chips;
}

/**
 * ④ Quick-setup taps land only in `memory.categoryCriteria`, which `extractChips`
 * above does not read — so tapping six pills changed nothing on screen, while TYPING
 * the same fact produced a chip. That left the picker looking inert and gave no
 * evidence the answer had been recorded. Surface each tapped answer in the same
 * STRATEGY row, labelled with the option the user actually tapped (matched by check
 * id + stance).
 *
 * Tone follows the OPTION's `requirement`, never the check's `enforcement`: 4 hard
 * checks (title_status, mount_compatibility, stone_natural_lab, isbn_edition_match)
 * carry an explicit waiver such as "Doesn't matter", and painting that as a red
 * deal-breaker would state the opposite of what the user chose.
 */
export function extractCriteriaChips(
  memory: NegotiationAgentBuilderMemory,
  questions: readonly CategoryChoiceQuestion[],
): StrategyChip[] {
  if (questions.length === 0) return [];
  const chips: StrategyChip[] = [];
  for (const criterion of memory.categoryCriteria ?? []) {
    if (!criterion.stance) continue;
    const option = questions
      .find((q) => q.checkId === criterion.checkId)
      ?.options.find((o) => o.stance === criterion.stance);
    // Criteria the LLM set from free text have no matching tappable option; those
    // already surface through mustHave/dealBreakers, so don't invent a chip here.
    if (!option) continue;
    const required = option.requirement === "required";
    chips.push({
      label: `${required ? "⛔" : "✅"} ${option.label}`,
      value: criterion.checkId,
      category: required ? "constraint" : "preference",
    });
  }
  return chips;
}

/* ─── Markdown-lite renderer ─────────────────────────────── */

function renderMarkdownLite(text: string): string {
  // Escape HTML first so user/LLM text can't inject markup — only the
  // **bold** → <strong> and \n → <br> transforms below emit real tags.
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-ink">$1</strong>')
    .replace(/\n/g, "<br />");
}

/* ─── Budget Slider Widget ──────────────────────────────────── */

function BudgetWidget({
  listingPrice,
  onSubmit,
  compact = false,
}: {
  listingPrice: string | null;
  onSubmit: (target: number, max: number) => void;
  compact?: boolean;
}) {
  const basePrice = listingPrice ? parseInt(listingPrice, 10) : 1000;
  const minRange = Math.floor(basePrice * 0.5);
  const maxRange = Math.floor(basePrice * 1.5);

  const [target, setTarget] = useState(Math.floor(basePrice * 0.8));
  const [max, setMax] = useState(basePrice);

  return (
    <div
      className={`rounded-xl bg-surface-raised border border-line ${compact ? "mt-2.5 p-3" : "mt-4 p-4"}`}
    >
      <div className={`flex justify-between items-center ${compact ? "mb-3" : "mb-5"}`}>
        <div className="text-center">
          <p className="text-[10px] font-bold text-ink-muted uppercase tracking-wider mb-1">
            Target price
          </p>
          <p className={`font-bold text-action-primary ${compact ? "text-[14px]" : "text-[16px]"}`}>
            ${target.toLocaleString()}
          </p>
        </div>
        <div className="h-[30px] w-[1px] bg-surface-sunken" />
        <div className="text-center">
          <p className="text-[10px] font-bold text-ink-muted uppercase tracking-wider mb-1">
            Max budget
          </p>
          <p className={`font-bold text-action-primary ${compact ? "text-[14px]" : "text-[16px]"}`}>
            ${max.toLocaleString()}
          </p>
        </div>
      </div>

      <div className={`flex flex-col ${compact ? "gap-4 mb-4" : "gap-6 mb-6"}`}>
        <Slider
          aria-label="Target price"
          min={minRange}
          max={maxRange}
          step={10}
          value={target}
          onValueChange={(val) => {
            setTarget(val);
            if (val > max) setMax(val);
          }}
        />
        <Slider
          aria-label="Max budget"
          min={minRange}
          max={maxRange}
          step={10}
          value={max}
          onValueChange={(val) => {
            setMax(val);
            if (val < target) setTarget(val);
          }}
        />
      </div>

      <Button
        variant="primary"
        fullWidth
        size={compact ? "sm" : "md"}
        onClick={() => onSubmit(target, max)}
      >
        Set budget
      </Button>
    </div>
  );
}

/* ─── Chip Category → Badge tone ──────────────────────────── */

const CHIP_TONE: Record<
  StrategyChip["category"],
  "success" | "info" | "warning" | "error" | "neutral"
> = {
  pricing: "success", // green — budget/target
  style: "neutral", // (was cyan; no accent Badge tone — see migration notes)
  preference: "info", // blue — must-haves
  constraint: "error", // red — deal-breakers
};

/* ─── Agent avatar chip (accent-tinted) ───────────────────── */

/**
 * The speaker's mark on an agent message.
 *
 * This was a generic 🤖 for every agent, which read as "some bot" next to a
 * name that says otherwise. The agent has a face; wear it. Falls back to the
 * robot only before a preset is resolved, where there is no face to show.
 */
function AgentIcon({ accent, emoji }: { accent: string; emoji?: string }) {
  return (
    <span
      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px]"
      style={{ backgroundColor: `${accent}22`, color: accent }}
    >
      {emoji ? <AgentAvatar value={emoji} /> : "🤖"}
    </span>
  );
}

/* ─── Main Component ──────────────────────────────────────── */

export function NegotiationAgentBuilderChat({
  agent,
  serverThreadKey,
  listingPublicId,
  listingTitle,
  listingCategory,
  listingPrice,
  listingFloorPrice,
  listingCondition,
  listingTags,
  listingDescription,
  sellerRequiredCriteria,
  listingMarketMedian,
  role = "buyer",
  variant = "card",
  density = "comfortable",
  onNegotiationAgentBuilderMemoryUpdate,
  onStrategyUpdate,
}: NegotiationAgentBuilderChatProps) {
  const side = role;

  // ④+① Multiple-choice + determinism: the item's taxonomy checks that have a
  // canonical answer set, resolved ENTIRELY on the client from the listing's
  // category+tags (no API). Buyer & seller are framed differently (buyer states a
  // requirement, seller states the fact), so each side gets its own question set.
  const choiceQuestions = useMemo<CategoryChoiceQuestion[]>(() => {
    const tags = [listingCategory, ...(listingTags ?? [])].filter(
      (t): t is string => typeof t === "string" && t.length > 0,
    );
    if (tags.length === 0) return [];
    return side === "seller" ? buildSellerChoiceQuestions(tags) : buildBuyerChoiceQuestions(tags);
  }, [side, listingCategory, listingTags]);

  // ① Instant first question: the seller builder used to fire a ~15s LLM turn on
  // arrival just to produce its opener. When the taxonomy already has deterministic
  // questions for this category, we skip that entirely — a static greeting + the
  // quick-setup picker render instantly. The LLM opener only fires for the long tail
  // (a category with no taxonomy checks). Buyer keeps its instant static greeting.
  // `listingPrice` is what makes a listing a listing here — `makeGreeting` uses
  // the same signal to decide between its per-item and standalone openers. Without
  // it this fired on the Agent Studio too, where a seller building a reusable agent
  // waited ~15s for an LLM to invent an opener about an item that does not exist,
  // and got a different one every time. The static greeting already covers that
  // case; the LLM opener is only for a real listing whose category has no
  // taxonomy checks to ask from.
  const autoOpenFirst = side === "seller" && !!listingPrice && choiceQuestions.length === 0;

  // Current radar numbers, sent so the LLM adjusts from them (not invents).
  const buildCurrentStrategy = useCallback((): ChatStrategy | undefined => {
    if (!agent) return undefined;
    return {
      weights: { ...agent.weights },
      alpha: agent.alpha,
      beta: agent.beta,
      u_threshold: agent.u_threshold,
      u_aspiration: agent.u_aspiration,
    };
  }, [agent]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  /**
   * Which quick-setup question the strip is showing.
   *
   * The picker used to render every question at once, in a `shrink-0` block
   * that took its height straight out of the message list. That is fine for a
   * car seat (3 checks) and ruinous for an RV (11, eight of them
   * deal-breakers): measured in the listing drawer, the chat was left 4% of
   * the pane and the composer was pushed off the bottom. Capping the block and
   * scrolling inside it only trades that for two stacked scroll areas and a
   * slab that holds its space whether or not you are using it.
   *
   * One question on a fixed strip costs the same height at any N, and the
   * counter states the real total up front instead of implying it by how far
   * the block runs.
   */
  const [choiceIndex, setChoiceIndex] = useState(0);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [memory, setMemory] = useState<NegotiationAgentBuilderMemory>(() =>
    buildInitialMemory(agent, listingCategory),
  );
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasRestoredSession, setHasRestoredSession] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatTopRef = useRef<HTMLDivElement>(null);

  // Apply a tapped option straight to the buyer's criteria — no LLM turn. Upserts the
  // criterion by check id with the option's canonical stance + requirement (the
  // hard⇒required gate is already baked into the option), then persists like a turn.
  const applyChoice = useCallback(
    (question: CategoryChoiceQuestion, option: CheckAnswerOption) => {
      // Compute next from the current memory in the event handler (NOT inside the
      // setState updater) so the parent callback + persist are side effects of the
      // click, never of a render — otherwise React warns about a cross-component
      // setState during render.
      const criteria = [...(memory.categoryCriteria ?? [])];
      const idx = criteria.findIndex((c) => c.checkId === question.checkId);
      const upserted = {
        checkId: question.checkId,
        questionKo: question.questionKo,
        // The criterion keeps the check's real buyer ask (carried on the question),
        // NOT the side-specific display label — `question.question` is sellerAsk on
        // the seller side.
        ...(question.buyerAskKo ? { buyerAskKo: question.buyerAskKo } : {}),
        enforcement: question.enforcement,
        requirement: option.requirement,
        stance: option.stance,
      };
      const wasUnanswered = idx < 0 || !criteria[idx]?.stance;
      if (idx >= 0) criteria[idx] = { ...criteria[idx], ...upserted };
      else criteria.push(upserted);
      // Answering moves you on; CORRECTING does not. Advancing on a re-tap
      // would yank the strip away from the question you came back to fix.
      if (wasUnanswered) setChoiceIndex((i) => i + 1);
      const next = { ...memory, categoryCriteria: criteria };
      setMemory(next);
      onNegotiationAgentBuilderMemoryUpdate?.(next);
      if (agent) {
        saveSession(listingPublicId, agent.id, {
          memory: next,
          messages,
          agentId: agent.id,
          updatedAt: Date.now(),
        });
      }
    },
    [agent, listingPublicId, memory, messages, onNegotiationAgentBuilderMemoryUpdate],
  );

  // Side-aware opening message. Acknowledges prices already provided (e.g. from
  // the listing wizard) so the agent never re-asks what it already knows.
  // Sellers never get the budget-slider (its labels are buyer-oriented).
  function makeGreeting(): { text: string; widget?: "budget-slider" } {
    const agentName = agent?.copy?.[side]?.name ?? "your agent";
    const title = listingTitle || "this listing";
    const askNum = listingPrice ? parseFloat(listingPrice) : null;
    const floorNum = listingFloorPrice ? parseFloat(listingFloorPrice) : null;
    const money = (n: number) => `$${n.toLocaleString()}`;

    // ④ The quick-setup panel renders directly below this bubble, but nothing in the
    // greeting used to point at it — so it read as decoration and people answered in
    // prose what they could have tapped. Name it, and say explicitly that whatever it
    // does NOT cover still belongs in the chat, so the panel never reads as the whole
    // menu of what the agent can be told. Only appended when the panel is really there.
    const hasQuickSetup = choiceQuestions.length > 0;
    const sellerQuickSetup = hasQuickSetup
      ? `\n\nTap through **Quick Setup** below to cover the usual questions for this kind of item. Anything else you want me to know, just type it here.`
      : "";
    const buyerQuickSetup = hasQuickSetup
      ? `\n\nThen tap through **Quick Setup** below for what usually matters on this kind of item. Anything else you want me to know, just type it here.`
      : "";

    if (side === "seller") {
      // No listing context (standalone reusable agent) — price is set per-listing,
      // so never ask for an asking/floor price here. Gather posture instead.
      if (!askNum) {
        // "Build on", not "set up": with no listing this is the Agent Studio,
        // where the roster splits Presets from My agents and a preset is
        // explicitly a starting template. Saying it will be set up framed the
        // archetype as the finished agent, when what the conversation actually
        // does is move away from it.
        return {
          text:
            `We'll build on **${agentName}** for your selling negotiations.` +
            (hasQuickSetup
              ? sellerQuickSetup
              : ` Tell me what you'd emphasize (condition, accessories, rarity), any deal-breakers, and how firmly you like to hold your price.`),
        };
      }
      if (floorNum) {
        return {
          text:
            `I'll set up **${agentName}** to sell **${title}**. You're asking ${money(askNum)} and won't go below ${money(floorNum)}.` +
            (hasQuickSetup
              ? sellerQuickSetup
              : ` Tell me anything to emphasize (condition, accessories) or any deal-breakers.`),
        };
      }
      // Listing exists with an asking price but no floor yet — only the floor is
      // missing, so that question stays in the lead sentence either way.
      return {
        text:
          `I'll set up **${agentName}** to sell **${title}**. You're asking ${money(askNum)}. What's the lowest you'd accept?` +
          (hasQuickSetup ? sellerQuickSetup : ` Also tell me anything to emphasize.`),
      };
    }
    // buyer — only offer the budget slider when there's a concrete listing.
    if (askNum) {
      return {
        text: `I'll help **${agentName}** negotiate **${title}** (listed at ${money(askNum)}). What's your ideal price and the most you'd pay?${buyerQuickSetup}`,
        widget: "budget-slider",
      };
    }
    // No listing context (standalone reusable agent) — budget is per-listing, so
    // skip the budget slider and gather general style/preferences instead.
    return {
      text:
        `We'll build on **${agentName}** for your buying negotiations.` +
        (hasQuickSetup
          ? buyerQuickSetup
          : ` Tell me your must-haves, deal-breakers, and how aggressively you like to negotiate.`),
    };
  }

  const scrollToTop = useCallback(() => {
    setTimeout(() => {
      const el = chatTopRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const navbarOffset = 64;
      const targetY = window.scrollY + rect.top - navbarOffset;
      window.scrollTo({ top: targetY, behavior: "smooth" });
    }, 100);
  }, []);

  /**
   * Adopt the server's copy of this conversation.
   *
   * localStorage is the fast path and paints first; the database is the record
   * that survives another device, another browser, cleared site data and the
   * local two-day expiry. Runs once per thread and only adopts when the server
   * holds more of the conversation than this tab does, so it can restore a
   * thread this browser never saw without ever truncating one in progress.
   */
  const restoredThreadRef = useRef<string | null>(null);
  useEffect(() => {
    if (!serverThreadKey || restoredThreadRef.current === serverThreadKey) return;
    restoredThreadRef.current = serverThreadKey;
    let alive = true;
    void (async () => {
      const thread = await fetchBuilderThread(serverThreadKey);
      if (!alive || !thread?.messages?.length) return;
      setMessages((current) => {
        if (thread.messages.length <= current.length) return current;
        setIsExpanded(true);
        setHasRestoredSession(true);
        return thread.messages as ChatMessage[];
      });
    })();
    return () => {
      alive = false;
    };
  }, [serverThreadKey]);

  /**
   * Mirror the conversation to the server as it grows.
   *
   * One effect rather than a call beside each of the eight places a turn is
   * stored: those already write the local copy, and a future ninth would have
   * been easy to forget. Debounced so a fast exchange writes once, and it
   * sends the whole thread so a dropped request cannot leave a gap.
   */
  useEffect(() => {
    if (!serverThreadKey || messages.length === 0) return;
    const timer = setTimeout(() => {
      void saveBuilderThread({
        key: serverThreadKey,
        messages,
        ...(agent?.id ? { presetId: agent.id } : {}),
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [serverThreadKey, messages, agent?.id]);

  // Load from localStorage or reset when agent changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally re-runs only on agent id / listing change
  useEffect(() => {
    if (!agent) {
      setMessages([]);
      const reset = buildInitialMemory(null, listingCategory);
      setMemory(reset);
      // Keep the parent in sync — otherwise it keeps the previous agent's memory
      // (budget/picks) and would send/publish it under the new selection.
      onNegotiationAgentBuilderMemoryUpdate?.(reset);
      setIsExpanded(false);
      setHasRestoredSession(false);
      return;
    }

    const saved = loadSession(listingPublicId, agent.id);
    // If we have a saved session and it has at least 1 message (the greeting)
    if (saved && saved.messages.length > 0) {
      // Restore previous session
      setMemory(saved.memory);
      setMessages(saved.messages);
      setIsExpanded(true);
      setHasRestoredSession(true);
      onNegotiationAgentBuilderMemoryUpdate?.(saved.memory);
    } else {
      // Fresh start.
      const newMemory = buildInitialMemory(agent, listingCategory);
      setMemory(newMemory);

      if (autoOpenFirst) {
        // Seller: no static greeting — the auto-open effect fires the first LLM turn,
        // whose reply becomes the first bubble (a typing indicator shows meanwhile).
        setMessages([]);
      } else {
        const greeting = makeGreeting();
        setMessages([
          {
            id: "greeting",
            role: "agent",
            text: greeting.text,
            timestamp: Date.now(),
            ...(greeting.widget ? { widget: greeting.widget } : {}),
          },
        ]);
      }
      setIsExpanded(true);
      setHasRestoredSession(false);
    }
    // Always persist agent selection
    saveSelectedAgent(listingPublicId, agent.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent?.id, listingPublicId]);

  // Build the listing context the advisor LLM sees on every turn,
  // so it can ground answers in the actual product/price the buyer is on
  // instead of asking "what are you looking for?".
  const buildAdvisorListings = useCallback(() => {
    const askPriceMinor = listingPrice ? Math.round(parseFloat(listingPrice) * 100) : 0;
    if (!askPriceMinor) return [];
    const floorMinor = listingFloorPrice
      ? Math.round(parseFloat(listingFloorPrice) * 100)
      : askPriceMinor;
    const marketMinor = listingMarketMedian
      ? Math.round(parseFloat(listingMarketMedian) * 100)
      : askPriceMinor;
    return [
      {
        id: listingPublicId,
        title: listingTitle,
        category: listingCategory ?? undefined,
        condition: listingCondition ?? "unknown",
        askPriceMinor,
        floorPriceMinor: floorMinor,
        marketMedianMinor: marketMinor,
        tags: listingTags ?? [],
        ...(listingDescription ? { sellerNote: listingDescription } : {}),
      },
    ];
  }, [
    listingPublicId,
    listingTitle,
    listingCategory,
    listingPrice,
    listingFloorPrice,
    listingMarketMedian,
    listingCondition,
    listingTags,
    listingDescription,
  ]);

  // Auto-open: fire ONE builder turn as soon as an agent is picked so the LLM opens
  // with the first category question, instead of a static greeting the user has to
  // guess how to answer. Tracked per (listing, agent) so it fires once per selection.
  const autoOpenedRef = useRef<string | null>(null);

  /**
   * Run one builder turn for `trimmed`. Split out from `handleSend` so a failed turn can
   * be re-run without re-appending the user's bubble — the message is already in the
   * transcript, and the turn re-sends the full conversation anyway.
   */
  const runTurn = useCallback(
    async (trimmed: string) => {
      setIsLoading(true);
      setIsExpanded(true);

      try {
        const data = await apiClient<{
          memory?: NegotiationAgentBuilderMemory;
          reply?: string;
          strategy?: ChatStrategy;
        }>("/negotiations/agents/builder/chat-turn", {
          method: "POST",
          body: JSON.stringify({
            message: trimmed,
            previous_memory: memory,
            side,
            agent_id: agent?.id ?? "balancer",
            listings: buildAdvisorListings(),
            seller_required_criteria: sellerRequiredCriteria ?? [],
            current_strategy: buildCurrentStrategy(),
          }),
          skipAuth: true,
        });
        const updatedMemory: NegotiationAgentBuilderMemory = data.memory ?? memory;
        setMemory(updatedMemory);
        onNegotiationAgentBuilderMemoryUpdate?.(updatedMemory);
        if (data.strategy) onStrategyUpdate?.(data.strategy);

        const agentMsg: ChatMessage = {
          id: `agent-${Date.now()}`,
          role: "agent",
          text: data.reply ?? "Sorry, could you say that again?",
          timestamp: Date.now(),
        };
        setMessages((prev) => {
          const next = [...prev, agentMsg];
          // Persist to localStorage
          if (agent) {
            saveSession(listingPublicId, agent.id, {
              memory: updatedMemory,
              messages: next,
              agentId: agent.id,
              updatedAt: Date.now(),
            });
          }
          return next;
        });
      } catch (err: unknown) {
        console.error("[negotiation-agent-builder-chat] API error:", err);
        const apiError = err instanceof ApiError ? err : null;
        const errorMsg: ChatMessage = {
          id: `error-${Date.now()}`,
          role: "agent",
          text:
            apiError?.message ??
            apiError?.code ??
            "Couldn't reach Haggle. Check your connection and try again.",
          timestamp: Date.now(),
          retryText: trimmed,
        };
        setMessages((prev) => {
          // Save user messages even on API error (exclude the error msg itself)
          if (agent && prev.length > 1) {
            saveSession(listingPublicId, agent.id, {
              memory,
              messages: prev, // save without the error message
              agentId: agent.id,
              updatedAt: Date.now(),
            });
          }
          return [...prev, errorMsg];
        });
      } finally {
        setIsLoading(false);
      }
    },
    [
      memory,
      agent,
      side,
      listingPublicId,
      onNegotiationAgentBuilderMemoryUpdate,
      onStrategyUpdate,
      buildAdvisorListings,
      buildCurrentStrategy,
      sellerRequiredCriteria,
    ],
  );

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text: trimmed,
      timestamp: Date.now(),
    };

    setMessages((prev) => {
      const next = [...prev, userMsg];
      if (agent) {
        saveSession(listingPublicId, agent.id, {
          memory,
          messages: next,
          agentId: agent.id,
          updatedAt: Date.now(),
        });
      }
      return next;
    });

    setInput("");
    await runTurn(trimmed);
  }, [input, isLoading, memory, agent, listingPublicId, runTurn]);

  /**
   * Re-run a failed turn. Drops the error bubble first so a second failure does not
   * stack, and never re-appends the user's message — it is still in the transcript.
   */
  const handleRetry = useCallback(
    async (errorId: string, text: string) => {
      if (isLoading) return;
      setMessages((prev) => prev.filter((m) => m.id !== errorId));
      await runTurn(text);
    },
    [isLoading, runTurn],
  );

  // Fire the opening turn automatically (no user bubble) so the agent leads with its
  // first question. Silent on error — the greeting stays and the user can still type.
  const autoOpen = useCallback(async () => {
    if (!agent) return;
    setIsLoading(true);
    setIsExpanded(true);
    try {
      const data = await apiClient<{
        memory?: NegotiationAgentBuilderMemory;
        reply?: string;
        strategy?: ChatStrategy;
      }>("/negotiations/agents/builder/chat-turn", {
        method: "POST",
        body: JSON.stringify({
          message: AUTO_OPEN_MESSAGE,
          previous_memory: memory,
          side,
          agent_id: agent.id,
          listings: buildAdvisorListings(),
          seller_required_criteria: sellerRequiredCriteria ?? [],
          current_strategy: buildCurrentStrategy(),
        }),
        skipAuth: true,
      });
      const updatedMemory: NegotiationAgentBuilderMemory = data.memory ?? memory;
      setMemory(updatedMemory);
      onNegotiationAgentBuilderMemoryUpdate?.(updatedMemory);
      if (data.strategy) onStrategyUpdate?.(data.strategy);
      const replyText =
        data.reply?.trim() || "What would you like to emphasize, and any deal-breakers?";
      const agentMsg: ChatMessage = {
        id: `agent-${Date.now()}`,
        role: "agent",
        text: replyText,
        timestamp: Date.now(),
      };
      setMessages((prev) => {
        const next = [...prev, agentMsg];
        saveSession(listingPublicId, agent.id, {
          memory: updatedMemory,
          messages: next,
          agentId: agent.id,
          updatedAt: Date.now(),
        });
        return next;
      });
    } catch (err) {
      // Surface the failure instead of leaving a dead typing indicator.
      console.error("[negotiation-agent-builder-chat] auto-open error:", err);
      const apiError = err instanceof ApiError ? err : null;
      const errorMsg: ChatMessage = {
        id: `autoopen-error-${Date.now()}`,
        role: "agent",
        text:
          apiError?.message ??
          apiError?.code ??
          "I couldn't start automatically. Tell me what to emphasize or anything you won't budge on, and we'll go from there.",
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [
    agent,
    memory,
    side,
    listingPublicId,
    buildAdvisorListings,
    buildCurrentStrategy,
    sellerRequiredCriteria,
    onNegotiationAgentBuilderMemoryUpdate,
    onStrategyUpdate,
  ]);

  // Seller only: trigger the opening LLM turn once per selection, on a fresh (empty)
  // chat. Its reply becomes the first bubble.
  useEffect(() => {
    if (!autoOpenFirst || !agent) return;
    const key = `${listingPublicId}::${agent.id}`;
    if (autoOpenedRef.current === key) return;
    if (hasRestoredSession) {
      autoOpenedRef.current = key; // a restored session already has its turns
      return;
    }
    if (isLoading) return;
    if (messages.length !== 0) return;
    autoOpenedRef.current = key;
    void autoOpen();
  }, [autoOpenFirst, agent, listingPublicId, hasRestoredSession, isLoading, messages, autoOpen]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset deps intentionally fixed; greeting is rebuilt inline and excluded on purpose
  const handleReset = useCallback(() => {
    if (!agent) return;
    clearSession(listingPublicId, agent.id);
    const newMemory = buildInitialMemory(agent, listingCategory);
    setMemory(newMemory);
    setChoiceIndex(0);

    if (autoOpenFirst) {
      // Re-fire the opening LLM turn on the now-empty chat.
      autoOpenedRef.current = null;
      setMessages([]);
    } else {
      const greeting = makeGreeting();
      setMessages([
        {
          id: "greeting",
          role: "agent",
          text: greeting.text,
          timestamp: Date.now(),
          ...(greeting.widget ? { widget: greeting.widget } : {}),
        },
      ]);
    }
    setIsExpanded(true);
    setHasRestoredSession(false);
    scrollToTop();
  }, [agent, listingPublicId, listingCategory, listingTitle, listingPrice, scrollToTop]);

  const handleBudgetSubmit = useCallback(
    async (target: number, max: number) => {
      if (isLoading) return;

      const userText = `My target price is $${target}, and my max budget is $${max}.`;
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        text: userText,
        timestamp: Date.now(),
      };

      // Optimistic memory update
      const updatedMemoryOptimistic = { ...memory, targetPrice: target, budgetMax: max };
      setMemory(updatedMemoryOptimistic);
      onNegotiationAgentBuilderMemoryUpdate?.(updatedMemoryOptimistic);

      setMessages((prev) => {
        // Remove widget from the greeting
        const withoutWidget = prev.map((m) =>
          m.id === "greeting" ? { ...m, widget: undefined } : m,
        );
        const next = [...withoutWidget, userMsg];
        if (agent) {
          saveSession(listingPublicId, agent.id, {
            memory: updatedMemoryOptimistic,
            messages: next,
            agentId: agent.id,
            updatedAt: Date.now(),
          });
        }
        return next;
      });
      setIsLoading(true);

      try {
        const data = await apiClient<{
          memory?: NegotiationAgentBuilderMemory;
          reply?: string;
          strategy?: ChatStrategy;
        }>("/negotiations/agents/builder/chat-turn", {
          method: "POST",
          body: JSON.stringify({
            message: userText,
            previous_memory: updatedMemoryOptimistic,
            side,
            agent_id: agent?.id ?? "balancer",
            listings: buildAdvisorListings(),
            seller_required_criteria: sellerRequiredCriteria ?? [],
            current_strategy: buildCurrentStrategy(),
          }),
          skipAuth: true,
        });

        const updatedMemory: NegotiationAgentBuilderMemory = data.memory ?? updatedMemoryOptimistic;
        setMemory(updatedMemory);
        onNegotiationAgentBuilderMemoryUpdate?.(updatedMemory);
        if (data.strategy) onStrategyUpdate?.(data.strategy);

        const agentMsg: ChatMessage = {
          id: `agent-${Date.now()}`,
          role: "agent",
          text: data.reply ?? "Got it. Any conditions you want to require or avoid?",
          timestamp: Date.now(),
        };
        setMessages((prev) => {
          const next = [...prev, agentMsg];
          if (agent) {
            saveSession(listingPublicId, agent.id, {
              memory: updatedMemory,
              messages: next,
              agentId: agent.id,
              updatedAt: Date.now(),
            });
          }
          return next;
        });
      } catch (err: unknown) {
        console.error("[negotiation-agent-builder-chat] API error:", err);
        const apiError = err instanceof ApiError ? err : null;
        const errorMsg: ChatMessage = {
          id: `error-${Date.now()}`,
          role: "agent",
          text:
            apiError?.message ??
            apiError?.code ??
            "Couldn't reach Haggle. Check your connection and try again.",
          timestamp: Date.now(),
        };
        setMessages((prev) => {
          if (agent && prev.length > 1) {
            saveSession(listingPublicId, agent.id, {
              memory: updatedMemoryOptimistic,
              messages: prev,
              agentId: agent.id,
              updatedAt: Date.now(),
            });
          }
          return [...prev, errorMsg];
        });
      } finally {
        setIsLoading(false);
      }
    },
    [
      isLoading,
      memory,
      agent,
      side,
      listingPublicId,
      onNegotiationAgentBuilderMemoryUpdate,
      onStrategyUpdate,
      buildAdvisorListings,
      buildCurrentStrategy,
      sellerRequiredCriteria,
    ],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isSubmitEnter(e)) {
      e.preventDefault();
      handleSend();
    }
  };

  const chips = [...extractChips(memory), ...extractCriteriaChips(memory, choiceQuestions)];
  const hasAgentSelected = agent !== null;
  const accent = agent?.accentColor ?? "var(--color-action-primary)";

  return (
    <div
      id="negotiation-agent-builder-chat-container"
      ref={chatTopRef}
      className={
        variant === "bare"
          ? "flex h-full min-h-0 flex-col overflow-hidden"
          : "mt-4 flex flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface-raised transition-all duration-300"
      }
      // "bare" takes its height from the surface around it, so a minHeight here
      // would only stop it from filling that surface.
      style={variant === "bare" ? undefined : { minHeight: isExpanded ? "400px" : "200px" }}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-line border-b px-4 py-3">
        {/* The agent's own face, not a speech bubble: the header names who is
            talking, and that it is a conversation is already obvious from the
            conversation. Before an agent is picked there is nobody to show. */}
        {agent && (
          <span
            className="flex size-5 shrink-0 items-center justify-center rounded-full text-[13px]"
            style={{ backgroundColor: `color-mix(in srgb, ${accent} 16%, transparent)` }}
            aria-hidden="true"
          >
            <AgentAvatar value={agent.emoji} />
          </span>
        )}
        <span className="flex-1 font-semibold text-[13px]" style={{ color: accent }}>
          {agent ? agent.copy[role].name : role === "seller" ? "Selling Agent" : "Buying Agent"}
        </span>
        {messages.length > 1 && (
          <span className="rounded-full border border-action-primary/20 bg-action-primary/10 px-2 py-0.5 font-medium text-[10px] text-action-primary">
            {chips.length} strategy hints
          </span>
        )}
        {/* Reset button */}
        {messages.length > 1 && hasAgentSelected && (
          <button
            type="button"
            onClick={handleReset}
            className="flex h-5 w-5 items-center justify-center rounded text-ink-muted transition-colors duration-150 hover:bg-surface-sunken"
            title="Reset conversation"
            aria-label="Reset strategy chat"
          >
            <RotateCcw size={12} />
          </button>
        )}
      </div>

      {/* Messages area */}
      <MessageList
        className={`min-h-0 flex-1 ${density === "compact" ? "gap-2.5 p-3" : "gap-3 p-4"}`}
      >
        {messages.map((msg) => (
          <ChatBubble
            key={msg.id}
            side={msg.role === "user" ? "right" : "left"}
            className={msg.id !== "greeting" ? "msg-anim" : undefined}
            author={
              msg.role === "agent" ? (
                <span className="flex items-center gap-1.5">
                  <AgentIcon accent={accent} emoji={agent?.emoji} />
                  <span className="font-semibold text-[10px]" style={{ color: accent }}>
                    {agent?.copy[role].name ?? "Agent"}
                  </span>
                </span>
              ) : undefined
            }
          >
            <p
              className={
                density === "compact" ? "text-[12.5px] leading-[1.55]" : "text-[13px] leading-[1.6]"
              }
              style={{
                color: msg.role === "user" ? "var(--color-ink)" : "var(--color-ink-secondary)",
              }}
              // biome-ignore lint/security/noDangerouslySetInnerHtml: intentional sanitized markdown rendering
              dangerouslySetInnerHTML={{
                __html: renderMarkdownLite(msg.text),
              }}
            />

            {msg.widget === "budget-slider" && (
              <BudgetWidget
                listingPrice={listingPrice}
                onSubmit={handleBudgetSubmit}
                compact={density === "compact"}
              />
            )}

            {/* A failed turn is recoverable: the builder is stateless and the whole
                conversation is re-sent, so retrying picks up exactly where it stopped.
                Without this the user had to retype what they had just said. */}
            {msg.retryText && (
              <button
                type="button"
                disabled={isLoading}
                onClick={() => handleRetry(msg.id, msg.retryText as string)}
                className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 font-medium text-[11px] text-ink-secondary transition-colors hover:bg-surface-sunken disabled:opacity-50"
              >
                Try again
              </button>
            )}
          </ChatBubble>
        ))}

        {/* Typing indicator */}
        {isLoading && (
          <ChatBubble side="left" className="msg-anim">
            <span className="flex items-center gap-1.5">
              <AgentIcon accent={accent} emoji={agent?.emoji} />
              <TypingIndicator />
            </span>
          </ChatBubble>
        )}
      </MessageList>

      {/* ④+① Quick-setup: tappable multiple-choice for the item's taxonomy checks.
          Fully client-side/deterministic — a pick sets the criterion with no LLM turn.
          Renders for BOTH sides (buyer requirement-framed, seller fact-framed); only
          checks that carry canonical options appear (hard/deal-breaker first).

          One question at a time, on a strip of fixed height. See {@link choiceIndex}
          for why the whole list is no longer laid out here. The counter is the part
          that has to be honest — "3 / 11" tells you the size of what you agreed to
          before you are eight taps into it. */}
      {choiceQuestions.length > 0 && hasAgentSelected && (
        <QuickSetupStrip
          questions={choiceQuestions}
          index={Math.min(choiceIndex, choiceQuestions.length - 1)}
          onIndexChange={setChoiceIndex}
          answers={memory.categoryCriteria}
          accent={accent}
          onChoose={applyChoice}
        />
      )}

      {/* Input area — bespoke chat composer (flat transparent field); the shared Input is a
          bordered form field and doesn't fit this toolbar. Send is a fixed-CTA IconButton
          (not the agent accent) so action buttons read consistently across the app. */}
      {/* The composer reads as a field rather than a bare line of text: the row
          used to be a transparent input under a hairline, which left nothing
          to aim at. The border and focus ring live on the wrapper so the send
          button sits inside the same field, the way every chat input people
          already use is built. */}
      <div className="shrink-0 border-line border-t bg-surface-overlay p-3">
        {/* The strategy chips sit inside the composer rather than in a band of
            their own. They used to carry a second top border, which stacked
            three hairlines within 50px at the bottom of the pane and made the
            whole column read as bars on bars. They also belong here: they say
            what the agent currently believes, which is exactly the context for
            the message about to be typed. */}
        {chips.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5 overflow-x-auto">
            <span className="mr-1 self-center font-semibold text-[10px] text-ink-muted tracking-wider">
              STRATEGY
            </span>
            {chips.map((chip) => (
              <Badge
                key={`${chip.category}-${chip.value}`}
                tone={CHIP_TONE[chip.category]}
                size="sm"
                className="whitespace-nowrap"
                style={{ animation: "chipIn 0.3s ease-out" }}
              >
                {chip.label}
              </Badge>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 transition-colors focus-within:border-line-strong">
          <input
            ref={inputRef}
            type="text"
            placeholder={
              !hasAgentSelected
                ? "Select an agent first"
                : side === "seller"
                  ? "Tell me what to emphasize, deal-breakers, etc..."
                  : "Tell me your budget, must-haves, etc..."
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!hasAgentSelected || isLoading}
            className="flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-muted outline-none disabled:cursor-not-allowed disabled:opacity-40"
          />
          <IconButton
            variant="solid"
            onClick={handleSend}
            disabled={!input.trim() || isLoading || !hasAgentSelected}
            aria-label="Send message"
            className="size-7 rounded-lg"
          >
            <Send className="size-3.5" />
          </IconButton>
        </div>
      </div>

      {/* Animations */}
      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes chipIn {
          from { opacity: 0; transform: scale(0.9); }
          to { opacity: 1; transform: scale(1); }
        }
        .msg-anim { animation: fadeSlideIn 0.3s ease-out; }
      `}</style>
    </div>
  );
}

/* ─── Quick-setup strip ─────────────────────────────────────────── */

/**
 * The item's taxonomy checks, one at a time on a strip of constant height.
 *
 * Laying all of them out was the bug: the block sits below the message list
 * and above the composer, and it does not shrink, so an eleven-check category
 * consumed the conversation it was meant to support. Height here is the same
 * whether the category carries three checks or eleven — what changes is the
 * counter, which is also the only honest way to state the size of the task
 * before someone is halfway through it.
 *
 * Paging is deliberate rather than automatic-only: answering advances (see
 * `applyChoice`), and the arrows exist for the case that actually happens on a
 * long list — realising two questions later that you mis-tapped one.
 *
 * No progress meter. A bar here lands ten pixels above the composer's own top
 * border and reads as a second hairline more than as a measure, and the strip
 * already sits between two rules in a column this file has twice been rebuilt
 * to keep quiet. The counter carries the same information in text.
 */
function QuickSetupStrip({
  questions,
  index,
  onIndexChange,
  answers,
  accent,
  onChoose,
}: {
  questions: CategoryChoiceQuestion[];
  index: number;
  onIndexChange: (next: number) => void;
  answers: NegotiationAgentBuilderMemory["categoryCriteria"];
  accent: string;
  onChoose: (question: CategoryChoiceQuestion, option: CheckAnswerOption) => void;
}) {
  const question = questions[index];
  if (!question) return null;
  const chosen = answers?.find((c) => c.checkId === question.checkId)?.stance;
  return (
    <div className="shrink-0 border-line border-t bg-surface-overlay px-4 py-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="flex-1 font-semibold text-[10px] text-ink-muted tracking-wider">
          QUICK SETUP
        </span>
        <StepButton
          label="Previous question"
          disabled={index === 0}
          onClick={() => onIndexChange(index - 1)}
        >
          <ChevronLeft className="size-3.5" />
        </StepButton>
        <span className="min-w-10 text-center text-[10.5px] text-ink-muted tabular-nums">
          {index + 1} / {questions.length}
        </span>
        <StepButton
          label="Next question"
          disabled={index === questions.length - 1}
          onClick={() => onIndexChange(index + 1)}
        >
          <ChevronRight className="size-3.5" />
        </StepButton>
      </div>

      {/* The question, and nothing else.
          A "deal-breaker" badge used to sit here, carrying the check's
          taxonomy enforcement. It went for two reasons. It did not change
          anyone's answer — the options say what they mean ("Clean title only"
          / "Salvage OK" / "Doesn't matter"), so you pick what you want, not
          what a label tells you to want. And it could be falsified by the very
          tap it was labelling: choose "Doesn't matter" and the check is no
          longer a deal-breaker, while the badge still says it is. Enforcement
          still orders the set (hard first, see `sortHardFirst`), which is the
          honest way to say "this one matters more" — by asking it earlier. */}
      {/* Two lines are reserved whether or not this question needs them.
          Paging between a one-line and a two-line question otherwise moved the
          strip 24px, which shifts the composer and the whole conversation
          above it — the exact jitter a fixed-height strip exists to prevent.
          Same reason the agent tiles reserve two label lines. */}
      <span className="block min-h-[2.75em] text-[12px] text-ink-secondary leading-snug">
        {question.question}
      </span>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {question.options.map((opt) => {
          const selected = chosen === opt.stance;
          return (
            <button
              key={opt.label}
              type="button"
              onClick={() => onChoose(question, opt)}
              className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${
                selected
                  ? "border-transparent text-white"
                  : "border-line bg-surface-raised text-ink-secondary hover:bg-surface-sunken"
              }`}
              style={selected ? { background: accent } : undefined}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-5.5 items-center justify-center rounded-md border border-line bg-surface-raised text-ink-muted transition-colors hover:bg-surface-sunken disabled:cursor-default disabled:opacity-35 disabled:hover:bg-surface-raised"
    >
      {children}
    </button>
  );
}

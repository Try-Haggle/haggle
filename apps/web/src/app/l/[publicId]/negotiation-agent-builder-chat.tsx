"use client";

import type { ChatStrategy, NegotiationAgentPreset } from "@haggle/shared";
import { MessageSquare, RotateCcw, Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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

/* ─── Types ───────────────────────────────────────────────── */

interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  timestamp: number;
  widget?: "budget-slider";
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
  /** Market median reference (decimal string), when known. */
  listingMarketMedian?: string | null;
  /** Which side the user is on. Drives copy + LLM prompt direction. Default "buyer". */
  role?: "buyer" | "seller";
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

function clearSession(listingId: string, agentId: string): void {
  try {
    localStorage.removeItem(storageKey(listingId, agentId));
  } catch {
    // silently ignore
  }
}

/* ─── Constants ───────────────────────────────────────────── */

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
}: {
  listingPrice: string | null;
  onSubmit: (target: number, max: number) => void;
}) {
  const basePrice = listingPrice ? parseInt(listingPrice, 10) : 1000;
  const minRange = Math.floor(basePrice * 0.5);
  const maxRange = Math.floor(basePrice * 1.5);

  const [target, setTarget] = useState(Math.floor(basePrice * 0.8));
  const [max, setMax] = useState(basePrice);

  return (
    <div className="mt-4 p-4 rounded-xl bg-surface-raised border border-line">
      <div className="flex justify-between items-center mb-5">
        <div className="text-center">
          <p className="text-[10px] font-bold text-ink-muted uppercase tracking-wider mb-1">
            Target price
          </p>
          <p className="text-[16px] font-bold text-action-primary">${target.toLocaleString()}</p>
        </div>
        <div className="h-[30px] w-[1px] bg-surface-sunken" />
        <div className="text-center">
          <p className="text-[10px] font-bold text-ink-muted uppercase tracking-wider mb-1">
            Max budget
          </p>
          <p className="text-[16px] font-bold text-action-primary">${max.toLocaleString()}</p>
        </div>
      </div>

      <div className="flex flex-col gap-6 mb-6">
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

      <Button variant="primary" fullWidth onClick={() => onSubmit(target, max)}>
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

function AgentIcon({ accent }: { accent: string }) {
  return (
    <span
      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px]"
      style={{ backgroundColor: `${accent}22`, color: accent }}
    >
      🤖
    </span>
  );
}

/* ─── Main Component ──────────────────────────────────────── */

export function NegotiationAgentBuilderChat({
  agent,
  listingPublicId,
  listingTitle,
  listingCategory,
  listingPrice,
  listingFloorPrice,
  listingCondition,
  listingTags,
  listingDescription,
  listingMarketMedian,
  role = "buyer",
  onNegotiationAgentBuilderMemoryUpdate,
  onStrategyUpdate,
}: NegotiationAgentBuilderChatProps) {
  const side = role;

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
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [memory, setMemory] = useState<NegotiationAgentBuilderMemory>(() =>
    buildInitialMemory(agent, listingCategory),
  );
  const [isExpanded, setIsExpanded] = useState(false);
  const [_hasRestoredSession, setHasRestoredSession] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatTopRef = useRef<HTMLDivElement>(null);

  // Side-aware opening message. Acknowledges prices already provided (e.g. from
  // the listing wizard) so the agent never re-asks what it already knows.
  // Sellers never get the budget-slider (its labels are buyer-oriented).
  function makeGreeting(): { text: string; widget?: "budget-slider" } {
    const agentName = agent?.copy?.[side]?.name ?? "your agent";
    const title = listingTitle || "this listing";
    const askNum = listingPrice ? parseFloat(listingPrice) : null;
    const floorNum = listingFloorPrice ? parseFloat(listingFloorPrice) : null;
    const money = (n: number) => `$${n.toLocaleString()}`;

    if (side === "seller") {
      // No listing context (standalone reusable agent) — price is set per-listing,
      // so never ask for an asking/floor price here. Gather posture instead.
      if (!askNum) {
        return {
          text: `I'll set up **${agentName}** for your selling negotiations. Tell me what you'd emphasize (condition, accessories, rarity), any deal-breakers, and how firmly you like to hold your price.`,
        };
      }
      if (floorNum) {
        return {
          text: `I'll set up **${agentName}** to sell **${title}**. You're asking ${money(askNum)} and won't go below ${money(floorNum)}. Tell me anything to emphasize (condition, accessories) or any deal-breakers.`,
        };
      }
      // Listing exists with an asking price but no floor yet — only the floor is missing.
      return {
        text: `I'll set up **${agentName}** to sell **${title}**. You're asking ${money(askNum)}. What's the lowest you'd accept, and anything to emphasize?`,
      };
    }
    // buyer — only offer the budget slider when there's a concrete listing.
    if (askNum) {
      return {
        text: `I'll help **${agentName}** negotiate **${title}** (listed at ${money(askNum)}). What's your ideal price and the most you'd pay?`,
        widget: "budget-slider",
      };
    }
    // No listing context (standalone reusable agent) — budget is per-listing, so
    // skip the budget slider and gather general style/preferences instead.
    return {
      text: `I'll set up **${agentName}** for your buying negotiations. Tell me your must-haves, deal-breakers, and how aggressively you like to negotiate.`,
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

  // Load from localStorage or reset when agent changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally re-runs only on agent id / listing change
  useEffect(() => {
    if (!agent) {
      setMessages([]);
      setMemory(buildInitialMemory(null, listingCategory));
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
      // Fresh start: side-aware greeting that respects already-known prices
      const newMemory = buildInitialMemory(agent, listingCategory);
      setMemory(newMemory);

      const greeting = makeGreeting();
      const greetingMsg: ChatMessage = {
        id: "greeting",
        role: "agent",
        text: greeting.text,
        timestamp: Date.now(),
        ...(greeting.widget ? { widget: greeting.widget } : {}),
      };
      setMessages([greetingMsg]);
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
  }, [
    input,
    isLoading,
    memory,
    agent,
    side,
    listingPublicId,
    onNegotiationAgentBuilderMemoryUpdate,
    onStrategyUpdate,
    buildAdvisorListings,
    buildCurrentStrategy,
  ]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset deps intentionally fixed; greeting is rebuilt inline and excluded on purpose
  const handleReset = useCallback(() => {
    if (!agent) return;
    clearSession(listingPublicId, agent.id);
    const newMemory = buildInitialMemory(agent, listingCategory);
    setMemory(newMemory);

    const greeting = makeGreeting();
    const greetingMsg: ChatMessage = {
      id: "greeting",
      role: "agent",
      text: greeting.text,
      timestamp: Date.now(),
      ...(greeting.widget ? { widget: greeting.widget } : {}),
    };

    setMessages([greetingMsg]);
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
    ],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const chips = extractChips(memory);
  const hasAgentSelected = agent !== null;
  const accent = agent?.accentColor ?? "var(--color-action-primary)";

  return (
    <div
      id="negotiation-agent-builder-chat-container"
      ref={chatTopRef}
      className="mt-4 flex flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface-raised transition-all duration-300"
      style={{ minHeight: isExpanded ? "400px" : "200px" }}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-line border-b px-4 py-3">
        <MessageSquare size={16} style={{ color: accent }} aria-hidden="true" />
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
      <MessageList className="min-h-0 flex-1 gap-3 p-4">
        {messages.map((msg) => (
          <ChatBubble
            key={msg.id}
            side={msg.role === "user" ? "right" : "left"}
            className={msg.id !== "greeting" ? "msg-anim" : undefined}
            author={
              msg.role === "agent" ? (
                <span className="flex items-center gap-1.5">
                  <AgentIcon accent={accent} />
                  <span className="font-semibold text-[10px]" style={{ color: accent }}>
                    {agent?.copy[role].name ?? "Agent"}
                  </span>
                </span>
              ) : undefined
            }
          >
            <p
              className="text-[13px] leading-[1.6]"
              style={{
                color: msg.role === "user" ? "var(--color-ink)" : "var(--color-ink-secondary)",
              }}
              // biome-ignore lint/security/noDangerouslySetInnerHtml: intentional sanitized markdown rendering
              dangerouslySetInnerHTML={{
                __html: renderMarkdownLite(msg.text),
              }}
            />

            {msg.widget === "budget-slider" && (
              <BudgetWidget listingPrice={listingPrice} onSubmit={handleBudgetSubmit} />
            )}
          </ChatBubble>
        ))}

        {/* Typing indicator */}
        {isLoading && (
          <ChatBubble side="left" className="msg-anim">
            <span className="flex items-center gap-1.5">
              <AgentIcon accent={accent} />
              <TypingIndicator />
            </span>
          </ChatBubble>
        )}
      </MessageList>

      {/* Strategy chips — only show when we have them */}
      {chips.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-1.5 overflow-x-auto border-line border-t bg-surface-overlay px-4 py-2">
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

      {/* Input area — bespoke chat composer (flat transparent field); the shared Input is a
          bordered form field and doesn't fit this toolbar. Send is a fixed-CTA IconButton
          (not the agent accent) so action buttons read consistently across the app. */}
      <div className="flex shrink-0 items-center gap-2 border-line border-t bg-surface-overlay px-3 py-2.5">
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

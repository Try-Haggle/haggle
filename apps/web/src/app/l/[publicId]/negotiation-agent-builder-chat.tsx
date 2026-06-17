"use client";

import type { ChatStrategy, NegotiationAgentPreset } from "@haggle/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient } from "@/lib/api-client";

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
  for (const item of memory.avoid) {
    chips.push({ label: `❌ ${item}`, value: item, category: "constraint" });
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

/* ─── Typing dots ─────────────────────────────────────────── */

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-[3px]">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block h-[5px] w-[5px] rounded-full"
          style={{
            backgroundColor: "var(--color-action-primary)",
            opacity: 0.5,
            animation: `dotPulse 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes dotPulse {
          0%, 80%, 100% { opacity: 0.25; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1.1); }
        }
      `}</style>
    </span>
  );
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
        <div className="relative">
          <input
            type="range"
            min={minRange}
            max={maxRange}
            step={10}
            value={target}
            onChange={(e) => {
              const val = Number(e.target.value);
              setTarget(val);
              if (val > max) setMax(val);
            }}
            className="w-full h-1.5 bg-surface-sunken rounded-lg appearance-none cursor-pointer accent-action-primary"
          />
        </div>
        <div className="relative">
          <input
            type="range"
            min={minRange}
            max={maxRange}
            step={10}
            value={max}
            onChange={(e) => {
              const val = Number(e.target.value);
              setMax(val);
              if (val < target) setTarget(val);
            }}
            className="w-full h-1.5 bg-surface-sunken rounded-lg appearance-none cursor-pointer accent-action-primary"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => onSubmit(target, max)}
        className="w-full py-2.5 bg-cta hover:bg-cta-hover text-on-cta text-[13px] font-bold rounded-lg transition-all shadow-[0_0_15px_rgba(6,182,212,0.3)]"
      >
        Set budget
      </button>
    </div>
  );
}

/* ─── Chip Category Colors ────────────────────────────────── */

const CHIP_COLORS: Record<StrategyChip["category"], { bg: string; border: string; text: string }> =
  {
    pricing: {
      bg: "rgba(16,185,129,0.08)",
      border: "rgba(16,185,129,0.25)",
      text: "#34d399",
    },
    style: {
      bg: "rgba(6,182,212,0.08)",
      border: "rgba(6,182,212,0.25)",
      text: "#22d3ee",
    },
    preference: {
      bg: "rgba(59,130,246,0.08)",
      border: "rgba(59,130,246,0.25)",
      text: "#60a5fa",
    },
    constraint: {
      bg: "rgba(239,68,68,0.08)",
      border: "rgba(239,68,68,0.25)",
      text: "#f87171",
    },
  };

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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
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
      if (askNum && floorNum) {
        return {
          text: `I'll set up **${agentName}** to sell **${title}**. You're asking ${money(askNum)} and won't go below ${money(floorNum)}. Tell me anything to emphasize (condition, accessories) or any deal-breakers.`,
        };
      }
      return {
        text: `I'll set up **${agentName}** to sell **${title}**. What's your asking price and the lowest you'd accept?`,
      };
    }
    // buyer
    if (askNum) {
      return {
        text: `I'll help **${agentName}** negotiate **${title}** (listed at ${money(askNum)}). What's your ideal price and the most you'd pay?`,
        widget: "budget-slider",
      };
    }
    return {
      text: `I'll help **${agentName}** with this negotiation. What's your ideal price and the most you'd pay?`,
      widget: "budget-slider",
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

  // Scroll chat to bottom locally without affecting page scroll
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll only when message count or loading state changes
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages.length, isLoading]);

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
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: "agent",
        text: "Connection problem. Please try again in a moment.",
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
        const errorMsg: ChatMessage = {
          id: `error-${Date.now()}`,
          role: "agent",
          text: "Connection problem. Please try again in a moment.",
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

  return (
    <div
      id="negotiation-agent-builder-chat-container"
      ref={chatTopRef}
      className="mt-4 flex-1 flex flex-col rounded-xl border overflow-hidden transition-all duration-300"
      style={{
        borderColor: "var(--color-border-default)",
        background: "var(--color-surface-raised)",
        minHeight: isExpanded ? "400px" : "200px",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-3 shrink-0"
        style={{ borderBottom: "1px solid var(--color-border-default)" }}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke={agent?.accentColor ?? "var(--color-action-primary)"}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span
          className="text-[13px] font-semibold flex-1"
          style={{ color: agent?.accentColor ?? "var(--color-action-primary)" }}
        >
          {agent ? agent.copy[role].name : role === "seller" ? "Selling Agent" : "Buying Agent"}
        </span>
        {messages.length > 1 && (
          <span
            className="text-[10px] font-medium px-2 py-0.5 rounded-full"
            style={{
              background: "rgba(6,182,212,0.1)",
              color: "var(--color-action-primary)",
              border: "1px solid rgba(6,182,212,0.2)",
            }}
          >
            {chips.length} strategy hints
          </span>
        )}
        {/* Reset button */}
        {messages.length > 1 && hasAgentSelected && (
          <button
            type="button"
            onClick={handleReset}
            className="flex h-5 w-5 items-center justify-center rounded transition-colors duration-150 hover:bg-surface-sunken"
            title="Reset conversation"
            aria-label="Reset strategy chat"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              width="12"
              height="12"
              fill="none"
              stroke="var(--color-ink-muted)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
          </button>
        )}
      </div>

      {/* Messages area */}
      <div
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto transition-all duration-500 ease-out min-h-0"
        style={{ scrollBehavior: "smooth" }}
      >
        <div className="flex flex-col gap-3 p-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              style={{
                animation: msg.id !== "greeting" ? "fadeSlideIn 0.3s ease-out" : undefined,
              }}
            >
              <div
                className="rounded-xl px-3.5 py-2.5 max-w-[85%]"
                style={
                  msg.role === "user"
                    ? {
                        background:
                          "linear-gradient(135deg, rgba(6,182,212,0.12), rgba(6,182,212,0.06))",
                        border: "1px solid rgba(6,182,212,0.2)",
                      }
                    : {
                        background: "var(--color-surface-raised)",
                        border: "1px solid var(--color-border-default)",
                      }
                }
              >
                {msg.role === "agent" && (
                  <div className="flex items-center gap-1.5 mb-1">
                    <span
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px]"
                      style={{
                        backgroundColor: `${agent?.accentColor ?? "var(--color-action-primary)"}22`,
                        color: agent?.accentColor ?? "var(--color-action-primary)",
                      }}
                    >
                      🤖
                    </span>
                    <span
                      className="text-[10px] font-semibold"
                      style={{ color: agent?.accentColor ?? "var(--color-action-primary)" }}
                    >
                      {agent?.copy[role].name ?? "Agent"}
                    </span>
                  </div>
                )}
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
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {isLoading && (
            <div className="flex justify-start" style={{ animation: "fadeSlideIn 0.2s ease-out" }}>
              <div
                className="rounded-xl px-3.5 py-2.5"
                style={{
                  background: "var(--color-surface-raised)",
                  border: "1px solid var(--color-border-default)",
                }}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px]"
                    style={{
                      backgroundColor: `${agent?.accentColor ?? "var(--color-action-primary)"}22`,
                      color: agent?.accentColor ?? "var(--color-action-primary)",
                    }}
                  >
                    🤖
                  </span>
                  <TypingDots />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Strategy chips — only show when we have them */}
      {chips.length > 0 && (
        <div
          className="px-4 py-2 flex flex-wrap gap-1.5 overflow-x-auto shrink-0"
          style={{
            borderTop: "1px solid var(--color-border-default)",
            background: "var(--color-surface-overlay)",
          }}
        >
          <span
            className="text-[10px] font-semibold tracking-wider mr-1 self-center"
            style={{ color: "var(--color-ink-muted)" }}
          >
            STRATEGY
          </span>
          {chips.map((chip) => {
            const colors = CHIP_COLORS[chip.category];
            return (
              <span
                key={`${chip.category}-${chip.value}`}
                className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap transition-all duration-300"
                style={{
                  background: colors.bg,
                  border: `1px solid ${colors.border}`,
                  color: colors.text,
                  animation: "chipIn 0.3s ease-out",
                }}
              >
                {chip.label}
              </span>
            );
          })}
        </div>
      )}

      {/* Input area */}
      <div
        className="px-3 py-2.5 flex items-center gap-2 shrink-0"
        style={{
          borderTop: "1px solid var(--color-border-default)",
          background: "var(--color-surface-overlay)",
        }}
      >
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
          className="flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-muted outline-none disabled:opacity-40 disabled:cursor-not-allowed"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!input.trim() || isLoading || !hasAgentSelected}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
          style={{
            background:
              input.trim() && hasAgentSelected
                ? (agent?.accentColor ?? "var(--color-action-primary)")
                : "transparent",
            border: `1px solid ${input.trim() && hasAgentSelected ? "transparent" : "var(--color-border-default)"}`,
          }}
          aria-label="Send message"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke={
              input.trim() && hasAgentSelected ? "var(--color-on-cta)" : "var(--color-ink-muted)"
            }
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
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
      `}</style>
    </div>
  );
}

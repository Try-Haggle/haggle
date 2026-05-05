"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { BuyerAgentPreset } from "@/lib/buyer-agents";
import { apiClient } from "@/lib/api-client";

/* ─── Types ───────────────────────────────────────────────── */

interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  timestamp: number;
  widget?: "budget-slider";
}

interface AdvisorMemory {
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

interface StrategyChatProps {
  agent: BuyerAgentPreset | null;
  listingPublicId: string;
  listingTitle: string;
  listingCategory: string | null;
  listingPrice: string | null;
  onMemoryUpdate?: (memory: AdvisorMemory) => void;
}

/* ─── localStorage persistence ───────────────────────────── */

const STORAGE_PREFIX = "haggle:strategy";
const EXPIRY_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

interface PersistedSession {
  memory: AdvisorMemory;
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
  } catch { /* ignore */ }
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
  } catch { return null; }
}

export function clearSelectedAgent(listingId: string): void {
  try { localStorage.removeItem(agentKey(listingId)); } catch { /* ignore */ }
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
  agent: BuyerAgentPreset | null,
  category: string | null,
): AdvisorMemory {
  const negotiationStyle =
    agent?.id === "price-hunter"
      ? "aggressive"
      : agent?.id === "fast-closer"
        ? "defensive"
        : "balanced";
  const riskStyle =
    agent?.id === "price-hunter"
      ? "lowest_price"
      : agent?.id === "smart-trader"
        ? "safe_first"
        : "balanced";
  const openingTactic =
    agent?.id === "spec-analyst"
      ? "condition_anchor"
      : agent?.id === "fast-closer"
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

function buildGreeting(
  agent: BuyerAgentPreset | null,
  listingTitle: string,
  listingPrice: string | null,
): string {
  const name = agent?.name ?? "AI Agent";
  const priceStr = listingPrice
    ? `$${parseFloat(listingPrice).toLocaleString("en-US")}`
    : "";
  return (
    `안녕하세요! ${name}입니다. **${listingTitle}**${priceStr ? ` (${priceStr})` : ""} 협상을 도와드릴게요.\n\n` +
    `아래와 같은 내용을 알려주시면 전략에 반영됩니다:\n` +
    `• 💰 예산 또는 목표 가격\n` +
    `• ✅ 꼭 필요한 조건 (예: 배터리 90% 이상)\n` +
    `• ❌ 피하고 싶은 것 (예: 화면 스크래치)\n` +
    `• ⚡ 협상 스타일 (빠르게 끝내기 / 끝까지 밀어붙이기)\n\n` +
    `편하게 말씀해 주세요 — 바로 전략에 반영할게요.`
  );
}

function extractChips(memory: AdvisorMemory): StrategyChip[] {
  const chips: StrategyChip[] = [];

  if (memory.budgetMax) {
    chips.push({
      label: `예산 $${memory.budgetMax.toLocaleString()}`,
      value: String(memory.budgetMax),
      category: "pricing",
    });
  }
  if (memory.targetPrice) {
    chips.push({
      label: `목표가 $${memory.targetPrice.toLocaleString()}`,
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
    aggressive: "공격적 협상",
    balanced: "균형형 협상",
    defensive: "안정적 협상",
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
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white">$1</strong>')
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
            backgroundColor: "#06b6d4",
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
  const basePrice = listingPrice ? parseInt(listingPrice) : 1000;
  const minRange = Math.floor(basePrice * 0.5);
  const maxRange = Math.floor(basePrice * 1.5);

  const [target, setTarget] = useState(Math.floor(basePrice * 0.8));
  const [max, setMax] = useState(basePrice);

  return (
    <div className="mt-4 p-4 rounded-xl bg-[#0f172a] border border-[#1e293b]">
      <div className="flex justify-between items-center mb-5">
        <div className="text-center">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">목표 가격</p>
          <p className="text-[16px] font-bold text-cyan-400">${target.toLocaleString()}</p>
        </div>
        <div className="h-[30px] w-[1px] bg-[#1e293b]" />
        <div className="text-center">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">최대 예산</p>
          <p className="text-[16px] font-bold text-blue-400">${max.toLocaleString()}</p>
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
            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
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
            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => onSubmit(target, max)}
        className="w-full py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-[13px] font-bold rounded-lg transition-all shadow-[0_0_15px_rgba(6,182,212,0.3)]"
      >
        예산 설정 완료
      </button>
    </div>
  );
}

/* ─── Chip Category Colors ────────────────────────────────── */

const CHIP_COLORS: Record<
  StrategyChip["category"],
  { bg: string; border: string; text: string }
> = {
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

export function StrategyChat({
  agent,
  listingPublicId,
  listingTitle,
  listingCategory,
  listingPrice,
  onMemoryUpdate,
}: StrategyChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [memory, setMemory] = useState<AdvisorMemory>(() =>
    buildInitialMemory(agent, listingCategory),
  );
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasRestoredSession, setHasRestoredSession] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const chatTopRef = useRef<HTMLDivElement>(null);

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
      onMemoryUpdate?.(saved.memory);
    } else {
      // Fresh start: provide a greeting with budget widget
      const newMemory = buildInitialMemory(agent, listingCategory);
      setMemory(newMemory);
      
      const greetingMsg: ChatMessage = {
        id: "greeting",
        role: "agent",
        text: `안녕하세요! **${listingTitle}** 협상을 준비 중이군요. 먼저 목표가와 최대 예산을 설정해주세요.`,
        timestamp: Date.now(),
        widget: "budget-slider"
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
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: "smooth"
      });
    }
  }, [messages.length, isLoading]);

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
        memory?: AdvisorMemory;
        reply?: string;
      }>("/intelligence/demo/advisor-turn", {
        method: "POST",
        body: JSON.stringify({
          message: trimmed,
          previous_memory: memory,
          agent_id: agent?.id ?? "smart-trader",
          listings: [],
        }),
        skipAuth: true,
      });
      const updatedMemory: AdvisorMemory = data.memory ?? memory;
      setMemory(updatedMemory);
      onMemoryUpdate?.(updatedMemory);

      const agentMsg: ChatMessage = {
        id: `agent-${Date.now()}`,
        role: "agent",
        text: data.reply ?? "죄송합니다, 다시 한번 말씀해주세요.",
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
      console.error("[strategy-chat] API error:", err);
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: "agent",
        text: "연결에 문제가 있어요. 잠시 후 다시 시도해주세요.",
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
  }, [input, isLoading, memory, agent, listingPublicId, onMemoryUpdate]);

  const handleReset = useCallback(() => {
    if (!agent) return;
    clearSession(listingPublicId, agent.id);
    const newMemory = buildInitialMemory(agent, listingCategory);
    setMemory(newMemory);
    
    const greetingMsg: ChatMessage = {
      id: "greeting",
      role: "agent",
      text: `안녕하세요! **${listingTitle}** 협상을 준비 중이군요. 먼저 목표가와 최대 예산을 설정해주세요.`,
      timestamp: Date.now(),
      widget: "budget-slider"
    };
    
    setMessages([greetingMsg]);
    setIsExpanded(true);
    setHasRestoredSession(false);
    scrollToTop();
  }, [agent, listingPublicId, listingCategory, listingTitle, listingPrice, scrollToTop]);

  const handleBudgetSubmit = useCallback(async (target: number, max: number) => {
    if (isLoading) return;
    
    const userText = `목표 가격은 $${target}, 최대 예산은 $${max}로 생각하고 있어.`;
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text: userText,
      timestamp: Date.now(),
    };
    
    // Optimistic memory update
    const updatedMemoryOptimistic = { ...memory, targetPrice: target, budgetMax: max };
    setMemory(updatedMemoryOptimistic);
    onMemoryUpdate?.(updatedMemoryOptimistic);
    
    setMessages((prev) => {
      // Remove widget from the greeting
      const withoutWidget = prev.map(m => m.id === "greeting" ? { ...m, widget: undefined } : m);
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
        memory?: AdvisorMemory;
        reply?: string;
      }>("/intelligence/demo/advisor-turn", {
        method: "POST",
        body: JSON.stringify({
          message: userText,
          previous_memory: updatedMemoryOptimistic,
          agent_id: agent?.id ?? "smart-trader",
          listings: [],
        }),
        skipAuth: true,
      });

      const updatedMemory: AdvisorMemory = data.memory ?? updatedMemoryOptimistic;
      setMemory(updatedMemory);
      onMemoryUpdate?.(updatedMemory);

      const agentMsg: ChatMessage = {
        id: `agent-${Date.now()}`,
        role: "agent",
        text: data.reply ?? "예산이 설정되었습니다. 더 피하고 싶거나 원하시는 조건이 있나요?",
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
      console.error("[strategy-chat] API error:", err);
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: "agent",
        text: "연결에 문제가 있어요. 잠시 후 다시 시도해주세요.",
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
  }, [isLoading, memory, agent, listingPublicId, onMemoryUpdate]);

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
      id="strategy-chat-container"
      ref={chatTopRef}
      className="mt-4 flex-1 flex flex-col rounded-xl border overflow-hidden transition-all duration-300"
      style={{
        borderColor: "#1e293b",
        background: "#0f172a",
        minHeight: isExpanded ? "400px" : "200px"
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-3 shrink-0"
        style={{ borderBottom: "1px solid #1e293b" }}
      >
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke={agent?.accentColor ?? "#06b6d4"}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span
          className="text-[13px] font-semibold flex-1"
          style={{ color: agent?.accentColor ?? "#06b6d4" }}
        >
          {agent ? agent.name : "Buying Agent"}
        </span>
        {messages.length > 1 && (
          <span
            className="text-[10px] font-medium px-2 py-0.5 rounded-full"
            style={{
              background: "rgba(6,182,212,0.1)",
              color: "#06b6d4",
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
            className="flex h-5 w-5 items-center justify-center rounded transition-colors duration-150 hover:bg-white/5"
            title="대화 초기화"
            aria-label="Reset strategy chat"
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                        background: "#111827",
                        border: "1px solid #1e293b",
                      }
                }
              >
                {msg.role === "agent" && (
                  <div className="flex items-center gap-1.5 mb-1">
                    <span
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px]"
                      style={{
                        backgroundColor: `${agent?.accentColor ?? "#06b6d4"}22`,
                        color: agent?.accentColor ?? "#06b6d4",
                      }}
                    >
                      🤖
                    </span>
                    <span
                      className="text-[10px] font-semibold"
                      style={{ color: agent?.accentColor ?? "#06b6d4" }}
                    >
                      {agent?.name ?? "Agent"}
                    </span>
                  </div>
                )}
                <p
                  className="text-[13px] leading-[1.6]"
                  style={{ color: msg.role === "user" ? "#e2e8f0" : "#cbd5e1" }}
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdownLite(msg.text),
                  }}
                />
                
                {msg.widget === "budget-slider" && (
                  <BudgetWidget 
                    listingPrice={listingPrice} 
                    onSubmit={handleBudgetSubmit} 
                  />
                )}
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {isLoading && (
            <div className="flex justify-start" style={{ animation: "fadeSlideIn 0.2s ease-out" }}>
              <div
                className="rounded-xl px-3.5 py-2.5"
                style={{ background: "#111827", border: "1px solid #1e293b" }}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px]"
                    style={{
                      backgroundColor: `${agent?.accentColor ?? "#06b6d4"}22`,
                      color: agent?.accentColor ?? "#06b6d4",
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
            borderTop: "1px solid #1e293b",
            background: "#0d1321",
          }}
        >
          <span
            className="text-[10px] font-semibold tracking-wider mr-1 self-center"
            style={{ color: "#475569" }}
          >
            STRATEGY
          </span>
          {chips.map((chip, i) => {
            const colors = CHIP_COLORS[chip.category];
            return (
              <span
                key={`${chip.category}-${i}`}
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
          borderTop: "1px solid #1e293b",
          background: "#0d1321",
        }}
      >
        <input
          ref={inputRef}
          type="text"
          placeholder={
            hasAgentSelected
              ? "예산, 원하는 조건 등을 알려주세요..."
              : "먼저 에이전트를 선택해 주세요"
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!hasAgentSelected || isLoading}
          className="flex-1 bg-transparent text-[13px] text-slate-200 placeholder-slate-600 outline-none disabled:opacity-40 disabled:cursor-not-allowed"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!input.trim() || isLoading || !hasAgentSelected}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
          style={{
            background:
              input.trim() && hasAgentSelected
                ? agent?.accentColor ?? "#06b6d4"
                : "transparent",
            border: `1px solid ${input.trim() && hasAgentSelected ? "transparent" : "#334155"}`,
          }}
          aria-label="Send message"
        >
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke={
              input.trim() && hasAgentSelected ? "#ffffff" : "#475569"
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

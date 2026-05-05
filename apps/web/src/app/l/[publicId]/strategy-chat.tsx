"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { BuyerAgentPreset } from "@/lib/buyer-agents";

/* ─── Types ───────────────────────────────────────────────── */

interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  timestamp: number;
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
  listingTitle: string;
  listingCategory: string | null;
  listingPrice: string | null;
  onMemoryUpdate?: (memory: AdvisorMemory) => void;
}

/* ─── Constants ───────────────────────────────────────────── */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Reset when agent changes
  useEffect(() => {
    const newMemory = buildInitialMemory(agent, listingCategory);
    setMemory(newMemory);
    setMessages([
      {
        id: "greeting",
        role: "agent",
        text: buildGreeting(agent, listingTitle, listingPrice),
        timestamp: Date.now(),
      },
    ]);
    setIsExpanded(false);
  }, [agent?.id, listingTitle, listingPrice, listingCategory]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);
    setIsExpanded(true);

    try {
      const res = await fetch(
        `${API_BASE}/intelligence/demo/advisor-turn`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            previous_memory: memory,
            agent_id: agent?.id ?? "smart-trader",
            listings: [],
          }),
        },
      );

      if (!res.ok) throw new Error(`API error: ${res.status}`);

      const data = await res.json();
      const updatedMemory: AdvisorMemory = data.memory ?? memory;
      setMemory(updatedMemory);
      onMemoryUpdate?.(updatedMemory);

      const agentMsg: ChatMessage = {
        id: `agent-${Date.now()}`,
        role: "agent",
        text: data.reply ?? "죄송합니다, 다시 한번 말씀해주세요.",
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, agentMsg]);
    } catch (err) {
      console.error("[strategy-chat] API error:", err);
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: "agent",
        text: "연결에 문제가 있어요. 잠시 후 다시 시도해주세요.",
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, memory, agent, onMemoryUpdate]);

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
      className="mt-4 rounded-xl border overflow-hidden transition-all duration-300"
      style={{
        borderColor: "#1e293b",
        background: "#0f172a",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-3"
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
      </div>

      {/* Messages area */}
      <div
        ref={chatContainerRef}
        className="overflow-y-auto transition-all duration-500 ease-out"
        style={{
          maxHeight: isExpanded ? "320px" : "160px",
          scrollBehavior: "smooth",
        }}
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
          className="px-4 py-2 flex flex-wrap gap-1.5 overflow-x-auto"
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
        className="px-3 py-2.5 flex items-center gap-2"
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

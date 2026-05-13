import { useState, useRef, useEffect, useCallback } from "react";
import type { NegotiationPreset } from "@haggle/shared";

/* ─── Types ───────────────────────────────────────────────── */

export interface SellerStrategyMemory {
  dealBreakers: string[];
  mustEmphasize: string[];
  tone: "firm" | "friendly" | "flexible";
  urgency: "high" | "medium" | "low";
  notes: string[];
}

interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
}

interface SellerStrategyChatProps {
  agent: NegotiationPreset | null;
  listingTitle: string;
  listingPrice: string;
  onMemoryUpdate: (memory: SellerStrategyMemory) => void;
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

/* ─── Helpers ─────────────────────────────────────────────── */

export function buildInitialSellerMemory(): SellerStrategyMemory {
  return {
    dealBreakers: [],
    mustEmphasize: [],
    tone: "friendly",
    urgency: "medium",
    notes: [],
  };
}

function buildGreeting(agent: NegotiationPreset | null, title: string): string {
  const name = agent?.copy.seller.name ?? "your agent";
  return (
    `I'll help configure **${name}** for negotiating **${title}**.\n\n` +
    `Tell me how you'd like the agent to handle negotiations:\n` +
    `• 🚫 Deal-breakers — things you'll never accept\n` +
    `• ✨ What to emphasize — condition, accessories, rarity\n` +
    `• 🎯 Your tone — firm, friendly, or flexible\n` +
    `• ⚡ Urgency — how fast do you need to sell?`
  );
}

function renderMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br />");
}

function TypingDots() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            display: "inline-block",
            width: 5,
            height: 5,
            borderRadius: "50%",
            backgroundColor: "#06b6d4",
            opacity: 0.5,
            animation: `scDot 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes scDot {
          0%,80%,100%{opacity:.25;transform:scale(.8)}
          40%{opacity:1;transform:scale(1.1)}
        }
        @keyframes scFade {
          from{opacity:0;transform:translateY(5px)}
          to{opacity:1;transform:translateY(0)}
        }
      `}</style>
    </span>
  );
}

type ChipCategory = "dealBreaker" | "emphasize" | "style" | "urgency";

interface Chip {
  label: string;
  category: ChipCategory;
}

const CHIP_COLORS: Record<ChipCategory, { bg: string; border: string; color: string }> = {
  dealBreaker: { bg: "rgba(239,68,68,.08)", border: "rgba(239,68,68,.25)", color: "#f87171" },
  emphasize:   { bg: "rgba(59,130,246,.08)", border: "rgba(59,130,246,.25)", color: "#60a5fa" },
  style:       { bg: "rgba(6,182,212,.08)", border: "rgba(6,182,212,.25)", color: "#22d3ee" },
  urgency:     { bg: "rgba(245,158,11,.08)", border: "rgba(245,158,11,.25)", color: "#fbbf24" },
};

function extractChips(memory: SellerStrategyMemory): Chip[] {
  const chips: Chip[] = [];
  for (const d of memory.dealBreakers) chips.push({ label: `🚫 ${d}`, category: "dealBreaker" });
  for (const e of memory.mustEmphasize) chips.push({ label: `✨ ${e}`, category: "emphasize" });
  if (memory.tone !== "friendly") {
    const toneLabel = { firm: "Firm tone", flexible: "Flexible tone" }[memory.tone] ?? memory.tone;
    chips.push({ label: toneLabel, category: "style" });
  }
  if (memory.urgency !== "medium") {
    const urgLabel = { high: "⚡ Sell fast", low: "🕐 No rush" }[memory.urgency] ?? memory.urgency;
    chips.push({ label: urgLabel, category: "urgency" });
  }
  return chips;
}

/* ─── Component ───────────────────────────────────────────── */

export default function SellerStrategyChat({
  agent,
  listingTitle,
  listingPrice,
  onMemoryUpdate,
  callTool,
}: SellerStrategyChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [memory, setMemory] = useState<SellerStrategyMemory>(buildInitialSellerMemory);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Show greeting when agent changes
  useEffect(() => {
    if (!agent) {
      setMessages([]);
      return;
    }
    setMessages([
      {
        id: "greeting",
        role: "agent",
        text: buildGreeting(agent, listingTitle),
      },
    ]);
    setMemory(buildInitialSellerMemory());
  }, [agent?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages.length, isLoading]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading || !agent) return;

    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: "user", text: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const raw = await callTool("haggle_seller_advisor_turn", {
        message: trimmed,
        previous_memory: memory,
        listing_title: listingTitle,
        listing_price: listingPrice,
        agent_preset: agent.id,
      });

      const r = raw as Record<string, unknown> | undefined;
      // structuredContent or parse from content text
      let result: { memory?: SellerStrategyMemory; reply?: string } = {};
      if (r?.structuredContent) {
        result = r.structuredContent as typeof result;
      } else {
        const textContent = (r?.content as Array<{ text?: string }> | undefined)?.[0]?.text;
        if (textContent) result = JSON.parse(textContent);
      }

      const updatedMemory: SellerStrategyMemory = {
        dealBreakers: result.memory?.dealBreakers ?? memory.dealBreakers,
        mustEmphasize: result.memory?.mustEmphasize ?? memory.mustEmphasize,
        tone: result.memory?.tone ?? memory.tone,
        urgency: result.memory?.urgency ?? memory.urgency,
        notes: result.memory?.notes ?? memory.notes,
      };
      setMemory(updatedMemory);
      onMemoryUpdate(updatedMemory);

      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: "agent", text: result.reply ?? "Got it!" },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: `e-${Date.now()}`, role: "agent", text: "Something went wrong. Please try again." },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, agent, memory, listingTitle, listingPrice, callTool, onMemoryUpdate]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const chips = extractChips(memory);
  const accentColor = agent?.accentColor ?? "#06b6d4";

  return (
    <div
      style={{
        marginTop: 16,
        borderRadius: 12,
        border: "1px solid #1e293b",
        background: "#0f172a",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          borderBottom: "1px solid #1e293b",
        }}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke={accentColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span style={{ fontSize: 13, fontWeight: 600, color: accentColor, flex: 1 }}>
          Strategy Chat
        </span>
        {chips.length > 0 && (
          <span style={{
            fontSize: 10, fontWeight: 500, padding: "2px 8px", borderRadius: 20,
            background: `${accentColor}18`, color: accentColor,
            border: `1px solid ${accentColor}33`,
          }}>
            {chips.length} hint{chips.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Messages */}
      <div
        ref={chatRef}
        style={{
          height: 240,
          overflowY: "auto",
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {!agent ? (
          <p style={{ fontSize: 13, color: "#475569", margin: "auto", textAlign: "center" }}>
            Select an agent above to start configuring your strategy.
          </p>
        ) : (
          <>
            {messages.map((msg) => (
              <div
                key={msg.id}
                style={{
                  display: "flex",
                  justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                  animation: msg.id !== "greeting" ? "scFade 0.25s ease-out" : undefined,
                }}
              >
                <div
                  style={{
                    maxWidth: "85%",
                    padding: "9px 12px",
                    borderRadius: 10,
                    fontSize: 13,
                    lineHeight: 1.55,
                    ...(msg.role === "user"
                      ? {
                          background: `linear-gradient(135deg, ${accentColor}1a, ${accentColor}0d)`,
                          border: `1px solid ${accentColor}33`,
                          color: "#e2e8f0",
                        }
                      : {
                          background: "#111827",
                          border: "1px solid #1e293b",
                          color: "#cbd5e1",
                        }),
                  }}
                >
                  {msg.role === "agent" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
                      <span style={{ fontSize: 10 }}>🤖</span>
                      <span style={{ fontSize: 10, fontWeight: 600, color: accentColor }}>
                        {agent?.copy.seller.name ?? "Agent"}
                      </span>
                    </div>
                  )}
                  <span dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }} />
                </div>
              </div>
            ))}
            {isLoading && (
              <div style={{ display: "flex", justifyContent: "flex-start", animation: "scFade 0.2s ease-out" }}>
                <div style={{ padding: "9px 12px", borderRadius: 10, background: "#111827", border: "1px solid #1e293b" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ fontSize: 10 }}>🤖</span>
                    <TypingDots />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Strategy chips */}
      {chips.length > 0 && (
        <div style={{
          padding: "8px 14px",
          borderTop: "1px solid #1e293b",
          background: "#0d1321",
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          alignItems: "center",
        }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: "#475569", letterSpacing: "0.05em", marginRight: 2 }}>
            STRATEGY
          </span>
          {chips.map((chip, i) => {
            const c = CHIP_COLORS[chip.category];
            return (
              <span key={i} style={{
                fontSize: 11, fontWeight: 500,
                padding: "2px 10px", borderRadius: 20,
                background: c.bg, border: `1px solid ${c.border}`, color: c.color,
                animation: "scFade 0.3s ease-out",
                whiteSpace: "nowrap",
              }}>
                {chip.label}
              </span>
            );
          })}
        </div>
      )}

      {/* Input */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        borderTop: "1px solid #1e293b",
        background: "#0d1321",
      }}>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!agent || isLoading}
          placeholder={agent ? "e.g. No trades, highlight original box included..." : "Select an agent first"}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            fontSize: 13,
            color: "#e2e8f0",
            opacity: !agent ? 0.4 : 1,
          }}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!input.trim() || isLoading || !agent}
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            border: input.trim() && agent ? "none" : "1px solid #334155",
            background: input.trim() && agent ? accentColor : "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: input.trim() && agent ? "pointer" : "not-allowed",
            opacity: !input.trim() || !agent ? 0.35 : 1,
            transition: "all 0.15s",
            flexShrink: 0,
          }}
          aria-label="Send"
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none"
            stroke={input.trim() && agent ? "#fff" : "#475569"}
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}

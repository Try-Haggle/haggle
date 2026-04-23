"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "@/lib/api-client";

// ─── Types ──────────────────────────────────────────────────────────────

interface AdvisorMessageMeta {
  tokens_used?: number;
  model?: string;
  cost_usd?: number;
  strength?: number;
  blocked?: boolean;
  block_reason?: string;
}

interface AdvisorMsg {
  id: string;
  dispute_id: string;
  role: "buyer_advisor" | "seller_advisor" | "buyer_user" | "seller_user";
  content: string;
  metadata?: AdvisorMessageMeta;
  created_at: string;
}

interface ChatResponse {
  reply: AdvisorMsg;
  strength_assessment?: number;
  action_suggestions?: string[];
}

interface AnalyzeResponse {
  analysis: AdvisorMsg;
  strength?: number;
  action_suggestions?: string[];
}

// ─── Subcomponents ──────────────────────────────────────────────────────

function StrengthMeter({ value }: { value: number }) {
  const color =
    value >= 70
      ? "bg-emerald-500"
      : value >= 40
        ? "bg-amber-500"
        : "bg-red-500";
  const textColor =
    value >= 70
      ? "text-emerald-400"
      : value >= 40
        ? "text-amber-400"
        : "text-red-400";

  return (
    <div className="flex items-center gap-2 mt-2 mb-1">
      <span className="text-xs text-slate-500">Case Strength</span>
      <div className="flex-1 h-1.5 rounded-full bg-slate-700 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className={`text-xs font-bold ${textColor}`}>{value}%</span>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-3 py-2">
      <div className="flex gap-1">
        <div className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce [animation-delay:0ms]" />
        <div className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce [animation-delay:150ms]" />
        <div className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce [animation-delay:300ms]" />
      </div>
      <span className="text-xs text-slate-500 ml-1">Advisor is thinking...</span>
    </div>
  );
}

function ActionChips({
  actions,
  onAction,
}: {
  actions: string[];
  onAction: (action: string) => void;
}) {
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {actions.map((action, i) => (
        <button
          key={i}
          onClick={() => onAction(action)}
          className="rounded-full border border-slate-700 bg-slate-800/50 px-2.5 py-1 text-xs text-slate-300 hover:border-cyan-500/50 hover:text-cyan-400 transition-colors"
        >
          {action}
        </button>
      ))}
    </div>
  );
}

function BlockedMessage({ reason }: { reason?: string }) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
      <span className="font-medium">Message could not be processed.</span>
      {reason && <span className="ml-1 text-amber-500/80">{reason}</span>}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────

export function AdvisorChat({
  disputeId,
  userRole,
}: {
  disputeId: string;
  userRole: "buyer" | "seller";
}) {
  const [messages, setMessages] = useState<AdvisorMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [latestStrength, setLatestStrength] = useState<number | undefined>();
  const [latestActions, setLatestActions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const initialAnalysisDone = useRef(false);

  const accentBorder =
    userRole === "buyer" ? "border-cyan-500/30" : "border-violet-500/30";
  const accentText =
    userRole === "buyer" ? "text-cyan-400" : "text-violet-400";

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Load history on mount
  useEffect(() => {
    async function loadHistory() {
      setLoading(true);
      try {
        const data = await api.get<{ messages: AdvisorMsg[] }>(
          `/disputes/${disputeId}/advisor/history`,
        );
        setMessages(data.messages);

        // Extract latest strength from most recent advisor message
        const advisorMsgs = data.messages.filter(
          (m) => m.role === `${userRole}_advisor`,
        );
        if (advisorMsgs.length > 0) {
          const last = advisorMsgs[advisorMsgs.length - 1]!;
          if (last.metadata?.strength != null) {
            setLatestStrength(last.metadata.strength);
          }
        }

        // If no messages exist, trigger initial analysis
        if (data.messages.length === 0 && !initialAnalysisDone.current) {
          initialAnalysisDone.current = true;
          await triggerAnalysis();
        }
      } catch {
        setError("Failed to load conversation history");
      } finally {
        setLoading(false);
      }
    }
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disputeId, userRole]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  async function triggerAnalysis() {
    setSending(true);
    setError(null);
    try {
      const data = await api.post<AnalyzeResponse>(
        `/disputes/${disputeId}/advisor/analyze`,
      );
      setMessages((prev) => [...prev, data.analysis]);
      if (data.strength != null) setLatestStrength(data.strength);
      if (data.action_suggestions) setLatestActions(data.action_suggestions);
    } catch {
      setError("Failed to get initial analysis");
    } finally {
      setSending(false);
    }
  }

  async function handleSend() {
    const message = input.trim();
    if (!message || sending) return;

    setInput("");
    setSending(true);
    setError(null);

    // Optimistic: add user message immediately
    const optimisticMsg: AdvisorMsg = {
      id: `temp-${Date.now()}`,
      dispute_id: disputeId,
      role: `${userRole}_user`,
      content: message,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMsg]);

    try {
      const data = await api.post<ChatResponse>(
        `/disputes/${disputeId}/advisor/chat`,
        { message },
      );

      // Replace optimistic message with real one + add advisor response
      setMessages((prev) => {
        const filtered = prev.filter((m) => m.id !== optimisticMsg.id);
        // The server saved the user message, but we only get the reply back.
        // Re-add the user message with proper data, then the advisor reply.
        return [
          ...filtered,
          { ...optimisticMsg, id: `user-${Date.now()}` },
          data.reply,
        ];
      });

      if (data.strength_assessment != null) {
        setLatestStrength(data.strength_assessment);
      }
      if (data.action_suggestions) {
        setLatestActions(data.action_suggestions);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to send message",
      );
      // Remove optimistic message on error
      setMessages((prev) =>
        prev.filter((m) => m.id !== optimisticMsg.id),
      );
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleActionClick(action: string) {
    setInput(`Tell me more about: ${action}`);
    inputRef.current?.focus();
  }

  function isAdvisorMessage(msg: AdvisorMsg): boolean {
    return msg.role === "buyer_advisor" || msg.role === "seller_advisor";
  }

  function isBlockedMessage(msg: AdvisorMsg): boolean {
    return msg.metadata?.blocked === true;
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-bg-card/50 overflow-hidden flex flex-col" style={{ maxHeight: "600px" }}>
      {/* Header */}
      <div className={`px-4 py-3 border-b border-slate-800 flex items-center gap-2`}>
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={accentText}
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span className="text-sm font-semibold text-white">AI Advisor</span>
        <span className={`ml-auto rounded-full border px-2 py-0.5 text-xs font-medium ${accentBorder} ${accentText}`}>
          {userRole === "buyer" ? "Buyer" : "Seller"}
        </span>
      </div>

      {/* Strength Meter */}
      {latestStrength != null && (
        <div className="px-4 pt-2">
          <StrengthMeter value={latestStrength} />
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[200px]">
        {loading && (
          <div className="text-center text-sm text-slate-500 py-8">
            Loading conversation...
          </div>
        )}

        {!loading && messages.length === 0 && !sending && (
          <div className="text-center text-sm text-slate-500 py-8">
            Your AI Advisor will analyze your case shortly.
          </div>
        )}

        {messages.map((msg) => {
          const isAdvisor = isAdvisorMessage(msg);
          const isBlocked = isBlockedMessage(msg);

          if (isBlocked && !isAdvisor) {
            return (
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-[85%]">
                  <BlockedMessage reason={msg.metadata?.block_reason} />
                </div>
              </div>
            );
          }

          return (
            <div
              key={msg.id}
              className={`flex ${isAdvisor ? "justify-start" : "justify-end"}`}
            >
              <div
                className={`max-w-[85%] rounded-xl px-3 py-2 ${
                  isAdvisor
                    ? `border ${accentBorder} bg-slate-800/30`
                    : "bg-slate-700/50"
                }`}
              >
                {isAdvisor && (
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`text-xs font-bold uppercase ${accentText}`}>
                      Advisor
                    </span>
                    <span className="text-xs text-slate-600">
                      {new Date(msg.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                )}
                <div className="text-sm text-slate-300 whitespace-pre-wrap break-words">
                  {msg.content}
                </div>
                {!isAdvisor && (
                  <div className="text-right mt-0.5">
                    <span className="text-xs text-slate-600">
                      {new Date(msg.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                )}
                {isAdvisor && msg.metadata?.strength != null && (
                  <StrengthMeter value={msg.metadata.strength} />
                )}
              </div>
            </div>
          );
        })}

        {sending && <TypingIndicator />}

        <div ref={messagesEndRef} />
      </div>

      {/* Action Suggestions */}
      {latestActions.length > 0 && (
        <div className="px-4 pb-2">
          <ActionChips actions={latestActions} onAction={handleActionClick} />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-4 pb-2">
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        </div>
      )}

      {/* Input Bar */}
      <div className="border-t border-slate-800 p-3 flex items-end gap-2">
        <textarea
          ref={inputRef}
          rows={1}
          placeholder="Ask your AI Advisor..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={2000}
          disabled={sending}
          className="flex-1 rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-500/50 focus:outline-none resize-none disabled:opacity-50"
          style={{ maxHeight: "100px" }}
        />
        <button
          onClick={handleSend}
          disabled={sending || !input.trim()}
          className={`rounded-lg px-3 py-2 text-sm font-medium text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
            userRole === "buyer"
              ? "bg-cyan-500 hover:bg-cyan-600"
              : "bg-violet-500 hover:bg-violet-600"
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}

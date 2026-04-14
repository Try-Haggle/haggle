"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { initDemo, executeRound } from "@/lib/demo-api";
import type { ChatMessage, DemoInitResponse } from "@/lib/demo-types";
import { DemoHeader } from "./_components/demo-header";
import { ChatBubble } from "./_components/chat-bubble";
import { TypingIndicator } from "./_components/typing-indicator";
import { OfferInput } from "./_components/offer-input";
import { PriceChart } from "./_components/price-chart";
import { SavingsCard } from "./_components/savings-card";
import { Celebration } from "./_components/celebration";

/* ── Constants ────────────────────────────────── */

const MARKET_PRICE_CENTS = 92000;
const MARKET_PRICE = 920;

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "ko", label: "한국어" },
  { code: "ja", label: "日本語" },
  { code: "es", label: "Español" },
  { code: "zh", label: "中文" },
] as const;

/* ── Types ────────────────────────────────────── */

type DemoState = "LANG_SELECT" | "LOADING" | "READY" | "SENDING" | "SESSION_DONE";

interface PricePoint {
  round: number;
  buyer: number;
  seller: number;
}

interface DealResult {
  accepted: boolean;
  finalPrice: number;
  savings: number;
}

/* ── Helpers ──────────────────────────────────── */

let msgIdCounter = 0;
function createMsg(
  role: ChatMessage["role"],
  content: string,
  price?: number,
): ChatMessage {
  return {
    id: `msg-${++msgIdCounter}`,
    role,
    content,
    price,
    timestamp: Date.now(),
  };
}

function minorToDollars(minor: number): number {
  return Math.round(minor / 100);
}

/* ── Component ────────────────────────────────── */

export function UserDemo() {
  const [state, setState] = useState<DemoState>("LANG_SELECT");
  const [demoId, setDemoId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [phase, setPhase] = useState("OPENING");
  const [round, setRound] = useState(0);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [dealResult, setDealResult] = useState<DealResult | null>(null);
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([]);
  const [showCelebration, setShowCelebration] = useState(false);
  const [language, setLanguage] = useState("en");

  // Track last prices for "Split the Difference"
  const [lastBuyerPrice, setLastBuyerPrice] = useState<number | null>(null);
  const [lastSellerPrice, setLastSellerPrice] = useState<number | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  // Start demo with selected language
  const handleStart = useCallback(async () => {
    setState("LOADING");
    try {
      const res: DemoInitResponse = await initDemo({ language });
      setDemoId(res.demo_id);

      const targetDollars = minorToDollars(res.strategy.target_price);
      const floorDollars = minorToDollars(res.strategy.floor_price);

      setMessages([
        createMsg(
          "system",
          "Haggle's AI buyer is interested in your iPhone 15 Pro 256GB. The Swappa market price is $920. How much will you sell it for?",
        ),
        createMsg(
          "system",
          `AI budget range: $${targetDollars} - $${floorDollars}. Style: ${res.strategy.negotiation_style}.`,
        ),
      ]);
      setState("READY");
    } catch (err) {
      setMessages([
        createMsg(
          "system",
          `Failed to initialize demo session. ${err instanceof Error ? err.message : "Please try refreshing the page."}`,
        ),
      ]);
      setState("READY");
    }
  }, [language]);

  // Handle user offer submission
  const handleOffer = useCallback(
    async (priceDollars: number) => {
      if (!demoId || sending || done) return;

      setSending(true);
      setState("SENDING");

      // Add seller message
      setMessages((prev) => [
        ...prev,
        createMsg("seller", `I'll sell it for $${priceDollars}.`, priceDollars * 100),
      ]);
      setLastSellerPrice(priceDollars * 100);

      try {
        const res = await executeRound(demoId, {
          seller_price: priceDollars,
        });

        const buyerPriceDollars = minorToDollars(res.state.buyer_price);
        const sellerPriceDollars = minorToDollars(res.state.seller_price);
        const decisionPrice = minorToDollars(res.final.decision.price);

        // Update state
        setPhase(res.phase);
        setRound(res.round);
        setLastBuyerPrice(res.state.buyer_price);
        setLastSellerPrice(res.state.seller_price);

        // Update price history
        setPriceHistory((prev) => [
          ...prev,
          {
            round: res.round,
            buyer: buyerPriceDollars,
            seller: sellerPriceDollars,
          },
        ]);

        // Build AI response message
        const action = res.final.decision.action;
        let aiContent = res.final.rendered_message;

        if (action === "COUNTER") {
          aiContent =
            aiContent || `I'd like to counter at $${decisionPrice}.`;
        } else if (action === "ACCEPT" || action === "CONFIRM") {
          aiContent = aiContent || `Deal! I'll take it for $${decisionPrice}.`;
        } else if (action === "REJECT") {
          aiContent =
            aiContent || "Sorry, I can't agree to that price. No deal.";
        }

        setMessages((prev) => [
          ...prev,
          createMsg(
            "buyer",
            aiContent,
            action === "REJECT" ? undefined : res.final.decision.price,
          ),
        ]);

        // Check if session is done
        if (res.state.done) {
          setDone(true);
          setState("SESSION_DONE");

          const accepted =
            action === "ACCEPT" || action === "CONFIRM";
          const finalDollars = accepted ? decisionPrice : 0;
          const savings = accepted ? MARKET_PRICE - finalDollars : 0;

          setDealResult({ accepted, finalPrice: finalDollars, savings });

          if (accepted) {
            setShowCelebration(true);
            setMessages((prev) => [
              ...prev,
              createMsg(
                "system",
                `Deal closed at $${finalDollars}! That's $${savings} below market price.`,
              ),
            ]);
          } else {
            setMessages((prev) => [
              ...prev,
              createMsg(
                "system",
                "The negotiation has ended without a deal.",
              ),
            ]);
          }
        } else {
          setState("READY");
        }
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          createMsg(
            "system",
            `Error: ${err instanceof Error ? err.message : "Something went wrong. Please try again."}`,
          ),
        ]);
        setState("READY");
      } finally {
        setSending(false);
      }
    },
    [demoId, sending, done],
  );

  // Restart demo — go back to language selection
  const handleRestart = useCallback(() => {
    msgIdCounter = 0;
    setDemoId(null);
    setMessages([]);
    setPhase("OPENING");
    setRound(0);
    setSending(false);
    setDone(false);
    setDealResult(null);
    setPriceHistory([]);
    setShowCelebration(false);
    setLastBuyerPrice(null);
    setLastSellerPrice(null);
    setState("LANG_SELECT");
  }, []);

  return (
    <div className="min-h-screen">
      {showCelebration && <Celebration />}

      <section className="mx-auto max-w-2xl px-4 sm:px-6 pt-10 sm:pt-14 pb-20">
        {/* Page title */}
        <div className="text-center mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">
            Try AI Negotiation
          </h1>
          <p className="text-slate-400 text-sm">
            Haggle&apos;s AI wants to buy your iPhone. How much will you sell it
            for?
          </p>
        </div>

        {/* Language selection screen */}
        {state === "LANG_SELECT" && (
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-6 mb-6 text-center">
            <p className="text-sm text-slate-400 mb-4">
              Choose the language for AI responses
            </p>
            <div className="flex flex-wrap justify-center gap-2 mb-5">
              {LANGUAGES.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  onClick={() => setLanguage(l.code)}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${
                    language === l.code
                      ? "bg-cyan-600 text-white"
                      : "border border-slate-700 bg-slate-900/60 text-slate-400 hover:border-cyan-500/50 hover:text-white"
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleStart}
              className="rounded-xl bg-cyan-600 px-8 py-3 text-sm font-semibold text-white hover:bg-cyan-500 transition-colors cursor-pointer"
            >
              Start Negotiation
            </button>
          </div>
        )}

        {/* Header bar */}
        {state !== "LANG_SELECT" && <DemoHeader phase={phase} round={round} />}

        {/* Price chart */}
        {state !== "LANG_SELECT" && <PriceChart priceHistory={priceHistory} />}

        {/* Chat area */}
        <div className={`mb-4 space-y-3 max-h-[420px] overflow-y-auto rounded-xl border border-slate-800 bg-slate-900/50 p-4 scroll-smooth ${state === "LANG_SELECT" ? "hidden" : ""}`}>
          {state === "LOADING" && messages.length === 0 && (
            <div className="flex justify-center py-8">
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <svg
                  className="animate-spin h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Initializing AI buyer...
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <ChatBubble
              key={msg.id}
              role={msg.role}
              content={msg.content}
              price={msg.price}
            />
          ))}

          {sending && <TypingIndicator />}

          <div ref={chatEndRef} />
        </div>

        {/* Offer input */}
        {!done && (
          <OfferInput
            round={round}
            sending={sending}
            done={done || state === "LOADING"}
            lastBuyerPrice={lastBuyerPrice}
            lastSellerPrice={lastSellerPrice}
            onSubmit={handleOffer}
          />
        )}

        {/* Result card */}
        {dealResult && (
          <div className="mt-6">
            <SavingsCard
              finalPrice={dealResult.finalPrice}
              accepted={dealResult.accepted}
              onRestart={handleRestart}
            />
          </div>
        )}
      </section>

      {/* Global animations */}
      <style jsx global>{`
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }

        @keyframes typing-bounce {
          0%,
          80%,
          100% {
            transform: translateY(0);
          }
          40% {
            transform: translateY(-6px);
          }
        }

        @keyframes confetti-rise {
          0% {
            opacity: 1;
            transform: translateY(0) translateX(0) rotate(0deg);
          }
          100% {
            opacity: 0;
            transform: translateY(-100vh) translateX(var(--drift, 0px))
              rotate(720deg);
          }
        }
      `}</style>
    </div>
  );
}

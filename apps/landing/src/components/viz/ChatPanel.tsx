"use client";

import { useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { AGENTS } from "@/lib/data/agents";

/**
 * Step 02 viz — Two agents (Hugo ↔ Pepper) negotiating.
 *
 * Cycle (10s):
 *  Messages 1–4 appear sequentially as typing → reveal as text.
 *  t=5.5s: panel dims, "Deal settled · $785" banner pops, confetti burst.
 *  t=10s : reset and replay.
 */

type Sender = "hugo" | "pepper";

interface Message {
  sender: Sender;
  text: React.ReactNode;
}

const MESSAGES: Message[] = [
  { sender: "hugo", text: "How long have you had it?" },
  {
    sender: "pepper",
    text: (
      <>
        8 months. Always in a case. Battery at{" "}
        <span className="font-mono text-[12.5px] font-medium tracking-[0.01em]">
          91%
        </span>
        .
      </>
    ),
  },
  {
    sender: "hugo",
    text: (
      <>
        Fair. I can do{" "}
        <span className="font-mono text-[12.5px] font-medium tracking-[0.01em]">
          $750
        </span>
        .
      </>
    ),
  },
  {
    sender: "pepper",
    text: (
      <>
        Meet at{" "}
        <span className="font-mono text-[12.5px] font-medium tracking-[0.01em]">
          $785
        </span>
        ? Original box included.
      </>
    ),
  },
];

// Per-message timing (ms): appear → reveal
const TIMELINE = [
  { appear: 300, reveal: 700 }, // Hugo
  { appear: 1300, reveal: 1900 }, // Pepper
  { appear: 2900, reveal: 3400 }, // Hugo
  { appear: 4000, reveal: 4600 }, // Pepper
];

const BANNER_AT = 5500;
const CYCLE_MS = 10000;

const BRAND_COLORS = [
  "#D69A4C",
  "#DCAA5E",
  "#E6BC74",
  "#B8823E",
  "#9A6A24",
  "#1B2A4A",
  "#4F6088",
  "#F6E6CC",
];

function Avatar({ sender }: { sender: Sender }) {
  const agent = AGENTS[sender];
  const bg = sender === "hugo" ? "bg-[#F6E6CC]" : "bg-[#EAF4ED]";
  return (
    <span
      className={`inline-flex h-5.5 w-5.5 shrink-0 items-center justify-center overflow-hidden rounded-full ${bg}`}
      dangerouslySetInnerHTML={{ __html: agent.svg }}
    />
  );
}

interface MessageState {
  visible: boolean;
  typing: boolean;
}

const INITIAL_STATES: MessageState[] = MESSAGES.map(() => ({
  visible: false,
  typing: false,
}));

function MessageBubble({
  msg,
  state,
}: {
  msg: Message;
  state: MessageState;
}) {
  const isHugo = msg.sender === "hugo";
  return (
    <div
      className={`flex max-w-[78%] flex-col gap-1 transition-opacity duration-300 ${
        isHugo ? "items-start self-start" : "items-end self-end"
      } ${state.visible ? "opacity-100" : "opacity-0"}`}
    >
      <div
        className={`flex items-center gap-1.75 px-0.5 ${
          isHugo ? "" : "flex-row-reverse"
        }`}
      >
        <Avatar sender={msg.sender} />
        <span className="font-mono text-[10px] font-medium tracking-[0.14em] text-neutral-600 uppercase">
          {isHugo ? "Hugo" : "Pepper"}
        </span>
      </div>
      <div
        className={`px-3.25 py-2.25 text-[13px] leading-[1.45] tracking-[-0.005em] ${
          isHugo
            ? "rounded-[14px_14px_14px_4px] bg-navy-500 text-white"
            : "rounded-[14px_14px_4px_14px] border border-[color-mix(in_oklab,var(--color-gold-200)_50%,transparent)] bg-gold-50 text-navy-500"
        }`}
      >
        {state.typing ? (
          <span className="inline-flex items-center gap-1 py-0.5">
            <span
              className={`block h-1.25 w-1.25 rounded-full animate-[typing-bounce_1.2s_infinite_ease-in-out] ${
                isHugo ? "bg-white opacity-60" : "bg-navy-500 opacity-40"
              }`}
            />
            <span
              className={`block h-1.25 w-1.25 rounded-full animate-[typing-bounce_1.2s_infinite_ease-in-out] [animation-delay:0.15s] ${
                isHugo ? "bg-white opacity-60" : "bg-navy-500 opacity-40"
              }`}
            />
            <span
              className={`block h-1.25 w-1.25 rounded-full animate-[typing-bounce_1.2s_infinite_ease-in-out] [animation-delay:0.3s] ${
                isHugo ? "bg-white opacity-60" : "bg-navy-500 opacity-40"
              }`}
            />
          </span>
        ) : (
          msg.text
        )}
      </div>
    </div>
  );
}

export function ChatPanel() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const confettiInstance = useRef<ReturnType<typeof confetti.create> | null>(
    null,
  );

  const [states, setStates] = useState<MessageState[]>(INITIAL_STATES);
  const [bannerVisible, setBannerVisible] = useState(false);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;

    // Lazy create confetti instance bound to our scoped canvas
    if (!confettiInstance.current) {
      confettiInstance.current = confetti.create(canvas, {
        resize: true,
        useWorker: true,
      });
    }

    const timers: ReturnType<typeof setTimeout>[] = [];

    function reset() {
      setStates(INITIAL_STATES);
      setBannerVisible(false);
      setSettled(false);
      confettiInstance.current?.reset();
    }

    function setMessageState(idx: number, next: Partial<MessageState>) {
      setStates((prev) => {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], ...next };
        return copy;
      });
    }

    function launchConfetti() {
      const fire = confettiInstance.current;
      const localCanvas = canvasRef.current;
      if (!fire || !localCanvas) return;
      const rect = localCanvas.getBoundingClientRect();
      const originY = (rect.height / 2 + 30) / Math.max(rect.height, 1);

      fire({
        particleCount: 130,
        spread: 90,
        startVelocity: 28,
        ticks: 220,
        gravity: 0.9,
        decay: 0.92,
        scalar: 0.9,
        origin: { x: 0.5, y: originY },
        colors: BRAND_COLORS,
        shapes: ["square", "circle"],
      });
      timers.push(
        setTimeout(() => {
          fire({
            particleCount: 70,
            angle: 60,
            spread: 55,
            startVelocity: 26,
            ticks: 220,
            gravity: 0.9,
            decay: 0.92,
            scalar: 0.85,
            origin: { x: 0.3, y: originY },
            colors: BRAND_COLORS,
            shapes: ["square", "circle"],
          });
        }, 100),
      );
      timers.push(
        setTimeout(() => {
          fire({
            particleCount: 70,
            angle: 120,
            spread: 55,
            startVelocity: 26,
            ticks: 220,
            gravity: 0.9,
            decay: 0.92,
            scalar: 0.85,
            origin: { x: 0.7, y: originY },
            colors: BRAND_COLORS,
            shapes: ["square", "circle"],
          });
        }, 100),
      );
    }

    function play() {
      reset();

      TIMELINE.forEach(({ appear, reveal }, idx) => {
        timers.push(
          setTimeout(
            () => setMessageState(idx, { visible: true, typing: true }),
            appear,
          ),
        );
        timers.push(
          setTimeout(() => setMessageState(idx, { typing: false }), reveal),
        );
      });

      timers.push(
        setTimeout(() => {
          setSettled(true);
          setBannerVisible(true);
          launchConfetti();
        }, BANNER_AT),
      );

      timers.push(setTimeout(play, CYCLE_MS));
    }

    let running = false;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        if (visible && !running) {
          running = true;
          play();
        } else if (!visible && running) {
          running = false;
          timers.forEach(clearTimeout);
          timers.length = 0;
          confettiInstance.current?.reset();
        }
      },
      { threshold: 0.3 },
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
      timers.forEach(clearTimeout);
      confettiInstance.current?.reset();
    };
  }, []);

  return (
    <div ref={rootRef} className="relative w-full font-sans">
      <div className="relative">
        {/* Messages — dimmed when settled so the banner reads as the climax */}
        <div
          className={`relative flex flex-col gap-3.5 transition-opacity duration-500 ${
            settled ? "opacity-40" : "opacity-100"
          }`}
        >
          {MESSAGES.map((msg, i) => (
            <MessageBubble key={i} msg={msg} state={states[i]} />
          ))}
        </div>

        {/* Deal banner — overlay centered over messages */}
        <div
          className={`pointer-events-none absolute inset-0 z-10 flex items-center justify-center transition-opacity duration-500 ${
            bannerVisible ? "opacity-100" : "opacity-0"
          }`}
        >
          <div
            className={`inline-flex items-center gap-3.5 rounded-full px-5.5 py-3.5 transition-transform duration-500 ${
              bannerVisible
                ? "translate-y-0 scale-100"
                : "translate-y-1.5 scale-90"
            }`}
            style={{
              background:
                "linear-gradient(135deg, var(--color-navy-500) 0%, var(--color-navy-600) 100%)",
              boxShadow:
                "0 16px 40px -12px rgba(27,42,74,0.4), 0 2px 8px -2px rgba(27,42,74,0.15)",
            }}
          >
            <span className="inline-flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-success-500 text-white">
              <svg viewBox="0 0 12 12" className="h-2.75 w-2.75">
                <polyline
                  points="2.5,6 5,8.5 9.5,3.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="font-mono text-[11px] font-medium tracking-[0.18em] text-gold-300 uppercase">
              Deal settled
            </span>
            <span className="h-4.5 w-px bg-white/20" />
            <span className="font-serif text-[20px] font-medium tracking-[-0.005em] text-white tabular-nums">
              $785
            </span>
          </div>
        </div>

        {/* Confetti canvas — above banner so pieces burst over it */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 overflow-visible"
        >
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full"
          />
        </div>
      </div>
    </div>
  );
}

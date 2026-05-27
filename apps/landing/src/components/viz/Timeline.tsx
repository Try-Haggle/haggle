"use client";

import { useEffect, useRef, useState } from "react";

interface Stage {
  label: string;
  icon: React.ReactNode;
}

const STAGES: Stage[] = [
  {
    label: "Agreed",
    icon: (
      <svg viewBox="0 0 14 14" fill="none">
        <path
          d="M2 6l3-3 2 2-2 2-3-1zm10 0l-3-3-2 2 2 2 3-1zM4 7l3 3 3-3"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    label: "Escrow",
    icon: (
      <svg viewBox="0 0 14 14" fill="none">
        <rect
          x="3"
          y="6"
          width="8"
          height="6"
          rx="1"
          stroke="currentColor"
          strokeWidth="1.3"
        />
        <path d="M5 6V4a2 2 0 014 0v2" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    ),
  },
  {
    label: "Delivered",
    icon: (
      <svg viewBox="0 0 14 14" fill="none">
        <path
          d="M2 4l5-2 5 2v6l-5 2-5-2V4z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path
          d="M2 4l5 2 5-2M7 6v6"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    label: "Released",
    icon: (
      <svg viewBox="0 0 14 14" fill="none">
        <rect
          x="2"
          y="4"
          width="10"
          height="7"
          rx="1"
          stroke="currentColor"
          strokeWidth="1.3"
        />
        <path d="M9 7.5h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
];

type StageState = "pending" | "active" | "done";

const CHECK_ICON = (
  <svg viewBox="0 0 14 14" fill="none">
    <path
      d="M3 7l2.5 2.5L11 4.5"
      stroke="#fff"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const CYCLE_MS = 8500;

export function Timeline() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [states, setStates] = useState<StageState[]>([
    "pending",
    "pending",
    "pending",
    "pending",
  ]);
  const [barWidth, setBarWidth] = useState<string>("0%");
  // When true the bar uses a fast (1.5s) growth transition. When false
  // (during reset between cycles) the bar snaps to its new width with
  // no transition so the next cycle starts cleanly from 0%.
  const [barAnimating, setBarAnimating] = useState(false);
  const [summaryVisible, setSummaryVisible] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const timers: ReturnType<typeof setTimeout>[] = [];

    function reset() {
      setStates(["pending", "pending", "pending", "pending"]);
      // Snap bar to 0 without transition.
      setBarAnimating(false);
      setBarWidth("0%");
      setSummaryVisible(false);
    }

    function step(idx: number, status: StageState) {
      setStates((prev) => {
        const next = [...prev];
        next[idx] = status;
        return next;
      });
    }

    function runCycle() {
      reset();

      // Re-enable the transition on the next frame so the snap-to-0%
      // above commits without animating, and the subsequent growth steps
      // animate normally.
      timers.push(
        setTimeout(() => setBarAnimating(true), 60),
      );

      timers.push(setTimeout(() => step(0, "active"), 500));
      timers.push(
        setTimeout(() => {
          step(0, "done");
          setBarWidth("33.33%");
        }, 900),
      );

      timers.push(setTimeout(() => step(1, "active"), 1700));
      timers.push(
        setTimeout(() => {
          step(1, "done");
          setBarWidth("66.66%");
        }, 2100),
      );

      timers.push(setTimeout(() => step(2, "active"), 2900));
      timers.push(
        setTimeout(() => {
          step(2, "done");
          setBarWidth("100%");
        }, 3300),
      );

      timers.push(setTimeout(() => step(3, "active"), 4100));
      timers.push(
        setTimeout(() => {
          step(3, "done");
          setSummaryVisible(true);
        }, 4500),
      );

      timers.push(setTimeout(runCycle, CYCLE_MS));
    }

    let running = false;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        if (visible && !running) {
          running = true;
          runCycle();
        } else if (!visible && running) {
          running = false;
          timers.forEach(clearTimeout);
          timers.length = 0;
        }
      },
      { threshold: 0.3 },
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div ref={rootRef} className="relative w-full px-3 pt-9 pb-6">
      {/* Track row */}
      <div className="relative grid grid-cols-4 items-start">
        {/* Bar */}
        <div className="absolute top-4.5 right-[12.5%] left-[12.5%] h-0.75 overflow-hidden rounded-xs bg-neutral-200">
          <div
            className="absolute top-0 left-0 h-full rounded-xs"
            style={{
              width: barWidth,
              background:
                "linear-gradient(90deg, var(--color-gold-400) 0%, var(--color-gold-600) 100%)",
              // Transition only while a cycle is progressing — reset snaps
              // the bar back to 0 instantly so the next cycle starts clean.
              transition: barAnimating
                ? "width 1.5s cubic-bezier(0.4, 0, 0.2, 1)"
                : "none",
            }}
          />
        </div>

        {STAGES.map((stage, i) => {
          const status = states[i];
          const markerBg =
            status === "done"
              ? "bg-success-500"
              : status === "active"
                ? "bg-gold-50"
                : "bg-surface-raised";
          const markerBorder =
            status === "done"
              ? "border-success-500"
              : status === "active"
                ? "border-gold-500"
                : "border-neutral-200";
          const iconColor =
            status === "done"
              ? "text-transparent"
              : status === "active"
                ? "text-gold-700"
                : "text-neutral-400";
          const labelColor =
            status === "pending" ? "text-neutral-500" : "text-navy-500";

          return (
            <div
              key={stage.label}
              className="relative flex flex-col items-center gap-3"
            >
              <div
                className={`relative z-2 flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all duration-400 ${markerBg} ${markerBorder} ${
                  status === "done" ? "scale-110" : ""
                }`}
              >
                {/* Pulse ring (active only) */}
                {status === "active" && (
                  <span
                    aria-hidden="true"
                    className="absolute -inset-1.5 rounded-full border-2 border-gold-400 opacity-60 animate-[timeline-pulse_1.4s_ease-out_infinite]"
                  />
                )}
                <span
                  className={`absolute h-3.5 w-3.5 transition-opacity duration-300 ${iconColor}`}
                >
                  {stage.icon}
                </span>
                {status === "done" && (
                  <span className="absolute h-3.5 w-3.5">{CHECK_ICON}</span>
                )}
              </div>
              <div
                className={`text-center font-mono text-[11px] font-medium tracking-[0.06em] transition-colors duration-300 ${labelColor}`}
              >
                {stage.label}
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary */}
      <div className="mt-7 flex flex-col items-center gap-2.5">
        <div
          className={`font-serif text-4xl font-medium tracking-[-0.02em] text-navy-500 transition-all duration-500 ${
            summaryVisible
              ? "translate-y-0 opacity-100"
              : "translate-y-2 opacity-0"
          }`}
        >
          <em
            className="bg-clip-text font-medium text-transparent not-italic"
            style={{ backgroundImage: "var(--gradient-text-gold)" }}
          >
            $785
          </em>{" "}
          · released
        </div>
        <div
          className={`font-mono text-[11px] tracking-[0.16em] text-neutral-500 uppercase transition-opacity delay-150 duration-500 ${
            summaryVisible ? "opacity-100" : "opacity-0"
          }`}
        >
          Smart contract · We never touched it
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Step 01 viz — Agent personality radar + chat/settings panel transition.
 *
 * Cycle (9s):
 *  t=0    : chat panel + initial radar
 *  t=3s   : radar morphs to "afterChat" (held ground)
 *  t=5s   : panel switches to settings
 *  t=6.3s : settings sliders nudge + radar to "afterSettings"
 */

// 8 octagon directions (matches CSS unit vectors)
const OCT_UNIT = [
  { dx: 0, dy: -1 },
  { dx: 0.7071, dy: -0.7071 },
  { dx: 1, dy: 0 },
  { dx: 0.7071, dy: 0.7071 },
  { dx: 0, dy: 1 },
  { dx: -0.7071, dy: 0.7071 },
  { dx: -1, dy: 0 },
  { dx: -0.7071, dy: -0.7071 },
];

const STAT_KEYS = [
  "anchoring",
  "tenacity",
  "resolve",
  "marketsense",
  "riskradar",
  "scrutiny",
  "patience",
  "rapport",
] as const;

type StatKey = (typeof STAT_KEYS)[number];
type RadarState = Record<StatKey, number>;
type WeightKey = "price" | "time" | "risk" | "social";
type WeightState = Record<WeightKey, number>;
type ExpertKey = "anchor" | "deadline";
type ExpertState = Record<ExpertKey, number>;

interface State {
  radar: RadarState;
  weights: WeightState;
  expert: ExpertState;
}

const STATES: Record<"initial" | "afterChat" | "afterSettings", State> = {
  initial: {
    radar: {
      anchoring: 6,
      tenacity: 5,
      resolve: 5,
      marketsense: 7,
      riskradar: 6,
      scrutiny: 7,
      patience: 7,
      rapport: 6,
    },
    weights: { price: 0.4, time: 0.25, risk: 0.25, social: 0.1 },
    expert: { anchor: 0.55, deadline: 0.5 },
  },
  afterChat: {
    radar: {
      anchoring: 9,
      tenacity: 9,
      resolve: 9,
      marketsense: 7,
      riskradar: 6,
      scrutiny: 7,
      patience: 4,
      rapport: 3,
    },
    weights: { price: 0.3, time: 0.2, risk: 0.35, social: 0.15 },
    expert: { anchor: 0.8, deadline: 0.65 },
  },
  afterSettings: {
    radar: {
      anchoring: 9,
      tenacity: 9,
      resolve: 10,
      marketsense: 7,
      riskradar: 7,
      scrutiny: 7,
      patience: 4,
      rapport: 3,
    },
    weights: { price: 0.28, time: 0.18, risk: 0.4, social: 0.14 },
    expert: { anchor: 0.9, deadline: 0.7 },
  },
};

const STATS = [
  { label: "ANCHORING", x: 0, y: -115, anchor: "middle" },
  { label: "TENACITY", x: 80, y: -78, anchor: "start" },
  { label: "RESOLVE", x: 108, y: 3, anchor: "start" },
  { label: "MARKET", x: 80, y: 84, anchor: "start" },
  { label: "RISK RADAR", x: 0, y: 123, anchor: "middle" },
  { label: "SCRUTINY", x: -80, y: 84, anchor: "end" },
  { label: "PATIENCE", x: -108, y: 3, anchor: "end" },
  { label: "RAPPORT", x: -80, y: -78, anchor: "end" },
] as const;

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function interpolate<T extends Record<string, number>>(
  start: T,
  end: T,
  eased: number,
): T {
  const out = {} as Record<string, number>;
  Object.keys(end).forEach((k) => {
    out[k] = start[k] + (end[k] - start[k]) * eased;
  });
  return out as T;
}

// ============================================================
// Radar SVG
// ============================================================
function Radar({ state }: { state: RadarState }) {
  const points = STAT_KEYS.map((k, i) => {
    const r = state[k] * 10;
    const u = OCT_UNIT[i];
    return `${(u.dx * r).toFixed(2)},${(u.dy * r).toFixed(2)}`;
  }).join(" ");

  return (
    <div className="aspect-square max-h-85 w-full">
      <svg
        viewBox="-155 -135 310 270"
        xmlns="http://www.w3.org/2000/svg"
        className="block h-full w-full"
      >
        <defs>
          <linearGradient id="viz-gold-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#DCAA5E" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#9A6A24" stopOpacity="0.75" />
          </linearGradient>
        </defs>

        <g stroke="#DDD3C2" strokeWidth="0.8" fill="none" strokeLinejoin="round">
          <polygon points="25,0 17.68,17.68 0,25 -17.68,17.68 -25,0 -17.68,-17.68 0,-25 17.68,-17.68" />
          <polygon points="50,0 35.36,35.36 0,50 -35.36,35.36 -50,0 -35.36,-35.36 0,-50 35.36,-35.36" />
          <polygon points="75,0 53.03,53.03 0,75 -53.03,53.03 -75,0 -53.03,-53.03 0,-75 53.03,-53.03" />
          <polygon
            points="100,0 70.71,70.71 0,100 -70.71,70.71 -100,0 -70.71,-70.71 0,-100 70.71,-70.71"
            stroke="#C8BDA8"
          />
        </g>

        <g stroke="#DDD3C2" strokeWidth="0.8">
          <line x1="0" y1="0" x2="0" y2="-100" />
          <line x1="0" y1="0" x2="70.71" y2="-70.71" />
          <line x1="0" y1="0" x2="100" y2="0" />
          <line x1="0" y1="0" x2="70.71" y2="70.71" />
          <line x1="0" y1="0" x2="0" y2="100" />
          <line x1="0" y1="0" x2="-70.71" y2="70.71" />
          <line x1="0" y1="0" x2="-100" y2="0" />
          <line x1="0" y1="0" x2="-70.71" y2="-70.71" />
        </g>

        <polygon
          points={points}
          fill="url(#viz-gold-grad)"
          fillOpacity="0.85"
          stroke="#B8823E"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />

        {STAT_KEYS.map((k, i) => {
          const r = state[k] * 10;
          const u = OCT_UNIT[i];
          return (
            <circle
              key={k}
              cx={(u.dx * r).toFixed(2)}
              cy={(u.dy * r).toFixed(2)}
              r="2.6"
              fill="#9A6A24"
            />
          );
        })}

        <g
          fontFamily="IBM Plex Mono, monospace"
          fontSize="8"
          fill="#4F4B40"
          letterSpacing="0.5"
        >
          {STATS.map((s) => (
            <text key={s.label} x={s.x} y={s.y} textAnchor={s.anchor}>
              {s.label}
            </text>
          ))}
        </g>
      </svg>
    </div>
  );
}

// ============================================================
// Chat panel
//
// Timeline (mirrors original HTML):
//   0.05s : b1 (user bubble) fades in
//   0.9s  : b2 (typing dots) fades in
//   1.75s : b2 starts fading out
//   1.8s  : b3 (agent answer) fades in — same grid cell as b2
// ============================================================
function ChatBubblesPanel({ visible }: { visible: boolean }) {
  // `entered` lags `visible` by one frame so the CSS transitions fire
  // on first render (instead of starting already at opacity-100).
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (visible) {
      setEntered(false);
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => setEntered(true));
      });
      return () => cancelAnimationFrame(id);
    } else {
      setEntered(false);
    }
  }, [visible]);

  return (
    <div
      className={`absolute inset-0 flex flex-col items-stretch justify-center gap-3.5 transition-all duration-450 ${
        visible
          ? "pointer-events-auto translate-y-0 opacity-100"
          : "pointer-events-none translate-y-2 opacity-0"
      }`}
    >
      <div className="w-full px-1">
        <span className="font-mono text-[11px] font-medium tracking-[0.16em] text-navy-500 uppercase">
          Describe it
        </span>
      </div>
      <div className="flex flex-col gap-2.5 px-1">
        {/* b1 — user bubble (0.05s fade-in) */}
        <div
          className={`max-w-[92%] self-end rounded-[14px] rounded-br-[5px] bg-navy-500 px-4 py-3 text-[13.5px] leading-normal tracking-[-0.005em] text-surface-raised transition-all duration-350 ${
            entered
              ? "translate-y-0 opacity-100 delay-[0.05s]"
              : "translate-y-1.5 opacity-0"
          }`}
        >
          Make Hugo hold his ground more.
        </div>

        {/* Reply slot — b2 (typing) and b3 (answer) overlap in the same
            grid cell so b3 replaces b2 in place. Items are left-aligned
            via justify-items so the small typing pill doesn't stretch. */}
        <div className="grid max-w-[92%] grid-cols-1 justify-items-start self-start">
          {/* b2 — typing dots (0.9s fade-in, 1.75s fade-out).
              Compact pill — just wide enough for 3 dots. */}
          <div
            className={`col-start-1 row-start-1 inline-flex items-center gap-1 rounded-[14px] rounded-bl-[5px] border border-neutral-100 bg-surface-raised px-3 py-2.5 transition-all duration-350 ${
              entered
                ? "translate-y-0 opacity-100 delay-[0.9s] animate-[chat-b2-out_350ms_ease_1.75s_forwards]"
                : "translate-y-1.5 opacity-0"
            }`}
          >
            <span className="block h-1.25 w-1.25 rounded-full bg-neutral-400 animate-[typing-dot_1.2s_infinite_ease-in-out]" />
            <span className="block h-1.25 w-1.25 rounded-full bg-neutral-400 animate-[typing-dot_1.2s_infinite_ease-in-out] [animation-delay:0.15s]" />
            <span className="block h-1.25 w-1.25 rounded-full bg-neutral-400 animate-[typing-dot_1.2s_infinite_ease-in-out] [animation-delay:0.3s]" />
          </div>

          {/* b3 — agent answer (1.8s fade-in, replaces b2) */}
          <div
            className={`col-start-1 row-start-1 max-w-[92%] self-start rounded-[14px] rounded-bl-[5px] border border-neutral-100 bg-surface-raised px-4 py-3 font-mono text-[12px] leading-normal tracking-[0.02em] text-navy-500 transition-all duration-350 ${
              entered
                ? "translate-y-0 opacity-100 delay-[1.8s]"
                : "translate-y-1.5 opacity-0"
            }`}
          >
            Done.{" "}
            <strong className="font-medium text-gold-700">
              Resolve 5 → 9, Tenacity 5 → 9.
            </strong>{" "}
            Less patience, less rapport.
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Settings panel
// ============================================================
const WEIGHT_KEYS: WeightKey[] = ["price", "time", "risk", "social"];
const EXPERT_KEYS: ExpertKey[] = ["anchor", "deadline"];

function SettingRow({
  label,
  value,
  pct,
  compact,
  flash,
}: {
  label: string;
  value: number;
  pct: number;
  compact?: boolean;
  flash?: boolean;
}) {
  return (
    <div
      className={`grid items-center gap-2.5 ${
        compact
          ? "grid-cols-[84px_minmax(0,1fr)_34px] text-[8.5px]"
          : "grid-cols-[78px_minmax(0,1fr)_34px] text-[9px]"
      } tracking-[0.04em] text-neutral-700`}
    >
      <span
        className={`font-semibold tracking-[0.08em] uppercase ${
          compact ? "text-[8.5px]" : "text-[9px]"
        }`}
      >
        {label}
      </span>
      <span
        className={`relative rounded-full bg-neutral-100 ${
          compact ? "h-0.75" : "h-0.75"
        }`}
      >
        {/* No CSS transitions — the JS RAF loop sets value every frame */}
        <span
          className="absolute top-0 left-0 h-full rounded-full"
          style={{
            width: `${pct}%`,
            background:
              "linear-gradient(90deg, var(--color-gold-500), var(--color-gold-700))",
          }}
        />
        <span
          className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-surface-raised border-gold-600 ${
            compact ? "h-2 w-2 border-[1.5px]" : "h-2.5 w-2.5 border-2"
          }`}
          style={{
            left: `${pct}%`,
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        />
      </span>
      <span
        className={`text-right font-semibold tabular-nums transition-colors duration-300 ${
          flash ? "text-gold-700" : "text-navy-500"
        } ${compact ? "text-[9px]" : "text-[10px]"}`}
      >
        {value.toFixed(2)}
      </span>
    </div>
  );
}

function SettingsCard({
  weights,
  expert,
  flashKeys,
}: {
  weights: WeightState;
  expert: ExpertState;
  flashKeys: Set<string>;
}) {
  return (
    <div
      className="flex w-full flex-col gap-3 rounded-[14px] border border-neutral-100 bg-surface-raised px-4.5 py-3.5 font-mono"
      style={{ boxShadow: "0 4px 12px rgba(27,42,74,0.04)" }}
    >
      {/* Weights section */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2 pb-0.5">
          <span className="text-[8.5px] font-semibold tracking-[0.18em] text-navy-500 uppercase">
            Weights
          </span>
          <span className="text-[8px] tracking-widest text-neutral-500 uppercase">
            Sum 1.0
          </span>
        </div>
        {WEIGHT_KEYS.map((k) => (
          <SettingRow
            key={k}
            label={k}
            value={weights[k]}
            pct={weights[k] * 100}
            flash={flashKeys.has(`weight:${k}`)}
          />
        ))}
      </div>

      {/* Expert section */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2 pb-0.5">
          <span className="text-[8.5px] font-semibold tracking-[0.18em] text-gold-700 uppercase">
            Expert mode
          </span>
          <span className="text-[8px] tracking-widest text-neutral-500 uppercase">
            8 params
          </span>
        </div>
        {EXPERT_KEYS.map((k) => (
          <SettingRow
            key={k}
            label={k === "anchor" ? "Opening Anchor" : "Deadline Res."}
            value={expert[k]}
            pct={Math.min((expert[k] / 1.5) * 100, 100)}
            compact
            flash={flashKeys.has(`expert:${k}`)}
          />
        ))}
        <div className="pt-0.5 text-left text-[8.5px] tracking-widest text-neutral-500 uppercase">
          + 6 more parameters
        </div>
      </div>
    </div>
  );
}

function SettingsPanel({
  visible,
  weights,
  expert,
  flashKeys,
}: {
  visible: boolean;
  weights: WeightState;
  expert: ExpertState;
  flashKeys: Set<string>;
}) {
  return (
    <div
      className={`absolute inset-0 flex w-full flex-col items-stretch justify-center gap-3.5 transition-all duration-450 ${
        visible
          ? "pointer-events-auto translate-y-0 opacity-100"
          : "pointer-events-none translate-y-2 opacity-0"
      }`}
    >
      <div className="w-full px-1">
        <span className="font-mono text-[11px] font-medium tracking-[0.16em] text-gold-700 uppercase">
          Adjust it
        </span>
      </div>
      <SettingsCard weights={weights} expert={expert} flashKeys={flashKeys} />
    </div>
  );
}

// ============================================================
// Main component
// ============================================================
const CYCLE_MS = 9000;

export function RadarPanel() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  // "none" = neither panel visible (used as a brief gap between cycles
  // so the outgoing settings panel and incoming chat panel don't overlap)
  const [activePanel, setActivePanel] = useState<"chat" | "settings" | "none">(
    "none",
  );
  const [current, setCurrent] = useState<State>(STATES.initial);
  const [flashKeys, setFlashKeys] = useState<Set<string>>(new Set());

  // Track the latest rendered state in a ref so the next animateTo()
  // starts exactly where the last one ended (no stale closure).
  const currentRef = useRef<State>(STATES.initial);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const timers: ReturnType<typeof setTimeout>[] = [];

    function cancelAnim() {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    }

    function applyState(s: State) {
      currentRef.current = s;
      setCurrent(s);
    }

    function animateTo(target: State, duration: number) {
      cancelAnim();
      const start = currentRef.current;
      const startTime = performance.now();

      function tick(now: number) {
        const t = Math.min((now - startTime) / duration, 1);
        const eased = easeOutCubic(t);
        const next: State = {
          radar: interpolate(start.radar, target.radar, eased),
          weights: interpolate(start.weights, target.weights, eased),
          expert: interpolate(start.expert, target.expert, eased),
        };
        applyState(next);
        if (t < 1) {
          animFrameRef.current = requestAnimationFrame(tick);
        } else {
          animFrameRef.current = null;
          applyState(target);
        }
      }

      animFrameRef.current = requestAnimationFrame(tick);
    }

    function runCycle() {
      cancelAnim();
      applyState(STATES.initial);
      setFlashKeys(new Set());

      // t=0 — chat panel starts hidden so we get a clean fade-in.
      // (entered=false on mount → true via internal RAF inside ChatBubblesPanel)
      setActivePanel("chat");

      // t=3s — radar morphs to afterChat
      timers.push(
        setTimeout(() => animateTo(STATES.afterChat, 1100), 3000),
      );

      // t=5s — switch to settings panel
      timers.push(setTimeout(() => setActivePanel("settings"), 5000));

      // t=6.3s — nudge sliders + final radar tweak + flash highlights
      timers.push(
        setTimeout(() => {
          animateTo(STATES.afterSettings, 700);
          setFlashKeys(new Set(["weight:price", "expert:anchor"]));
          timers.push(setTimeout(() => setFlashKeys(new Set()), 900));
        }, 6300),
      );

      // t=8.4s — hide both panels for a brief gap before next cycle's
      // chat panel fades in. Prevents visual overlap between cycles.
      timers.push(setTimeout(() => setActivePanel("none"), 8400));

      // t=9s — next cycle
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
          cancelAnim();
          timers.forEach(clearTimeout);
          timers.length = 0;
        }
      },
      { threshold: 0.3 },
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnim();
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="relative flex h-full w-full items-center justify-center bg-transparent"
    >
      <div className="relative grid w-full grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] items-center gap-5">
        {/* LEFT — Radar */}
        <div className="flex w-full flex-col items-center justify-center">
          <Radar state={current.radar} />
        </div>
        {/* RIGHT — Panel stack */}
        <div className="relative flex min-h-75 w-full items-center justify-center">
          <ChatBubblesPanel visible={activePanel === "chat"} />
          <SettingsPanel
            visible={activePanel === "settings"}
            weights={current.weights}
            expert={current.expert}
            flashKeys={flashKeys}
          />
        </div>
      </div>
    </div>
  );
}

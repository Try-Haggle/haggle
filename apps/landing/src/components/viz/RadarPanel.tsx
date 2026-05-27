/**
 * Step 01 viz — Agent personality radar + chat panel.
 * Static for Phase 3: chat panel visible, settings panel hidden,
 * polygon at "initial" state. Morph + panel transition added in Phase 5.
 */

// Initial polygon points (radar values × 10):
// anchoring:6, tenacity:5, resolve:5, marketsense:7, riskradar:6, scrutiny:7, patience:7, rapport:6
const INITIAL_POINTS = [
  { x: 0, y: -60 },
  { x: 35.36, y: -35.36 },
  { x: 50, y: 0 },
  { x: 49.5, y: 49.5 },
  { x: 0, y: 60 },
  { x: -49.5, y: 49.5 },
  { x: -70, y: 0 },
  { x: -42.43, y: -42.43 },
];

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

function Radar() {
  const polyPoints = INITIAL_POINTS.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div className="aspect-square max-h-85 w-full">
      <svg viewBox="-155 -135 310 270" xmlns="http://www.w3.org/2000/svg" className="block h-full w-full">
        <defs>
          <linearGradient id="viz-gold-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#DCAA5E" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#9A6A24" stopOpacity="0.75" />
          </linearGradient>
        </defs>

        {/* Grid rings (octagons) */}
        <g stroke="#DDD3C2" strokeWidth="0.8" fill="none" strokeLinejoin="round">
          <polygon points="25,0 17.68,17.68 0,25 -17.68,17.68 -25,0 -17.68,-17.68 0,-25 17.68,-17.68" />
          <polygon points="50,0 35.36,35.36 0,50 -35.36,35.36 -50,0 -35.36,-35.36 0,-50 35.36,-35.36" />
          <polygon points="75,0 53.03,53.03 0,75 -53.03,53.03 -75,0 -53.03,-53.03 0,-75 53.03,-53.03" />
          <polygon
            points="100,0 70.71,70.71 0,100 -70.71,70.71 -100,0 -70.71,-70.71 0,-100 70.71,-70.71"
            stroke="#C8BDA8"
          />
        </g>

        {/* Spokes */}
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

        {/* Polygon */}
        <polygon
          points={polyPoints}
          fill="url(#viz-gold-grad)"
          fillOpacity="0.85"
          stroke="#B8823E"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />

        {/* Dots */}
        {INITIAL_POINTS.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="2.6" fill="#9A6A24" />
        ))}

        {/* Labels */}
        <g fontFamily="IBM Plex Mono, monospace" fontSize="8" fill="#4F4B40" letterSpacing="0.5">
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

function ChatBubblesPanel() {
  return (
    <div className="flex flex-col items-stretch justify-center gap-3.5">
      {/* Header */}
      <div className="w-full px-1">
        <span className="font-mono text-[11px] font-medium tracking-[0.16em] text-navy-500 uppercase">
          Describe it
        </span>
      </div>
      {/* Inner */}
      <div className="flex flex-col gap-2.5 px-1">
        {/* User bubble */}
        <div className="max-w-[92%] self-end rounded-[14px] rounded-br-[5px] bg-navy-500 px-4 py-3 text-[13.5px] leading-normal tracking-[-0.005em] text-surface-raised">
          Make Hugo hold his ground more.
        </div>
        {/* Agent reply */}
        <div className="max-w-[92%] self-start rounded-[14px] rounded-bl-[5px] border border-neutral-100 bg-surface-raised px-4 py-3 font-mono text-[12px] leading-normal tracking-[0.02em] text-navy-500">
          Done.{" "}
          <strong className="font-medium text-gold-700">
            Resolve 5 → 9, Tenacity 5 → 9.
          </strong>{" "}
          Less patience, less rapport.
        </div>
      </div>
    </div>
  );
}

export function RadarPanel() {
  return (
    <div className="relative flex h-full w-full items-center justify-center bg-transparent">
      <div className="relative grid w-full grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] items-center gap-5">
        {/* LEFT — Radar */}
        <div className="flex w-full flex-col items-center justify-center">
          <Radar />
        </div>
        {/* RIGHT — Chat panel (settings hidden in Phase 3) */}
        <div className="relative flex min-h-75 w-full items-center justify-center">
          <ChatBubblesPanel />
        </div>
      </div>
    </div>
  );
}

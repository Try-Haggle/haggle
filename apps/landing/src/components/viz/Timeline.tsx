/**
 * Step 03 viz — Progress timeline.
 * Static for Phase 3. Animation (sequential active → done) added in Phase 5.
 */

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

export function Timeline() {
  return (
    <div className="relative w-full px-3 pt-9 pb-6">
      {/* Track row */}
      <div className="relative grid grid-cols-4 items-start">
        {/* Bar */}
        <div className="absolute top-[18px] right-[12.5%] left-[12.5%] h-[3px] overflow-hidden rounded-[2px] bg-neutral-200">
          {/* Static fill — 0% for Phase 3 */}
          <div
            className="absolute top-0 left-0 h-full rounded-[2px]"
            style={{
              width: "0%",
              background:
                "linear-gradient(90deg, var(--color-gold-400) 0%, var(--color-gold-600) 100%)",
            }}
          />
        </div>

        {STAGES.map((stage) => (
          <div
            key={stage.label}
            className="relative flex flex-col items-center gap-3"
          >
            <div className="relative z-[2] flex h-9 w-9 items-center justify-center rounded-full border-2 border-neutral-200 bg-surface-raised">
              <span className="h-3.5 w-3.5 text-neutral-400">{stage.icon}</span>
            </div>
            <div className="text-center font-mono text-[11px] font-medium tracking-[0.06em] text-neutral-500">
              {stage.label}
            </div>
          </div>
        ))}
      </div>

      {/* Summary */}
      <div className="mt-7 flex flex-col items-center gap-2.5">
        <div className="font-serif text-4xl font-medium tracking-[-0.02em] text-navy-500 opacity-0">
          <em
            className="bg-clip-text font-medium text-transparent not-italic"
            style={{ backgroundImage: "var(--gradient-text-gold)" }}
          >
            $785
          </em>{" "}
          · released
        </div>
        <div className="font-mono text-[11px] tracking-[0.16em] text-neutral-500 uppercase opacity-0">
          Smart contract · We never touched it
        </div>
      </div>
    </div>
  );
}

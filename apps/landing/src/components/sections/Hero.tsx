import { COLUMN_LISTINGS } from "@/lib/data/listings";
import { ListingCard } from "@/components/viz/ListingCard";
import { APP_URL } from "@/lib/env";

const COL_OFFSET_PT = [0, 64, 32]; // px — column start offsets for masonry stagger

// Per-column animation config: each column scrolls at a different speed
// and starts at a different point in its loop, so the columns never sync.
const COL_ANIM = [
  { duration: "38s", delay: "0s" },
  { duration: "28s", delay: "-9s" },
  { duration: "46s", delay: "-18s" },
];

export function Hero() {
  return (
    <section className="relative flex items-stretch overflow-hidden bg-[color-mix(in_oklab,var(--color-gold-50)_20%,var(--color-surface-base))] pt-6 pb-12 max-lg:pt-4 max-lg:pb-8">
      <div className="mx-auto grid w-full max-w-7xl grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-0 px-10 max-lg:grid-cols-1 max-md:px-5">
        {/* LEFT — masonry feed (static for Phase 2) */}
        <div className="relative overflow-hidden pt-12 pr-8 pb-8 max-lg:order-2 max-lg:px-0 max-lg:pt-12 max-lg:pb-6">
          <div
            className="relative grid h-160 grid-cols-3 gap-3.5 max-lg:h-140 max-sm:h-130 max-sm:grid-cols-2 max-sm:gap-2.5"
            style={{
              maskImage:
                "linear-gradient(180deg, transparent 0%, #000 8%, #000 92%, transparent 100%)",
              WebkitMaskImage:
                "linear-gradient(180deg, transparent 0%, #000 8%, #000 92%, transparent 100%)",
            }}
          >
            {COLUMN_LISTINGS.map((items, colIdx) => {
              // Duplicate items so translateY(-50%) seamlessly loops back
              // to the start of the second copy.
              const looped = [...items, ...items];
              const anim = COL_ANIM[colIdx];
              return (
                <div
                  key={colIdx}
                  className={`group/masonry relative overflow-hidden ${colIdx === 2 ? "max-sm:hidden" : ""}`}
                  style={{ paddingTop: `${COL_OFFSET_PT[colIdx]}px` }}
                >
                  <div
                    className="flex flex-col gap-4 will-change-transform animate-[scroll-up_var(--mas-dur)_linear_infinite] [animation-delay:var(--mas-delay)] hover:[animation-play-state:paused]"
                    style={
                      {
                        "--mas-dur": anim.duration,
                        "--mas-delay": anim.delay,
                      } as React.CSSProperties
                    }
                  >
                    {looped.map((item, i) => (
                      <ListingCard key={`${item.id}-${i}`} item={item} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT — copy + CTA */}
        <div className="relative flex flex-col justify-center py-12 pl-12 max-lg:order-1 max-lg:p-0 max-lg:pt-12 max-lg:pb-6">
          <h1 className="m-0 mb-8 font-serif text-[clamp(52px,6.4vw,80px)] leading-[1.05] font-medium tracking-[-0.03em] text-navy-500">
            Buy. Sell.
            <br />
            Let your{" "}
            <em
              className="bg-clip-text pr-[0.04em] font-serif font-medium tracking-[-0.025em] text-transparent italic"
              style={{ backgroundImage: "var(--gradient-text-hero)" }}
            >
              agent
            </em>{" "}
            haggle.
          </h1>

          <p className="m-0 mb-11 max-w-[44ch] text-[20px] leading-[1.55] font-normal text-neutral-600">
            A marketplace where your AI agent negotiates for you. Build your own
            agent, and let it handle the rest.
          </p>

          <div className="flex flex-wrap items-center gap-3.5">
            <a
              href={`${APP_URL}/sign-up`}
              className="group inline-flex h-14 items-center justify-center gap-2.5 rounded-full border border-transparent bg-navy-500 px-8 text-[17px] leading-none font-semibold tracking-[-0.005em] text-white shadow-[0_1px_0_rgba(0,0,0,.06),0_10px_30px_-12px_rgba(27,42,74,.45),inset_0_1px_0_rgba(255,255,255,0.10)] transition-all duration-150 hover:-translate-y-px hover:bg-navy-600 hover:shadow-[0_1px_0_rgba(0,0,0,.08),0_16px_40px_-10px_rgba(27,42,74,.55),inset_0_1px_0_rgba(255,255,255,0.12)] active:translate-y-px"
            >
              <span className="leading-none">Get Started</span>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="block shrink-0 transition-transform duration-[250ms] group-hover:translate-x-1"
              >
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

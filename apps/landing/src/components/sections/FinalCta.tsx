export function FinalCta() {
  return (
    <section
      id="cta"
      className="relative scroll-mt-20 bg-surface-base py-16 pb-20 max-lg:py-12 max-lg:pb-16"
    >
      <div className="mx-auto max-w-[1280px] px-10 max-md:px-6">
        <div
          className="relative overflow-hidden rounded-[32px] px-14 pt-21 pb-22 text-center text-white shadow-[0_24px_60px_rgba(27,42,74,0.22)] max-lg:rounded-3xl max-lg:px-7 max-lg:pt-14 max-lg:pb-16"
          style={{
            background: `
              radial-gradient(ellipse 100% 70% at 50% -10%, rgba(214,154,76,0.68) 0%, rgba(214,154,76,0.22) 35%, transparent 65%),
              linear-gradient(180deg, var(--color-navy-500) 0%, var(--color-navy-600) 50%, var(--color-navy-700) 100%)
            `,
          }}
        >
          {/* Grid background */}
          <span
            className="pointer-events-none absolute inset-0"
            aria-hidden="true"
            style={{
              backgroundImage: `
                linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)
              `,
              backgroundSize: "44px 44px",
              WebkitMaskImage:
                "radial-gradient(ellipse at center, black 20%, transparent 70%)",
              maskImage:
                "radial-gradient(ellipse at center, black 20%, transparent 70%)",
            }}
          />

          <h2 className="relative m-0 mb-4 font-serif text-[clamp(40px,5vw,64px)] leading-[1.05] font-medium tracking-[-0.025em] text-white">
            Make your{" "}
            <em
              className="bg-clip-text pr-[0.04em] font-medium text-transparent italic"
              style={{
                backgroundImage:
                  "linear-gradient(135deg, #EFD3A1 0%, #DCAA5E 60%, #B8823E 100%)",
              }}
            >
              first deal
            </em>{" "}
            today.
          </h2>
          <p className="relative mx-auto m-0 mb-10 max-w-[540px] font-sans text-[19px] leading-[1.55] text-white/70">
            Set your style. Save it. Let your agent do the rest. Every deal is
            escrow-protected. You only pay when it&apos;s right.
          </p>
          <div className="relative inline-flex flex-wrap items-center justify-center gap-3.5">
            <a
              href="#"
              className="group inline-flex h-[54px] cursor-pointer items-center gap-2 rounded-full border-none px-7 text-[15px] leading-none font-semibold tracking-[-0.005em] text-white no-underline shadow-[0_8px_24px_rgba(214,154,76,0.35)] transition-all duration-150 hover:-translate-y-px hover:shadow-[0_12px_32px_rgba(214,154,76,0.45)]"
              style={{
                background:
                  "linear-gradient(135deg, var(--color-gold-400) 0%, var(--color-gold-600) 100%)",
              }}
            >
              <span className="leading-none">Get Started</span>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="block shrink-0 transition-transform duration-200 group-hover:translate-x-1"
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

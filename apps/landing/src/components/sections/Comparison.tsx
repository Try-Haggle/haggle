"use client";

import { useState } from "react";

interface Platform {
  id: string;
  name: string;
  fee: number;
  isHaggle?: boolean;
}

const PLATFORMS: Platform[] = [
  { id: "poshmark", name: "Poshmark", fee: 0.2 },
  { id: "ebay", name: "eBay", fee: 0.136 },
  { id: "stockx", name: "StockX", fee: 0.12 },
  { id: "haggle", name: "Haggle", fee: 0.015, isHaggle: true },
];

const PRICE_PRESETS = [100, 500, 1000, 2000];

function fmtPct(f: number) {
  const p = f * 100;
  const r = Math.round(p * 10) / 10;
  return (r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)) + "%";
}

function moneyParts(n: number) {
  const v = Math.round(n * 100) / 100;
  const dollars = Math.floor(v);
  const cents = Math.round((v - dollars) * 100);
  return {
    dollars: "$" + dollars.toLocaleString(),
    cents: "." + String(cents).padStart(2, "0"),
  };
}

export function Comparison() {
  const [price, setPrice] = useState(500);

  const otherAvgFee =
    PLATFORMS.filter((p) => !p.isHaggle).reduce((s, p) => s + p.fee, 0) / 3;
  const savings = (otherAvgFee - 0.015) * price;
  const s = moneyParts(savings);

  return (
    <section id="why-haggle" className="relative scroll-mt-20">
      {/* Header (transparent row) */}
      <div className="bg-transparent py-12 pb-6 max-lg:py-10 max-lg:pb-4">
        <div className="mx-auto max-w-7xl px-10 max-md:px-6">
          <div className="mx-auto mb-18 max-w-180 text-center max-lg:mb-12">
            <span className="mb-5 inline-block font-mono text-[11px] font-medium tracking-[0.2em] text-gold-500 uppercase">
              WHY HAGGLE
            </span>
            <h2 className="m-0 font-serif text-[clamp(32px,3.6vw,46px)] leading-[1.1] font-medium tracking-[-0.02em] text-navy-500">
              Keep more of what you{" "}
              <em
                className="bg-clip-text font-medium text-transparent italic"
                style={{ backgroundImage: "var(--gradient-text-gold)" }}
              >
                earn
              </em>
              .
            </h2>
          </div>
        </div>
      </div>

      {/* Content (gold-tinted row) */}
      <div className="bg-[color-mix(in_oklab,var(--color-gold-50)_20%,var(--color-surface-base))] py-8 pt-8 pb-12 max-lg:py-6 max-lg:pb-10">
        <div className="mx-auto max-w-7xl px-10 max-md:px-6">
          <div className="mx-auto max-w-270">
            {/* Price selector */}
            <div className="mb-10 flex flex-wrap items-center justify-center gap-4 max-md:mb-9 max-md:gap-3.5">
              <span className="font-mono text-[14px] tracking-[0.14em] text-neutral-500 uppercase max-md:text-[11px]">
                If you sell for
              </span>
              <div className="inline-flex gap-px rounded-full border border-neutral-200 bg-surface-raised p-1 max-md:p-0.75">
                {PRICE_PRESETS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setPrice(p)}
                    className={`cursor-pointer rounded-full border-none px-5 py-2.5 font-mono text-[15px] font-medium tracking-[0.04em] transition-colors max-md:px-4 max-md:py-1.75 max-md:text-[12px] ${
                      price === p
                        ? "bg-navy-500 text-surface-base"
                        : "bg-transparent text-neutral-600 hover:text-navy-500"
                    }`}
                  >
                    ${p.toLocaleString()}
                  </button>
                ))}
              </div>
            </div>

            {/* Grid */}
            <ComparisonGrid price={price} />

            {/* Footnote */}
            <div className="mt-6 flex flex-wrap items-start justify-between gap-4 px-1 max-md:flex-col max-md:flex-nowrap">
              {/* "You keep" — appears first on mobile (right below table), last on desktop */}
              <span className="order-2 text-right font-serif text-[20px] leading-snug text-neutral-700 italic max-md:order-1 max-md:text-[15px] max-md:text-left">
                You keep{" "}
                <b className="font-sans text-[26px] font-semibold tracking-[-0.01em] text-gold-700 not-italic max-md:text-[19px]">
                  {s.dollars}
                  <span className="text-[20px] max-md:text-[15px]">
                    {s.cents}
                  </span>
                </b>{" "}
                more per sale on Haggle.
              </span>
              <div className="order-1 flex flex-col gap-3.5 max-md:order-2">
                <p className="m-0 max-w-140 text-[13px] leading-normal tracking-[-0.005em] text-neutral-600">
                  Published seller rates as of 2026.
                </p>
                <p className="m-0 font-mono text-[10.5px] tracking-[0.16em] text-neutral-500 uppercase">
                  Sources:{" "}
                  <a
                    href="https://support.poshmark.com/s/topic/0TO1I000000kJqqWAE/faqs"
                    target="_blank"
                    rel="noopener"
                    className="border-b border-neutral-300 text-neutral-600 no-underline transition-colors hover:border-gold-500 hover:text-gold-700"
                  >
                    Poshmark
                  </a>
                  <span className="mx-1.5 border-none text-neutral-400">·</span>
                  <a
                    href="https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822"
                    target="_blank"
                    rel="noopener"
                    className="border-b border-neutral-300 text-neutral-600 no-underline transition-colors hover:border-gold-500 hover:text-gold-700"
                  >
                    eBay
                  </a>
                  <span className="mx-1.5 border-none text-neutral-400">·</span>
                  <a
                    href="https://stockx.com/help/articles/what-are-stockxs-fees-for-sellers"
                    target="_blank"
                    rel="noopener"
                    className="border-b border-neutral-300 text-neutral-600 no-underline transition-colors hover:border-gold-500 hover:text-gold-700"
                  >
                    StockX
                  </a>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ComparisonGrid({ price }: { price: number }) {
  const haggleColIdx = PLATFORMS.findIndex((p) => p.isHaggle);
  // Column index in the 5-col grid is 1-based offset by label column.
  // Haggle col starts at grid column = 2 + haggleColIdx.
  const haggleGridCol = 2 + haggleColIdx;

  // Base cell padding/height
  const cellBase =
    "relative z-1 flex min-h-20 items-center justify-center px-4 py-4.5 max-md:min-h-15 max-md:px-1.5 max-md:py-2";

  // Border helpers
  const borderRight = "border-r border-neutral-100";
  const borderBottom = "border-b border-neutral-100";
  const haggleBorderBottom = "border-b border-white/10";

  // Label cell styling (label column) — right border uses neutral-200 to match
  // the row dividers and create a clean boundary against the data area.
  const labelCell = `${cellBase} bg-surface-sunken border-r border-neutral-200 font-mono text-[12.5px] font-semibold tracking-[0.14em] text-neutral-700 uppercase max-md:text-[9px] max-md:tracking-[0.08em]`;

  // Helper for a platform cell wrapper
  function platformCell(extra: string, isLastCol: boolean, isHaggleCol: boolean) {
    const rightBorder = isLastCol || isHaggleCol ? "" : borderRight;
    return `${cellBase} ${rightBorder} ${extra}`;
  }

  return (
    <div className="relative overflow-hidden rounded-[14px] border border-neutral-200 bg-surface-raised shadow-(--shadow-card)">
      {/* Haggle column background overlay — sits behind all cells in that column */}
      <div
        className="absolute top-0 bottom-0 z-0"
        aria-hidden="true"
        style={{
          gridColumn: haggleGridCol,
          // Match grid column positioning using inset
          left: `calc((100% - 180px) / 4 * ${haggleColIdx} + 180px)`,
          width: `calc((100% - 180px) / 4)`,
          background:
            "linear-gradient(180deg, var(--color-navy-500) 0%, var(--color-navy-600) 100%)",
        }}
      />
      {/* Mobile-only Haggle overlay (different label column width) */}
      <div
        className="absolute top-0 bottom-0 z-0 hidden max-md:block"
        aria-hidden="true"
        style={{
          left: `calc((100% - 52px) / 4 * ${haggleColIdx} + 52px)`,
          width: `calc((100% - 52px) / 4)`,
          background:
            "linear-gradient(180deg, var(--color-navy-500) 0%, var(--color-navy-600) 100%)",
        }}
      />
      {/* Haggle top gold strip */}
      <div
        className="absolute top-0 z-2 h-0.75"
        aria-hidden="true"
        style={{
          left: `calc((100% - 180px) / 4 * ${haggleColIdx} + 180px)`,
          width: `calc((100% - 180px) / 4)`,
          background:
            "linear-gradient(90deg, var(--color-gold-400), var(--color-gold-600))",
        }}
      />
      <div
        className="absolute top-0 z-2 hidden h-0.75 max-md:block"
        aria-hidden="true"
        style={{
          left: `calc((100% - 52px) / 4 * ${haggleColIdx} + 52px)`,
          width: `calc((100% - 52px) / 4)`,
          background:
            "linear-gradient(90deg, var(--color-gold-400), var(--color-gold-600))",
        }}
      />

      {/* Flat 5-col × 4-row grid — each cell is a direct grid child so rows align perfectly */}
      <div className="relative z-1 grid grid-cols-[180px_repeat(4,1fr)] max-md:grid-cols-[52px_repeat(4,1fr)]">
        {/* === ROW 1: Platform headers === */}
        {/* Label spacer (invisible "Platform" reserves correct height) */}
        <div
          className={`${labelCell} border-b border-neutral-200 text-transparent`}
        >
          <span className="max-md:hidden">Platform</span>
          <span className="hidden max-md:inline">&nbsp;</span>
        </div>
        {PLATFORMS.map((p, idx) => {
          const isLast = idx === PLATFORMS.length - 1;
          const isHaggle = !!p.isHaggle;
          return (
            <div
              key={`h-${p.id}`}
              className={`${platformCell(isHaggle ? haggleBorderBottom : `${borderBottom} bg-surface-base`, isLast, isHaggle)}`}
            >
              <span
                className={`font-sans text-[19px] tracking-[-0.005em] max-md:text-[12px] ${
                  isHaggle ? "font-semibold text-white" : "font-medium text-navy-500"
                }`}
              >
                {p.name}
              </span>
            </div>
          );
        })}

        {/* === ROW 2: Fee === */}
        <div className={`${labelCell} border-b border-neutral-200`}>Fee</div>
        {PLATFORMS.map((p, idx) => {
          const isLast = idx === PLATFORMS.length - 1;
          const isHaggle = !!p.isHaggle;
          return (
            <div
              key={`f-${p.id}`}
              className={platformCell(isHaggle ? haggleBorderBottom : borderBottom, isLast, isHaggle)}
            >
              <span
                className={`font-mono text-[19px] tracking-[0.02em] max-md:text-[11px] ${
                  isHaggle ? "font-medium text-gold-300" : "font-normal text-neutral-500"
                }`}
              >
                {fmtPct(p.fee)}
              </span>
            </div>
          );
        })}

        {/* === ROW 3: Lost to fees === */}
        <div className={`${labelCell} border-b border-neutral-200 max-md:leading-tight`}>
          <span className="max-md:hidden">Lost to fees</span>
          <span className="hidden max-md:inline">Lost</span>
        </div>
        {PLATFORMS.map((p, idx) => {
          const loss = p.fee * price;
          const l = moneyParts(loss);
          const isLast = idx === PLATFORMS.length - 1;
          const isHaggle = !!p.isHaggle;
          return (
            <div
              key={`l-${p.id}`}
              className={platformCell(isHaggle ? haggleBorderBottom : borderBottom, isLast, isHaggle)}
            >
              <span
                className={`font-mono text-[19px] tracking-[0.01em] whitespace-nowrap max-md:text-[12px] max-md:tracking-normal ${
                  isHaggle ? "font-normal text-gold-300 opacity-85" : "font-medium text-error-500"
                }`}
              >
                −{l.dollars}
                <span
                  className={`text-[16px] max-md:hidden ${isHaggle ? "text-gold-400 opacity-100" : ""}`}
                >
                  {l.cents}
                </span>
              </span>
            </div>
          );
        })}

        {/* === ROW 4: You receive === */}
        <div className={`${labelCell} max-md:leading-tight`}>
          <span className="max-md:hidden">You receive</span>
          <span className="hidden max-md:inline">Get</span>
        </div>
        {PLATFORMS.map((p, idx) => {
          const loss = p.fee * price;
          const receive = price - loss;
          const m = moneyParts(receive);
          const isLast = idx === PLATFORMS.length - 1;
          const isHaggle = !!p.isHaggle;
          return (
            <div
              key={`r-${p.id}`}
              className={platformCell("", isLast, isHaggle)}
            >
              {isHaggle ? (
                <span
                  className="bg-clip-text font-serif text-[30px] font-medium tracking-[-0.015em] whitespace-nowrap text-transparent italic max-md:text-[16px] max-md:tracking-normal"
                  style={{
                    backgroundImage:
                      "linear-gradient(135deg, var(--color-gold-300) 0%, var(--color-gold-500) 100%)",
                  }}
                >
                  {m.dollars}
                  <span className="text-[17px] text-gold-400 not-italic max-md:hidden">
                    {m.cents}
                  </span>
                </span>
              ) : (
                <span className="font-serif text-[30px] font-medium tracking-[-0.015em] whitespace-nowrap text-navy-500 max-md:text-[16px] max-md:tracking-normal">
                  {m.dollars}
                  <span className="text-[17px] text-neutral-500 max-md:hidden">
                    {m.cents}
                  </span>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

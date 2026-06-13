"use client";

import { motion } from "framer-motion";
import { formatPrice } from "./format";
import type { PlaybackRound } from "./types";

interface ProgressBarProps {
  rounds: PlaybackRound[];
  visibleCount: number;
  askingPrice: number;
  currency?: string;
}

/**
 * Concession curve — visualises the gap between buyer & seller offers
 * shrinking over rounds. Hero metric is the absolute gap (with closed %),
 * so a glance tells the story without having to read the chart.
 */
export function ProgressBar({
  rounds,
  visibleCount,
  askingPrice,
  currency = "USD",
}: ProgressBarProps) {
  if (rounds.length === 0) return null;

  // ── Gap stats ─────────────────────────────────────────────────
  const buyerOffers = rounds.filter((r) => r.sender === "BUYER");
  const sellerOffers = rounds.filter((r) => r.sender === "SELLER");
  const visibleBuyerOffers = buyerOffers.filter((r) => r.roundIndex <= visibleCount);
  const visibleSellerOffers = sellerOffers.filter((r) => r.roundIndex <= visibleCount);

  const firstBuyer = buyerOffers[0];
  const firstSeller = sellerOffers[0];
  const lastVisibleBuyer = visibleBuyerOffers[visibleBuyerOffers.length - 1];
  const lastVisibleSeller = visibleSellerOffers[visibleSellerOffers.length - 1];

  const initialGap =
    firstBuyer && firstSeller ? Math.abs(firstSeller.offerPrice - firstBuyer.offerPrice) : null;
  const currentGap =
    lastVisibleBuyer && lastVisibleSeller
      ? Math.abs(lastVisibleSeller.offerPrice - lastVisibleBuyer.offerPrice)
      : null;
  const closedPct =
    initialGap !== null && currentGap !== null && initialGap > 0
      ? Math.max(0, ((initialGap - currentGap) / initialGap) * 100)
      : null;

  // ── Chart geometry ────────────────────────────────────────────
  const W = 320;
  const H = 96;
  const PAD_X = 28;
  const PAD_TOP = 14;
  const PAD_BOTTOM = 22;

  // Y range: tight bounds around real data + asking, with breathing room.
  const allPrices = rounds.map((r) => r.offerPrice).concat([askingPrice]);
  const dataMin = Math.min(...allPrices);
  const dataMax = Math.max(...allPrices);
  const range = Math.max(dataMax - dataMin, 1);
  const yMin = dataMin - range * 0.15;
  const yMax = dataMax + range * 0.15;
  const yFor = (price: number) => {
    const t = (price - yMin) / (yMax - yMin);
    return H - PAD_BOTTOM - t * (H - PAD_BOTTOM - PAD_TOP);
  };
  const xFor = (i: number) => {
    const t = rounds.length === 1 ? 0.5 : i / (rounds.length - 1);
    return PAD_X + t * (W - PAD_X * 2);
  };

  const buyerPoints = buyerOffers.map((r) => ({
    roundIndex: r.roundIndex,
    price: r.offerPrice,
    x: xFor(r.roundIndex - 1),
    y: yFor(r.offerPrice),
    visible: r.roundIndex <= visibleCount,
  }));
  const sellerPoints = sellerOffers.map((r) => ({
    roundIndex: r.roundIndex,
    price: r.offerPrice,
    x: xFor(r.roundIndex - 1),
    y: yFor(r.offerPrice),
    visible: r.roundIndex <= visibleCount,
  }));
  const visibleBuyer = buyerPoints.filter((p) => p.visible);
  const visibleSeller = sellerPoints.filter((p) => p.visible);
  const lastBuyerPt = visibleBuyer[visibleBuyer.length - 1] ?? null;
  const lastSellerPt = visibleSeller[visibleSeller.length - 1] ?? null;

  const askY = yFor(askingPrice);

  return (
    <div
      className="flex flex-col gap-2.5 rounded-xl px-3 py-3"
      style={{ background: "var(--bg-sunken)", border: "1px solid var(--border-default)" }}
    >
      {/* Headline: gap metric */}
      <div className="flex items-baseline justify-between gap-2">
        <span
          className="text-[10px] font-bold tracking-[0.14em]"
          style={{ color: "var(--text-muted)" }}
        >
          GAP CLOSING
        </span>
        {currentGap !== null ? (
          <div className="flex items-baseline gap-1.5">
            <span
              className="text-[14px] font-bold tabular-nums"
              style={{ color: "var(--text-primary)" }}
            >
              {formatPrice(currentGap, currency)}
            </span>
            {initialGap !== null && initialGap > currentGap && closedPct !== null && (
              <span
                className="text-[10px] font-semibold tabular-nums"
                style={{ color: "var(--fb-success-fg)" }}
              >
                ↓ {closedPct.toFixed(0)}%
              </span>
            )}
          </div>
        ) : (
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            awaiting first offers…
          </span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="Concession curve showing buyer and seller offers over rounds"
      >
        {/* Asking line + label */}
        <line
          x1={PAD_X}
          x2={W - PAD_X}
          y1={askY}
          y2={askY}
          strokeWidth="1"
          strokeDasharray="4 4"
          opacity="0.55"
          style={{ stroke: "var(--text-secondary)" }}
        />
        <text
          x={W - PAD_X + 3}
          y={askY + 3}
          fontSize="8"
          fontWeight="700"
          textAnchor="start"
          style={{ fill: "var(--text-secondary)" }}
        >
          ASK
        </text>

        {/* Lines */}
        <CurveLine points={visibleBuyer} color="var(--fb-error-fg)" />
        <CurveLine points={visibleSeller} color="var(--action-primary)" />

        {/* Buyer dots */}
        {visibleBuyer.map((p) => (
          <motion.circle
            key={`b-${p.roundIndex}`}
            cx={p.x}
            cy={p.y}
            r="2.8"
            style={{ fill: "var(--fb-error-fg)" }}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          />
        ))}
        {/* Seller dots */}
        {visibleSeller.map((p) => (
          <motion.circle
            key={`s-${p.roundIndex}`}
            cx={p.x}
            cy={p.y}
            r="2.8"
            style={{ fill: "var(--action-primary)" }}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          />
        ))}

        {/* Latest-point price labels (only the most recent visible point per side) */}
        {lastBuyerPt && (
          <PointLabel
            x={lastBuyerPt.x}
            y={lastBuyerPt.y}
            asking={askingPrice}
            price={lastBuyerPt.price}
            color="var(--fb-error-fg)"
            currency={currency}
          />
        )}
        {lastSellerPt && (
          <PointLabel
            x={lastSellerPt.x}
            y={lastSellerPt.y}
            asking={askingPrice}
            price={lastSellerPt.price}
            color="var(--action-primary)"
            currency={currency}
          />
        )}

        {/* Round labels on X-axis */}
        {rounds.map((r, i) => {
          const x = xFor(i);
          const isVisible = r.roundIndex <= visibleCount;
          return (
            <text
              key={`r-${r.roundIndex}`}
              x={x}
              y={H - 6}
              fontSize="7.5"
              fontWeight="600"
              style={{ fill: isVisible ? "var(--text-secondary)" : "var(--text-muted)" }}
              textAnchor="middle"
            >
              R{r.roundIndex}
            </text>
          );
        })}
      </svg>

      {/* Legend */}
      <div
        className="flex items-center justify-between text-[10px]"
        style={{ color: "var(--text-secondary)" }}
      >
        <Legend color="var(--action-primary)" label="Seller" />
        <Legend color="var(--fb-error-fg)" label="Buyer" />
      </div>
    </div>
  );
}

/**
 * Renders the price text near a chart point. Position above/below the dot
 * depending on which side has more breathing room (so labels don't collide
 * with the asking line or chart edges).
 */
function PointLabel({
  x,
  y,
  asking: _asking,
  price,
  color,
  currency,
}: {
  x: number;
  y: number;
  asking: number;
  price: number;
  color: string;
  currency: string;
}) {
  // Place label above point if point is in lower half, below if upper half.
  // Heuristic: y > midpoint → label above (y - 6), else below (y + 9).
  const labelY = y > 50 ? y - 6 : y + 10;
  return (
    <text
      x={x}
      y={labelY}
      fontSize="8"
      fontWeight="700"
      textAnchor="middle"
      style={{ fill: color }}
    >
      {formatPrice(price, currency)}
    </text>
  );
}

function CurveLine({ points, color }: { points: { x: number; y: number }[]; color: string }) {
  if (points.length < 2) return null;
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  return (
    <motion.path
      d={d}
      fill="none"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ stroke: color }}
      initial={{ pathLength: 0 }}
      animate={{ pathLength: 1 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
    />
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      <span>{label}</span>
    </div>
  );
}

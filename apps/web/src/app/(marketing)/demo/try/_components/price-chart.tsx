"use client";

interface PricePoint {
  round: number;
  buyer: number;
  seller: number;
}

interface PriceChartProps {
  priceHistory: PricePoint[];
}

const MARKET_PRICE = 920;
const PADDING = { top: 20, right: 50, bottom: 30, left: 50 };
const HEIGHT = 180;

export function PriceChart({ priceHistory }: PriceChartProps) {
  if (priceHistory.length === 0) return null;

  // Compute bounds
  const allPrices = priceHistory.flatMap((p) => [p.buyer, p.seller]);
  allPrices.push(MARKET_PRICE);
  const minPrice = Math.floor(Math.min(...allPrices) / 50) * 50 - 50;
  const maxPrice = Math.ceil(Math.max(...allPrices) / 50) * 50 + 50;
  const maxRound = Math.max(...priceHistory.map((p) => p.round), 1);

  const chartW = 100; // percentage-based viewBox
  const chartH = HEIGHT - PADDING.top - PADDING.bottom;
  const viewBoxW = chartW + PADDING.left + PADDING.right;

  const scaleX = (round: number) =>
    PADDING.left + (round / maxRound) * chartW;
  const scaleY = (price: number) =>
    PADDING.top +
    chartH -
    ((price - minPrice) / (maxPrice - minPrice)) * chartH;

  const buyerPoints = priceHistory
    .map((p) => `${scaleX(p.round)},${scaleY(p.buyer)}`)
    .join(" ");
  const sellerPoints = priceHistory
    .map((p) => `${scaleX(p.round)},${scaleY(p.seller)}`)
    .join(" ");

  const marketY = scaleY(MARKET_PRICE);

  const lastBuyer = priceHistory[priceHistory.length - 1];
  const lastSeller = priceHistory[priceHistory.length - 1];

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-3 mb-4">
      <p className="text-xs text-slate-500 mb-2">Price Convergence</p>
      <svg
        viewBox={`0 0 ${viewBoxW} ${HEIGHT}`}
        className="w-full"
        style={{ height: `${HEIGHT}px` }}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Market price dashed line */}
        <line
          x1={PADDING.left}
          y1={marketY}
          x2={PADDING.left + chartW}
          y2={marketY}
          stroke="#64748b"
          strokeWidth="0.5"
          strokeDasharray="4 3"
        />
        <text
          x={PADDING.left + chartW + 4}
          y={marketY + 3}
          fill="#64748b"
          fontSize="8"
          fontFamily="monospace"
        >
          $920
        </text>

        {/* Buyer line (blue) */}
        <polyline
          points={buyerPoints}
          fill="none"
          stroke="#60a5fa"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        {priceHistory.map((p) => (
          <circle
            key={`b-${p.round}`}
            cx={scaleX(p.round)}
            cy={scaleY(p.buyer)}
            r="3"
            fill="#60a5fa"
          />
        ))}

        {/* Seller line (orange) */}
        <polyline
          points={sellerPoints}
          fill="none"
          stroke="#fb923c"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        {priceHistory.map((p) => (
          <circle
            key={`s-${p.round}`}
            cx={scaleX(p.round)}
            cy={scaleY(p.seller)}
            r="3"
            fill="#fb923c"
          />
        ))}

        {/* End labels */}
        {lastBuyer && (
          <text
            x={scaleX(lastBuyer.round) + 5}
            y={scaleY(lastBuyer.buyer) + 3}
            fill="#60a5fa"
            fontSize="8"
            fontFamily="monospace"
          >
            ${lastBuyer.buyer}
          </text>
        )}
        {lastSeller && (
          <text
            x={scaleX(lastSeller.round) + 5}
            y={scaleY(lastSeller.seller) + 3}
            fill="#fb923c"
            fontSize="8"
            fontFamily="monospace"
          >
            ${lastSeller.seller}
          </text>
        )}

        {/* X-axis labels */}
        {priceHistory.map((p) => (
          <text
            key={`x-${p.round}`}
            x={scaleX(p.round)}
            y={HEIGHT - 5}
            fill="#64748b"
            fontSize="7"
            textAnchor="middle"
            fontFamily="monospace"
          >
            R{p.round}
          </text>
        ))}

        {/* Legend */}
        <circle cx={PADDING.left} cy={HEIGHT - 6} r="3" fill="#60a5fa" />
        <text
          x={PADDING.left + 6}
          y={HEIGHT - 3}
          fill="#94a3b8"
          fontSize="7"
        >
          AI Buyer
        </text>
        <circle cx={PADDING.left + 50} cy={HEIGHT - 6} r="3" fill="#fb923c" />
        <text
          x={PADDING.left + 56}
          y={HEIGHT - 3}
          fill="#94a3b8"
          fontSize="7"
        >
          You (Seller)
        </text>
      </svg>
    </div>
  );
}

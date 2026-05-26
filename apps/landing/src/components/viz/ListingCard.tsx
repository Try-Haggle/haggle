import { AGENTS } from "@/lib/data/agents";
import { ICONS } from "@/lib/data/icons";
import {
  formatPrice,
  type CardBg,
  type CardShape,
  type Condition,
  type Listing,
} from "@/lib/data/listings";

const CARD_BG: Record<CardBg, string> = {
  "bg-1": "linear-gradient(135deg, #F0EDE5 0%, #DDD3C2 100%)",
  "bg-2": "linear-gradient(135deg, #FBF3E5 0%, #EFD3A1 100%)",
  "bg-3": "linear-gradient(135deg, #EEF1F7 0%, #ADB7CF 100%)",
  "bg-4": "linear-gradient(135deg, #FAF8F3 0%, #F0EDE5 100%)",
  "bg-5": "linear-gradient(135deg, #F6E6CC 0%, #DCAA5E 100%)",
  "bg-6": "linear-gradient(135deg, #D6DCEA 0%, #8492B4 100%)",
  "bg-7": "linear-gradient(135deg, #F3EFE6 0%, #C8BDA8 100%)",
};

const SHAPE_ASPECT: Record<CardShape, string> = {
  tall: "4 / 5.5",
  mid: "4 / 4.5",
  wide: "4 / 3.5",
};

const CONDITION_BADGE: Record<Condition, string> = {
  New: "bg-gold-100 text-gold-700",
  "Like New": "bg-success-50 text-success-700",
  Excellent: "bg-info-500/10 text-info-500",
  Good: "bg-neutral-100 text-neutral-700",
  Acceptable: "bg-surface-sunken text-neutral-500",
};

export function ListingCard({ item }: { item: Listing }) {
  const agent = AGENTS[item.agent];
  const icon = ICONS[item.icon];

  return (
    <article className="group relative overflow-hidden rounded-[14px] border border-neutral-100 bg-surface-raised shadow-[var(--shadow-card)] transition-all duration-[250ms] hover:-translate-y-0.5 hover:border-neutral-200 hover:shadow-[var(--shadow-elev)]">
      {/* Thumb */}
      <div
        className="relative w-full"
        style={{
          aspectRatio: SHAPE_ASPECT[item.shape],
          background: CARD_BG[item.bg],
        }}
      >
        {/* Agent pill (top-left) */}
        <div className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full border border-neutral-100 bg-[rgba(255,253,249,0.92)] py-[3px] pr-2.5 pl-1 font-mono text-[9.5px] leading-none font-medium tracking-[0.06em] whitespace-nowrap text-navy-500 uppercase shadow-[0_2px_8px_-4px_rgba(27,42,74,0.12)] backdrop-blur-md">
          <span
            className="block h-[18px] w-[18px] shrink-0"
            dangerouslySetInnerHTML={{ __html: agent.svg }}
          />
          {agent.name}
        </div>

        {/* Product icon */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="block h-[52%] w-[52%]"
            dangerouslySetInnerHTML={{ __html: icon }}
          />
        </div>
      </div>

      {/* Body */}
      <div className="px-[14px] pt-[13px] pb-[14px]">
        <div className="flex items-center justify-between gap-2">
          <h3 className="m-0 line-clamp-1 text-[13.5px] leading-[1.3] font-semibold tracking-[-0.01em] text-navy-500">
            {item.title}
          </h3>
        </div>
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 overflow-hidden font-mono text-[9.5px] tracking-[0.08em] whitespace-nowrap text-neutral-500 uppercase">
          <span
            className={`inline-flex shrink-0 items-center rounded-[4px] px-1.5 py-px text-[9px] font-semibold tracking-[0.04em] uppercase ${CONDITION_BADGE[item.cond]}`}
          >
            {item.cond}
          </span>
          <span className="h-[2px] w-[2px] rounded-full bg-neutral-300" />
          <span className="min-w-0 overflow-hidden text-ellipsis">
            {item.tag}
          </span>
        </div>
        <div className="mt-2.5 flex items-center justify-end">
          <span className="font-mono text-[12px] font-medium tracking-[-0.005em] whitespace-nowrap text-navy-500">
            {formatPrice(item.price)}
          </span>
        </div>
      </div>
    </article>
  );
}

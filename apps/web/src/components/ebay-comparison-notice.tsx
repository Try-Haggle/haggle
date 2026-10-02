import {
  DEMO_COMPARISON_DISCLAIMER,
  EBAY_COMPARISON_BADGE,
  EBAY_COMPARISON_DISCLAIMER,
  EBAY_CONDITIONS_TEXT,
} from "./ebay-fee-terms";

interface EbayComparisonNoticeProps {
  /** `demo` swaps the Haggle sentence for the illustrative-fee assumption. */
  variant?: "default" | "demo";
  /** Include the full conditions block (source, check date, version). */
  terms?: boolean;
  testId?: string;
  className?: string;
}

/** Readable (text-xs) Demo/assumption notice placed next to an eBay comparison claim. */
export function EbayComparisonNotice({
  variant = "default",
  terms = false,
  testId,
  className = "",
}: EbayComparisonNoticeProps) {
  return (
    <div data-testid={testId} className={`text-xs leading-relaxed text-ink-secondary ${className}`}>
      <span className="mr-1.5 inline-block rounded bg-surface-sunken px-1.5 py-0.5 font-semibold text-ink">
        {EBAY_COMPARISON_BADGE}
      </span>
      {variant === "demo" ? DEMO_COMPARISON_DISCLAIMER : EBAY_COMPARISON_DISCLAIMER}
      {terms && (
        <p data-testid={testId ? `${testId}-terms` : undefined} className="mt-1.5 text-ink-muted">
          {EBAY_CONDITIONS_TEXT}
        </p>
      )}
    </div>
  );
}

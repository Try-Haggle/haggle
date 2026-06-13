"use client";

import { PromotionRulesTable } from "../_components/PromotionRulesTable";

export default function PromotionRulesPage() {
  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold text-ink">Promotion Rules</h2>
      <p className="mb-4 text-sm text-ink-secondary">
        Per-category thresholds for tag promotion and the scheduled promotion job.
      </p>
      <PromotionRulesTable />
    </div>
  );
}

"use client";

import { PromotionRulesTable } from "../_components/PromotionRulesTable";

export default function PromotionRulesPage() {
  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold text-neutral-900">
        Promotion Rules
      </h2>
      <p className="mb-4 text-sm text-neutral-600">
        Per-category thresholds for tag promotion and the scheduled promotion
        job.
      </p>
      <PromotionRulesTable />
    </div>
  );
}

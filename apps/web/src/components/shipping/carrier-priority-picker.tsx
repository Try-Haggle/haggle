"use client";

import { SelectableOptionCard } from "@/components/ui/selectable-option-card";
import {
  CARRIER_PRIORITIES,
  CARRIER_PRIORITY_COPY,
  type CarrierPriority,
} from "@/lib/fulfillment-options";

export function CarrierPriorityPicker({
  value,
  onChange,
}: {
  value: CarrierPriority;
  onChange: (next: CarrierPriority) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
          Carrier style
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          Used when seller shipping stays on the table. This is a preference, not a live rate.
        </p>
      </div>
      <div className="grid gap-3">
        {CARRIER_PRIORITIES.map((priority) => (
          <SelectableOptionCard
            key={priority}
            selected={value === priority}
            title={CARRIER_PRIORITY_COPY[priority].title}
            description={CARRIER_PRIORITY_COPY[priority].description}
            onClick={() => onChange(priority)}
          />
        ))}
      </div>
    </div>
  );
}

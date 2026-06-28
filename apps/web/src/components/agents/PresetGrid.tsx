"use client";

import {
  NEGOTIATION_AGENT_PRESETS,
  type NegotiationAgentPreset,
  type NegotiationAgentPresetId,
} from "@haggle/shared";
import { SelectableOptionCard } from "@/components/ui";

type Role = "buyer" | "seller";

interface PresetGridProps {
  role: Role;
  selectedId?: NegotiationAgentPresetId | null;
  onSelect?: (preset: NegotiationAgentPreset) => void;
  /** Tailwind grid columns. Defaults to 1 / 2 / 4 responsive. */
  columns?: string;
}

/**
 * Single preset selector grid. Same visual treatment everywhere agents are
 * picked (sell wizard, buyer landing, MCP widget, agents page). Cards use the
 * shared {@link SelectableOptionCard}; the emoji chip keeps each preset's
 * accent color (per-agent identity).
 */
export function PresetGrid({
  role,
  selectedId,
  onSelect,
  columns = "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
}: PresetGridProps) {
  return (
    <div className={`grid ${columns} gap-3`}>
      {NEGOTIATION_AGENT_PRESETS.map((preset) => {
        const copy = preset.copy[role];
        return (
          <SelectableOptionCard
            key={preset.id}
            selected={selectedId === preset.id}
            onClick={() => onSelect?.(preset)}
            icon={
              <span
                className="flex size-9 items-center justify-center rounded-full text-base"
                style={{
                  backgroundColor: `color-mix(in srgb, ${preset.accentColor} 13%, transparent)`,
                  color: preset.accentColor,
                }}
              >
                {preset.emoji}
              </span>
            }
            title={
              <>
                <span className="block font-semibold text-ink text-sm">{copy.name}</span>
                <span className="mt-0.5 block font-medium text-action-primary text-xs">
                  {copy.tagline}
                </span>
              </>
            }
            description={copy.description}
          />
        );
      })}
    </div>
  );
}

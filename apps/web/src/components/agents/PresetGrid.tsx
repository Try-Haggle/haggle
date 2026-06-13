"use client";

import {
  NEGOTIATION_PRESETS,
  type NegotiationPreset,
  type NegotiationPresetId,
} from "@haggle/shared";

type Role = "buyer" | "seller";

interface PresetGridProps {
  role: Role;
  selectedId?: NegotiationPresetId | null;
  onSelect?: (preset: NegotiationPreset) => void;
  /** Tailwind grid columns. Defaults to 1 / 2 / 4 responsive. */
  columns?: string;
}

/**
 * Single preset selector grid. Same visual treatment everywhere agents are
 * picked (sell wizard, buyer landing, MCP widget, agents page). Cards mirror
 * the widget baseline (apps/api/widget): rounded-xl, accent-tinted icon,
 * cyan tagline, compact description.
 */
export function PresetGrid({
  role,
  selectedId,
  onSelect,
  columns = "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
}: PresetGridProps) {
  return (
    <div className={`grid ${columns} gap-3`}>
      {NEGOTIATION_PRESETS.map((preset) => {
        const copy = preset.copy[role];
        const isSelected = selectedId === preset.id;
        return (
          <button
            key={preset.id}
            type="button"
            onClick={() => onSelect?.(preset)}
            className="flex cursor-pointer flex-col rounded-xl border p-4 text-left transition-all"
            style={{
              background: isSelected
                ? "color-mix(in srgb, var(--action-primary) 5%, transparent)"
                : "var(--bg-raised)",
              borderColor: isSelected ? "var(--action-primary)" : "var(--border-default)",
              boxShadow: isSelected ? "0 0 0 1px var(--action-primary)" : "none",
            }}
            onMouseEnter={(e) => {
              if (!isSelected) e.currentTarget.style.borderColor = "var(--border-strong)";
            }}
            onMouseLeave={(e) => {
              if (!isSelected) e.currentTarget.style.borderColor = "var(--border-default)";
            }}
          >
            <div className="flex items-start gap-3 mb-2.5">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base"
                style={{
                  backgroundColor: `color-mix(in srgb, ${preset.accentColor} 13%, transparent)`,
                  color: preset.accentColor,
                }}
              >
                {preset.emoji}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{copy.name}</p>
                <p className="text-xs font-medium mt-0.5 text-action-primary">{copy.tagline}</p>
              </div>
            </div>
            <p className="text-xs leading-relaxed text-ink-secondary">{copy.description}</p>
          </button>
        );
      })}
    </div>
  );
}

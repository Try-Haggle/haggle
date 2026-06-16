"use client";

import {
  NEGOTIATION_AGENT_PRESETS,
  type NegotiationAgentPreset,
  type NegotiationAgentPresetId,
} from "@haggle/shared";

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
      {NEGOTIATION_AGENT_PRESETS.map((preset) => {
        const copy = preset.copy[role];
        const isSelected = selectedId === preset.id;
        return (
          <button
            key={preset.id}
            type="button"
            onClick={() => onSelect?.(preset)}
            className="flex cursor-pointer flex-col rounded-xl border p-4 text-left transition-all"
            style={{
              background: isSelected ? "rgba(6,182,212,0.05)" : "#111827",
              borderColor: isSelected ? "#06b6d4" : "#1e293b",
              boxShadow: isSelected ? "0 0 0 1px #06b6d4" : "none",
            }}
            onMouseEnter={(e) => {
              if (!isSelected) e.currentTarget.style.borderColor = "#334155";
            }}
            onMouseLeave={(e) => {
              if (!isSelected) e.currentTarget.style.borderColor = "#1e293b";
            }}
          >
            <div className="flex items-start gap-3 mb-2.5">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base"
                style={{
                  backgroundColor: `${preset.accentColor}22`,
                  color: preset.accentColor,
                }}
              >
                {preset.emoji}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold" style={{ color: "#f1f5f9" }}>
                  {copy.name}
                </p>
                <p
                  className="text-xs font-medium mt-0.5"
                  style={{ color: "#06b6d4" }}
                >
                  {copy.tagline}
                </p>
              </div>
            </div>
            <p
              className="text-xs leading-relaxed"
              style={{ color: "#94a3b8" }}
            >
              {copy.description}
            </p>
          </button>
        );
      })}
    </div>
  );
}

"use client";

import {
  getNegotiationAgentPreset,
  NEGOTIATION_AGENT_PRESETS,
  type NegotiationAgentPreset,
} from "@haggle/shared";
import { motion } from "framer-motion";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { SPRING } from "@/components/listing-detail/motion";
import { cn } from "@/lib/cn";
import { type StudioSavedAgent, type StudioSelection, selectionKey } from "./types";

/**
 * The roster — who you can talk to.
 *
 * Deliberately styled as a chat app's thread list rather than a settings
 * catalogue: in this product the agent IS the conversation, so picking one
 * should feel like opening a thread, not configuring a form. Presets are the
 * four archetypes; "My agents" are the user's saved ones, listed in the same
 * visual language so reusing one reads as the same act as starting fresh.
 *
 * Two exports for the two form factors:
 *  - `AgentRoster`      — desktop sidebar (rows)
 *  - `AgentAvatarStrip` — mobile horizontal strip (circular avatars, the
 *    stories/recents pattern every phone user already knows)
 */

interface RosterProps {
  role: "buyer" | "seller";
  savedAgents?: StudioSavedAgent[];
  selection: StudioSelection | null;
  onSelect: (selection: StudioSelection) => void;
  className?: string;
}

/** The preset behind a saved agent, for accent/emoji fallbacks. */
function basePresetOf(agent: StudioSavedAgent): NegotiationAgentPreset | undefined {
  return getNegotiationAgentPreset(agent.negotiationAgentPresetId ?? agent.basePresetId ?? "");
}

/* ─── Desktop sidebar ─────────────────────────────────────── */

export function AgentRoster({
  role,
  savedAgents = [],
  selection,
  onSelect,
  className,
}: RosterProps) {
  const selectedKey = selection ? selectionKey(selection) : null;

  return (
    <nav className={cn("flex h-full min-h-0 flex-col", className)} aria-label="Agents">
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-3">
        <section>
          <p className="px-2 pb-2 text-label text-ink-muted">Presets</p>
          <ul className="space-y-0.5">
            {NEGOTIATION_AGENT_PRESETS.map((preset) => {
              const copy = preset.copy[role];
              return (
                <RosterRow
                  key={preset.id}
                  emoji={preset.emoji}
                  accent={preset.accentColor}
                  name={copy.name}
                  hint={copy.tagline}
                  selected={selectedKey === `preset:${preset.id}`}
                  onClick={() => onSelect({ kind: "preset", id: preset.id })}
                />
              );
            })}
          </ul>
        </section>

        {savedAgents.length > 0 && (
          <section>
            <p className="px-2 pb-2 text-label text-ink-muted">My agents</p>
            <ul className="space-y-0.5">
              {savedAgents.map((agent) => {
                const base = basePresetOf(agent);
                return (
                  <RosterRow
                    key={agent.id}
                    emoji={agent.emoji ?? base?.emoji ?? "✦"}
                    accent={base?.accentColor ?? "var(--action-primary)"}
                    name={agent.name}
                    hint={agent.description ?? base?.copy[role].tagline ?? "Custom agent"}
                    selected={selectedKey === `saved:${agent.id}`}
                    onClick={() => onSelect({ kind: "saved", id: agent.id })}
                  />
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </nav>
  );
}

function RosterRow({
  emoji,
  accent,
  name,
  hint,
  selected,
  onClick,
}: {
  emoji: string;
  accent: string;
  name: string;
  hint: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <li className="relative">
      {/* Shared-layout highlight slides between rows — selection reads as one
          moving object, the way a chat app's active thread does. */}
      {selected && (
        <motion.span
          layoutId="studio-roster-selection"
          className="absolute inset-0 rounded-xl bg-surface-sunken"
          style={{ border: `1px solid color-mix(in srgb, ${accent} 40%, transparent)` }}
          transition={SPRING.snappy}
        />
      )}
      <button
        type="button"
        onClick={onClick}
        aria-current={selected || undefined}
        className={cn(
          "relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors",
          "focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2",
          selected ? "text-ink" : "text-ink-secondary hover:bg-surface-sunken/60 hover:text-ink",
        )}
      >
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-[17px]"
          style={{ backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)` }}
          aria-hidden="true"
        >
          <AgentAvatar value={emoji} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-[13px]">{name}</span>
          <span className="block truncate text-[11px] text-ink-muted">{hint}</span>
        </span>
      </button>
    </li>
  );
}

/* ─── Mobile avatar strip ─────────────────────────────────── */

export function AgentAvatarStrip({
  role,
  savedAgents = [],
  selection,
  onSelect,
  className,
}: RosterProps) {
  const selectedKey = selection ? selectionKey(selection) : null;

  const items: Array<{
    key: string;
    emoji: string;
    accent: string;
    label: string;
    select: StudioSelection;
  }> = [
    ...NEGOTIATION_AGENT_PRESETS.map((preset) => ({
      key: `preset:${preset.id}`,
      emoji: preset.emoji,
      accent: preset.accentColor,
      label: preset.copy[role].name,
      select: { kind: "preset", id: preset.id } as StudioSelection,
    })),
    ...savedAgents.map((agent) => {
      const base = basePresetOf(agent);
      return {
        key: `saved:${agent.id}`,
        emoji: agent.emoji ?? base?.emoji ?? "✦",
        accent: base?.accentColor ?? "var(--action-primary)",
        label: agent.name,
        select: { kind: "saved", id: agent.id } as StudioSelection,
      };
    }),
  ];

  return (
    <div
      className={cn("scrollbar-hide flex gap-1 overflow-x-auto px-3 py-2", className)}
      role="tablist"
      aria-label="Agents"
    >
      {items.map((item) => {
        const selected = selectedKey === item.key;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(item.select)}
            className="flex w-17 shrink-0 flex-col items-center gap-1 rounded-xl px-1 py-1.5 focus-visible:outline-2 focus-visible:outline-focus"
          >
            <span className="relative flex size-12 items-center justify-center" aria-hidden="true">
              {/* Selection ring — same moving-object trick as the sidebar. */}
              {selected && (
                <motion.span
                  layoutId="studio-strip-selection"
                  className="absolute inset-0 rounded-full"
                  style={{ border: `2px solid ${item.accent}` }}
                  transition={SPRING.snappy}
                />
              )}
              <span
                className="flex size-10 items-center justify-center rounded-full text-[19px]"
                style={{ backgroundColor: `color-mix(in srgb, ${item.accent} 14%, transparent)` }}
              >
                <AgentAvatar value={item.emoji} />
              </span>
            </span>
            <span
              className={cn(
                "line-clamp-1 w-full text-center text-[10px] leading-tight",
                selected ? "font-semibold text-ink" : "text-ink-muted",
              )}
            >
              {item.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

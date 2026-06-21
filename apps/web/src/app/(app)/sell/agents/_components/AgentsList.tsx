"use client";

import {
  NEGOTIATION_AGENT_PRESETS,
  type NegotiationAgent,
  type NegotiationAgentPreset,
  type NegotiationAgentPresetId,
} from "@haggle/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { WeightRadar } from "@/components/agents/WeightRadar";
import {
  deleteNegotiationAgent,
  listNegotiationAgents,
  rowToNegotiationAgent,
} from "@/lib/negotiation-agents-api";

type Role = "buyer" | "seller";

/** Optional selection mode — used when this list is embedded in a wizard or
 *  modal where a card click should pick the agent instead of navigating. */
export interface AgentsListSelectMode {
  selectedPresetId?: NegotiationAgentPresetId | null;
  selectedCustomId?: string | null;
  onSelectPreset: (preset: NegotiationAgentPreset) => void;
  onSelectCustom: (agent: NegotiationAgent) => void;
}

interface AgentsListProps {
  role: Role;
  /** Hide the page-level header (title + Create button). Used when the list is
   *  embedded as a preset picker inside the agent builder / wizard. */
  embedded?: boolean;
  selectMode?: AgentsListSelectMode;
}

export function AgentsList({ role, embedded = false, selectMode }: AgentsListProps) {
  const [customs, setCustoms] = useState<NegotiationAgent[]>([]);
  const newHref = role === "buyer" ? "/buy/agents/new" : "/sell/agents/new";
  const inSelectMode = !!selectMode;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await listNegotiationAgents(role);
        if (cancelled) return;
        setCustoms(rows.filter((r) => !r.isSystem).map(rowToNegotiationAgent));
      } catch {
        if (!cancelled) setCustoms([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this agent? This cannot be undone.")) return;
    try {
      await deleteNegotiationAgent(id);
      setCustoms((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete agent");
    }
  };

  const handlePresetClick = (preset: NegotiationAgentPreset, e: React.MouseEvent) => {
    if (selectMode) {
      e.preventDefault();
      selectMode.onSelectPreset(preset);
    }
  };

  const containerClass = embedded ? "w-full" : "max-w-[1100px] mx-auto px-4 sm:px-6 py-8 sm:py-10";

  // Page-mode rules: presets only show on empty state (or always when embedded).
  // My Agents only shows when there are some (or always when embedded so the
  // picker can list previously-saved agents).
  const isPageEmpty = !embedded && customs.length === 0;
  const showPresets = embedded || customs.length === 0;
  const showMyAgents = embedded || customs.length > 0;

  return (
    <div className={containerClass}>
      {!embedded && (
        <div className="flex items-center justify-between mb-8 gap-3">
          <div>
            <h1 className="text-[22px] font-bold text-text-primary mb-1">Negotiation Agents</h1>
            <p className="text-[13px] text-ink-muted">
              {isPageEmpty ? "No agents yet — start with a preset." : "Manage your saved agents."}
            </p>
          </div>
          {customs.length > 0 && (
            <Link
              href={newHref}
              className="px-4 py-2.5 text-sm font-bold rounded-md bg-cta text-on-cta hover:bg-cta-hover transition-colors whitespace-nowrap"
            >
              + Create Agent
            </Link>
          )}
        </div>
      )}

      {/* Presets */}
      {showPresets && (
        <section className="mb-10">
          <h2 className="text-[12px] font-bold tracking-wider uppercase text-ink-secondary mb-3">
            {isPageEmpty ? "Start with a preset" : "Presets"}
          </h2>
          <div
            className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${embedded ? "" : "lg:grid-cols-4"}`}
          >
            {NEGOTIATION_AGENT_PRESETS.map((preset) => {
              const copy = preset.copy[role];
              const isSelected =
                selectMode?.selectedPresetId === preset.id && !selectMode.selectedCustomId;
              return (
                <Link
                  key={preset.id}
                  href={`${newHref}?preset=${preset.id}`}
                  onClick={(e) => handlePresetClick(preset, e)}
                  className="bg-bg-card border border-border-default rounded-xl p-4 flex items-start gap-3 hover:border-action-primary/40 transition-colors cursor-pointer"
                  style={{
                    borderLeftWidth: 3,
                    borderLeftStyle: "solid",
                    borderLeftColor: isSelected ? "var(--action-primary)" : preset.accentColor,
                    ...(isSelected
                      ? {
                          borderTopColor: "var(--action-primary)",
                          borderRightColor: "var(--action-primary)",
                          borderBottomColor: "var(--action-primary)",
                          boxShadow: "0 0 0 1px var(--action-primary)",
                        }
                      : {}),
                  }}
                >
                  <span
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-2xl"
                    style={{ backgroundColor: `${preset.accentColor}22` }}
                  >
                    {preset.emoji}
                  </span>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-text-primary mb-0.5">{copy.name}</h3>
                    <p className="text-[12px] text-action-primary mb-1.5 truncate">
                      {copy.tagline}
                    </p>
                    <p className="text-[11.5px] text-ink-muted leading-snug line-clamp-3">
                      {copy.description}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Custom agents */}
      {showMyAgents && (
        <section>
          <div className="flex items-center justify-between mb-3 gap-3">
            <h2 className="text-[12px] font-bold tracking-wider uppercase text-ink-secondary">
              My Agents{" "}
              <span className="text-ink-muted font-normal normal-case">({customs.length})</span>
            </h2>
          </div>
          {customs.length === 0 ? (
            <div className="bg-bg-card border border-dashed border-border-default rounded-xl px-6 py-10 text-center">
              <p className="text-[13px] text-ink-muted">
                No custom agents yet. Customize a preset to make one.
              </p>
            </div>
          ) : (
            <div
              className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${embedded ? "" : "lg:grid-cols-3"}`}
            >
              {customs.map((agent) => {
                const isSelected = selectMode?.selectedCustomId === agent.id;
                const cardClasses =
                  "bg-bg-card border border-border-default rounded-xl p-4 flex gap-3 transition-colors" +
                  (inSelectMode ? " cursor-pointer hover:border-action-primary/40" : "");

                const body = (
                  <>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="text-lg">{agent.emoji ?? "✦"}</span>
                        <h3 className="text-sm font-bold text-text-primary truncate">
                          {agent.name}
                        </h3>
                      </div>
                      {agent.description && (
                        <p className="text-[11.5px] text-ink-muted leading-snug line-clamp-2 mb-3">
                          {agent.description}
                        </p>
                      )}
                      {!inSelectMode && (
                        <div className="flex gap-3 text-[12px]">
                          <Link
                            href={`/${role === "buyer" ? "buy" : "sell"}/agents/${agent.id}/edit`}
                            className="text-action-primary hover:text-action-primary"
                          >
                            Edit
                          </Link>
                          <button
                            type="button"
                            onClick={() => handleDelete(agent.id)}
                            className="text-error hover:text-error"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="w-[88px] h-[88px] flex-shrink-0 opacity-90">
                      {agent.weights ? (
                        <WeightRadar weights={agent.weights} size={88} labels={false} />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-3xl">
                          {agent.emoji ?? "✦"}
                        </div>
                      )}
                    </div>
                  </>
                );

                return inSelectMode ? (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => selectMode!.onSelectCustom(agent)}
                    className={cardClasses + " text-left"}
                    style={
                      isSelected
                        ? {
                            borderColor: "var(--action-primary)",
                            boxShadow: "0 0 0 1px var(--action-primary)",
                          }
                        : {}
                    }
                  >
                    {body}
                  </button>
                ) : (
                  <article key={agent.id} className={cardClasses}>
                    {body}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

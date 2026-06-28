"use client";

import {
  NEGOTIATION_AGENT_PRESETS,
  type NegotiationAgent,
  type NegotiationAgentPreset,
  type NegotiationAgentPresetId,
} from "@haggle/shared";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { WeightRadar } from "@/components/agents/WeightRadar";
import { buttonVariants, EmptyState, PageHeader, SectionHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
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
        <PageHeader
          className="mb-8"
          title="Negotiation Agents"
          subtitle={
            isPageEmpty ? "No agents yet — start with a preset." : "Manage your saved agents."
          }
          actions={
            customs.length > 0 ? (
              <Link href={newHref} className={buttonVariants({ variant: "primary" })}>
                <Plus className="size-4" />
                Create Agent
              </Link>
            ) : undefined
          }
        />
      )}

      {/* Presets */}
      {showPresets && (
        <section className="mb-10">
          <SectionHeader
            variant="eyebrow"
            className="mb-3"
            title={isPageEmpty ? "Start with a preset" : "Presets"}
          />
          <div
            className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2", !embedded && "lg:grid-cols-4")}
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
                  className={cn(
                    "flex items-start gap-3 rounded-xl border border-l-[3px] bg-surface-raised p-4 transition-colors",
                    isSelected
                      ? "border-action-primary ring-1 ring-action-primary"
                      : "border-line hover:border-action-primary/40",
                  )}
                  style={{ borderLeftColor: isSelected ? undefined : preset.accentColor }}
                >
                  <span
                    className="flex size-11 shrink-0 items-center justify-center rounded-full text-2xl"
                    style={{ backgroundColor: `${preset.accentColor}22` }}
                  >
                    {preset.emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="mb-0.5 font-bold text-ink text-sm">{copy.name}</h3>
                    <p className="mb-1.5 truncate text-[12px] text-action-primary">
                      {copy.tagline}
                    </p>
                    <p className="line-clamp-3 text-[11.5px] text-ink-muted leading-snug">
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
          <SectionHeader
            variant="eyebrow"
            className="mb-3"
            title="My Agents"
            count={customs.length}
          />
          {customs.length === 0 ? (
            <EmptyState
              dashed
              padding="sm"
              className="bg-surface-raised"
              title="No custom agents yet"
              description="Customize a preset to make one."
            />
          ) : (
            <div
              className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2", !embedded && "lg:grid-cols-3")}
            >
              {customs.map((agent) => {
                const isSelected = selectMode?.selectedCustomId === agent.id;

                const body = (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-baseline gap-2">
                        <span className="text-lg">{agent.emoji ?? "✦"}</span>
                        <h3 className="truncate font-bold text-ink text-sm">{agent.name}</h3>
                      </div>
                      {agent.description && (
                        <p className="mb-3 line-clamp-2 text-[11.5px] text-ink-muted leading-snug">
                          {agent.description}
                        </p>
                      )}
                      {!inSelectMode && (
                        <div className="flex gap-3 text-[12px]">
                          <Link
                            href={`/${role === "buyer" ? "buy" : "sell"}/agents/${agent.id}/edit`}
                            className="font-medium text-action-primary hover:text-ink"
                          >
                            Edit
                          </Link>
                          <button
                            type="button"
                            onClick={() => handleDelete(agent.id)}
                            className="font-medium text-error hover:opacity-80"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="size-[88px] shrink-0 opacity-90">
                      {agent.weights ? (
                        <WeightRadar weights={agent.weights} size={88} labels={false} />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-3xl">
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
                    onClick={() => selectMode?.onSelectCustom(agent)}
                    className={cn(
                      "flex gap-3 rounded-xl border bg-surface-raised p-4 text-left transition-colors",
                      isSelected
                        ? "border-action-primary ring-1 ring-action-primary"
                        : "border-line hover:border-action-primary/40",
                    )}
                  >
                    {body}
                  </button>
                ) : (
                  <article
                    key={agent.id}
                    className="flex gap-3 rounded-xl border border-line bg-surface-raised p-4"
                  >
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

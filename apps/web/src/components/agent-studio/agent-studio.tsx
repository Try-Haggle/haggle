"use client";

import type { ChatStrategy } from "@haggle/shared";
import {
  type AgentBuilderState,
  builderStateFromAgentRow,
  createBuilderState,
  engineParamsFromPreset,
  getNegotiationAgentPreset,
  isBuilderCustomized,
  NEGOTIATION_AGENT_PRESETS,
  type NegotiationAgentPreset,
  resolveEffectivePreset,
} from "@haggle/shared";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { MessagesSquare, PanelRightOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type AdvancedOverrides,
  AdvancedSettingsModal,
} from "@/components/agents/AdvancedSettingsModal";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { DURATION, EASE } from "@/components/listing-detail/motion";
import { MotionRadar } from "@/components/listing-detail/motion-radar";
import { Drawer } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { NegotiationAgentBuilderMemory } from "@/lib/negotiation-agent-builder-types";
import { AgentIdentityPanel } from "./identity-panel";
import { AgentAvatarStrip, AgentRoster } from "./roster";
import { type StudioSavedAgent, type StudioSelection, selectionKey } from "./types";

/**
 * Agent Studio — the unified surface for building a negotiation agent.
 *
 * The layout borrows the two patterns people already know from the LLM apps
 * they use daily (Jakob's law, deliberately):
 *
 *   roster            chat canvas             identity panel
 *   (thread list —    (the agent builds       (live character
 *    ChatGPT/Claude    itself through          sheet — GPT
 *    sidebar)          conversation)           Builder's preview)
 *
 * The premise: the agent IS the conversation. You don't fill a form that
 * configures an agent — you talk to the agent, and the character sheet on the
 * right fills in as consequences of what you said. Switching roster entries
 * is switching threads; each keeps its own in-progress build, so flipping
 * between candidates never loses work.
 *
 * On mobile the same three pieces reflow into patterns native to phones: the
 * roster becomes a horizontal avatar strip (stories/recents), the chat fills
 * the screen, and the character sheet docks as a bar that opens a bottom
 * sheet.
 *
 * The studio owns all build state; the chat itself comes in through a render
 * prop so each embedding surface (standalone page, listing page, seller
 * wizard) can wire its own listing context without this component knowing
 * about listings at all.
 */

/** What the studio hands the chat renderer — everything the real
 *  NegotiationAgentBuilderChat needs to wire itself in. */
export interface StudioChatArgs {
  /** Effective preset (base + overrides) — the agent being talked to. */
  effective: NegotiationAgentPreset;
  /** Stable per-thread id, for the chat's localStorage isolation. */
  storageId: string;
  role: "buyer" | "seller";
  onMemoryUpdate: (memory: NegotiationAgentBuilderMemory) => void;
  onStrategyUpdate: (strategy: ChatStrategy) => void;
}

interface AgentStudioProps {
  role: "buyer" | "seller";
  savedAgents?: StudioSavedAgent[];
  /** Initial roster selection. Defaults to none (invitation state). */
  initialSelection?: StudioSelection;
  /** Renders the briefing chat for the current thread. */
  renderChat: (args: StudioChatArgs) => React.ReactNode;
  /**
   * Persist the current build. Absent → no save affordance (embedded use).
   *
   * Returning the persisted agent's id lets the studio hand the thread over
   * from the preset it was started from to the saved agent it just became —
   * without that, a second Save on the same thread would create a duplicate
   * instead of updating what was just written.
   */
  onSave?: (
    state: AgentBuilderState,
    memory: NegotiationAgentBuilderMemory | null,
  ) => Promise<{ id: string } | undefined>;
  /** Delete a saved agent. Absent → no delete affordance. */
  onDelete?: (agentId: string) => Promise<void>;
  saveLabel?: string;
  className?: string;
}

export function AgentStudio({
  role,
  savedAgents = [],
  initialSelection,
  renderChat,
  onSave,
  onDelete,
  saveLabel,
  className,
}: AgentStudioProps) {
  const [selection, setSelection] = useState<StudioSelection | null>(initialSelection ?? null);
  // One in-progress build per roster entry, so switching threads keeps work.
  const [states, setStates] = useState<Record<string, AgentBuilderState>>(() => {
    if (!initialSelection) return {};
    const seeded = seedState(initialSelection, role, savedAgents);
    return seeded ? { [selectionKey(initialSelection)]: seeded } : {};
  });
  const [memories, setMemories] = useState<Record<string, NegotiationAgentBuilderMemory>>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const savedTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
    },
    [],
  );

  const key = selection ? selectionKey(selection) : null;
  const state = key ? (states[key] ?? null) : null;
  const memory = key ? (memories[key] ?? null) : null;
  const effective = state ? resolveEffectivePreset(state) : null;

  function handleSelect(next: StudioSelection) {
    const nextKey = selectionKey(next);
    setStates((prev) => {
      if (prev[nextKey]) return prev;
      const seeded = seedState(next, role, savedAgents);
      return seeded ? { ...prev, [nextKey]: seeded } : prev;
    });
    setSelection(next);
    // An error belongs to the thread that produced it.
    setWriteError(null);
  }

  function updateState(update: (prev: AgentBuilderState) => AgentBuilderState) {
    if (!key) return;
    setStates((prev) => (prev[key] ? { ...prev, [key]: update(prev[key]) } : prev));
  }

  function handleOverridesApply(overrides: AdvancedOverrides) {
    const { weights, ...engineParams } = overrides;
    updateState((prev) => ({
      ...prev,
      agent: { ...prev.agent, weights: { ...weights }, engineParams },
      dirty: true,
    }));
    setAdvancedOpen(false);
  }

  async function handleSave() {
    if (!state || !onSave || !key) return;
    setSaving(true);
    setWriteError(null);
    try {
      const result = await onSave(state, memory);

      // A preset thread that just became a real agent moves to its saved key,
      // carrying its build and conversation memory across. Re-seeding from
      // `savedAgents` instead would race the parent's refetch and could drop
      // work in progress, so the state is moved rather than rebuilt.
      const savedId = result?.id;
      if (savedId && selection?.kind === "preset") {
        const nextKey = selectionKey({ kind: "saved", id: savedId });
        setStates((prev) =>
          prev[key]
            ? {
                ...prev,
                // `source` has to move too, not just the key: it is what the
                // save handler reads to decide update-vs-create, so a thread
                // left pointing at its preset would create a second agent on
                // the next Save instead of updating the one just written.
                [nextKey]: {
                  ...prev[key],
                  source: { kind: "custom", id: savedId },
                  dirty: false,
                },
              }
            : prev,
        );
        setMemories((prev) => (prev[key] ? { ...prev, [nextKey]: prev[key] } : prev));
        setSelection({ kind: "saved", id: savedId });
      }

      // Brief ✓ confirmation on the button itself — where the eyes already are.
      setSavedFlash(true);
      if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
      savedTimerRef.current = window.setTimeout(() => setSavedFlash(false), 1800);
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : "Couldn't save this agent. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!onDelete || selection?.kind !== "saved" || !key) return;
    const label = state?.agent.name?.trim() || "this agent";
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
    setDeleting(true);
    setWriteError(null);
    try {
      await onDelete(selection.id);
      // Drop the thread with the agent — leaving it selected would point the
      // canvas at a row that no longer exists.
      setStates((prev) => {
        const { [key]: _removed, ...rest } = prev;
        return rest;
      });
      setMemories((prev) => {
        const { [key]: _removed, ...rest } = prev;
        return rest;
      });
      setSelection(null);
      setSheetOpen(false);
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : "Couldn't delete this agent. Try again.");
    } finally {
      setDeleting(false);
    }
  }

  const identityPanel = state && effective && (
    <AgentIdentityPanel
      effective={effective}
      state={state}
      role={role}
      memory={memory}
      name={state.agent.name ?? ""}
      onNameChange={(name) => updateState((prev) => ({ ...prev, agent: { ...prev.agent, name } }))}
      onAvatarChange={(animal) =>
        // Identity, not strategy: no "customized" flag, but it is a change the
        // user will expect Save to keep, so it dirties the build.
        updateState((prev) => ({ ...prev, agent: { ...prev.agent, emoji: animal }, dirty: true }))
      }
      onWeightsChange={(weights) =>
        updateState((prev) => ({
          ...prev,
          agent: { ...prev.agent, weights: { ...weights } },
          dirty: true,
        }))
      }
      onResetToPreset={() =>
        // Drop every override; name and chat memory are the user's words, not
        // strategy, so they survive the reset.
        updateState((prev) => ({
          ...prev,
          agent: {
            ...prev.agent,
            weights: undefined,
            engineParams: undefined,
          },
          dirty: true,
        }))
      }
      onOpenAdvanced={() => setAdvancedOpen(true)}
      onSave={onSave ? handleSave : undefined}
      saving={saving}
      saved={savedFlash}
      saveLabel={saveLabel ?? (selection?.kind === "saved" ? "Save changes" : "Save agent")}
      onDelete={onDelete && selection?.kind === "saved" ? handleDelete : undefined}
      deleting={deleting}
      error={writeError}
    />
  );

  return (
    <MotionConfig reducedMotion="user">
      <div className={cn("flex h-full min-h-0 flex-col bg-surface", className)}>
        {/* ── Mobile: roster as avatar strip ── */}
        <div className="shrink-0 border-line-subtle border-b lg:hidden">
          <AgentAvatarStrip
            role={role}
            savedAgents={savedAgents}
            selection={selection}
            onSelect={handleSelect}
          />
        </div>

        {/* The gap is a margin, not padding, so the row's own border sits on
            it: padding would have drawn the closing line below the gap instead
            of on the panes. Shortening the row here — rather than padding the
            panes — is also what stops the roster and identity dividers short
            of the window edge, since those lines are those panes' own borders.
            The three together close the workspace on all four sides. */}
        <div className="mb-4 flex min-h-0 flex-1 border-line-subtle border-b">
          {/* ── Desktop: roster sidebar ── */}
          <aside className="hidden w-[264px] shrink-0 border-line-subtle border-r lg:block">
            <AgentRoster
              role={role}
              savedAgents={savedAgents}
              selection={selection}
              onSelect={handleSelect}
            />
          </aside>

          {/* ── Chat canvas ── */}
          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            <AnimatePresence mode="wait" initial={false}>
              {state && effective && key ? (
                <motion.div
                  // Keyed per thread: switching agents swaps conversations whole,
                  // like tapping a different chat, instead of morphing in place.
                  key={key}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: DURATION.quick, ease: EASE.standard }}
                  className="flex min-h-0 flex-1 flex-col"
                >
                  {renderChat({
                    effective,
                    storageId: `agent-studio:${role}:${key}`,
                    role,
                    onMemoryUpdate: (next) => setMemories((prev) => ({ ...prev, [key]: next })),
                    onStrategyUpdate: (strategy) =>
                      updateState((prev) => ({
                        ...prev,
                        agent: {
                          ...prev.agent,
                          weights: { ...strategy.weights },
                          engineParams: {
                            ...prev.agent.engineParams,
                            alpha: strategy.alpha,
                            beta: strategy.beta,
                            u_threshold: strategy.u_threshold,
                            u_aspiration: strategy.u_aspiration,
                          },
                        },
                        dirty: true,
                      })),
                  })}
                </motion.div>
              ) : (
                <EmptyCanvas key="empty" role={role} onSelect={handleSelect} />
              )}
            </AnimatePresence>

            {/* ── Mobile: docked identity bar ── */}
            {state && effective && (
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                className="flex shrink-0 items-center gap-2.5 border-line-subtle border-t px-4 py-2.5 text-left transition-colors hover:bg-surface-sunken lg:hidden"
              >
                <span className="size-9 shrink-0" aria-hidden="true">
                  <MotionRadar preset={effective} size={36} showLabels={false} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-[12.5px] text-ink">
                    {state.agent.name?.trim() || effective.copy[role].name}
                  </span>
                  <span className="block truncate text-[10.5px] text-ink-muted">
                    {isBuilderCustomized(state) ? "Customized strategy" : "Preset strategy"} · tap
                    for details
                  </span>
                </span>
                <PanelRightOpen className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
              </button>
            )}
          </main>

          {/* ── Desktop: identity panel ── */}
          <aside className="hidden w-[336px] shrink-0 border-line-subtle border-l lg:block">
            {identityPanel ?? (
              <div className="flex h-full items-center justify-center p-6">
                <p className="text-center text-[12px] text-ink-muted leading-relaxed">
                  Pick an agent to see its character sheet.
                </p>
              </div>
            )}
          </aside>
        </div>
      </div>

      {/* Mobile identity bottom sheet — same panel, phone-native container. */}
      <Drawer
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        side="bottom"
        title={effective ? state?.agent.name?.trim() || effective.copy[role].name : "Agent"}
      >
        <div className="min-h-[50vh]">{identityPanel}</div>
      </Drawer>

      {state && (
        <AdvancedSettingsModal
          open={advancedOpen}
          preset={getNegotiationAgentPreset(state.agent.presetId) ?? NEGOTIATION_AGENT_PRESETS[3]}
          initial={
            effective && isBuilderCustomized(state)
              ? { weights: { ...effective.weights }, ...engineParamsFromPreset(effective) }
              : undefined
          }
          onClose={() => setAdvancedOpen(false)}
          onApply={handleOverridesApply}
        />
      )}
    </MotionConfig>
  );
}

/* ─── Helpers ─────────────────────────────────────────────── */

/** Fresh build state for a roster entry. */
function seedState(
  selection: StudioSelection,
  role: "buyer" | "seller",
  savedAgents: StudioSavedAgent[],
): AgentBuilderState | null {
  if (selection.kind === "preset") {
    return createBuilderState({ side: role, presetId: selection.id });
  }
  const row = savedAgents.find((agent) => agent.id === selection.id);
  return row ? builderStateFromAgentRow(row, role) : null;
}

/** Invitation state — shown before any agent is picked. */
function EmptyCanvas({
  role,
  onSelect,
}: {
  role: "buyer" | "seller";
  onSelect: (selection: StudioSelection) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DURATION.quick }}
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 p-6"
    >
      <MessagesSquare className="size-8 text-ink-muted" aria-hidden="true" />
      <div className="max-w-[340px] text-center">
        <p className="font-semibold text-[15px] text-ink">Pick a negotiator to talk to</p>
        <p className="mt-1.5 text-[12.5px] text-ink-muted leading-relaxed">
          Your agent takes shape through conversation — tell it your budget, deal-breakers, and how
          hard to push, and watch its strategy form.
        </p>
      </div>
      {/* The four archetypes, repeated here so the first tap can happen where
          the eyes already are instead of over in the sidebar. */}
      <div className="flex gap-2">
        {NEGOTIATION_AGENT_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => onSelect({ kind: "preset", id: preset.id })}
            title={preset.copy[role].name}
            className="flex size-12 items-center justify-center rounded-2xl border border-line text-[20px] transition-all hover:scale-105 hover:border-line-strong"
            style={{
              backgroundColor: `color-mix(in srgb, ${preset.accentColor} 8%, transparent)`,
            }}
          >
            <span aria-hidden="true">
              <AgentAvatar value={preset.emoji} />
            </span>
            <span className="sr-only">{preset.copy[role].name}</span>
          </button>
        ))}
      </div>
    </motion.div>
  );
}

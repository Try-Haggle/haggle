"use client";

import {
  type AgentBuilderState,
  builderStateFromAgentRow,
  createBuilderState,
  engineParamsFromPreset,
  getNegotiationAgentPreset,
  isBuilderCustomized,
  NEGOTIATION_AGENT_PRESETS,
  type NegotiationAgent,
  type NegotiationAgentPreset,
  type NegotiationAgentPresetId,
  resolveEffectivePreset,
} from "@haggle/shared";
import { Save, Settings2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  type AdvancedOverrides,
  AdvancedSettingsModal,
} from "@/components/agents/AdvancedSettingsModal";
import { StrategyRadar } from "@/components/agents/StrategyRadar";
import { Button, buttonVariants, Input, PageHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
import { draftNegotiationAgentStore } from "@/lib/draft-negotiation-agent-store";
import type { NegotiationAgentBuilderMemory } from "@/lib/negotiation-agent-builder-types";
import { AgentsList } from "./AgentsList";

type Role = "buyer" | "seller";

export interface AgentBuilderProps {
  role: Role;
  value: AgentBuilderState | null;
  onChange: (value: AgentBuilderState | null) => void;
  /** When embedded (wizard, listing detail), hide page-level UI:
   *  Name input + Save/Cancel + page header. The picker UI stays. */
  embedded?: boolean;
  /** Hide the AgentsList picker (presets + my agents). Used by the Edit page
   *  where the user is already editing one specific agent. */
  hidePicker?: boolean;
  /** Page header override (e.g. "Edit Agent"). Defaults to "Create Agent". */
  pageTitle?: string;
  /** Page header subtitle override. */
  pageSubtitle?: string;
  /** Save button label override. Defaults to "Save Agent". */
  saveLabel?: string;
  /** Optional delete handler — shown only in non-embedded mode. */
  onDelete?: () => void;

  /** Optional slot rendered in the left column under the agent picker.
   *  buyer-landing passes <NegotiationAgentBuilderChat> here so the LLM tuning sits inside
   *  the builder layout. Pages without listing context leave it undefined. */
  chatSlot?: React.ReactNode;

  // ── Page-mode props (ignored when embedded) ─────────────────────────────
  name?: string;
  onNameChange?: (n: string) => void;
  onSave?: () => void;
  saving?: boolean;
  /** Back link href. Defaults from role. */
  backHref?: string;
}

/* ─── Helpers ─────────────────────────────────────────────── */

/** Build an AdvancedOverrides snapshot from a resolved preset (for the advanced
 *  modal's initial slider values). */
function overridesFromEffective(ep: NegotiationAgentPreset): AdvancedOverrides {
  return { weights: { ...ep.weights }, ...engineParamsFromPreset(ep) };
}

/**
 * Canonical serialization of the build state into the agent-strategy portion of
 * the listing snapshot. THE one place that turns the in-memory build state into
 * what gets persisted — used by the wizard's step-save AND publish so the two
 * can never disagree. Always emits the full strategy: weights + every engine
 * knob + optional builder-chat memory.
 */
export function agentStrategySnapshotFromState(
  state: AgentBuilderState,
  memory?: NegotiationAgentBuilderMemory | null,
): Record<string, unknown> {
  const ep = resolveEffectivePreset(state);
  // Prefer freshly-captured chat memory; otherwise fall back to the durable
  // memory carried by a reused saved agent so its posture survives publish even
  // when the seller doesn't re-run the builder chat.
  const effectiveMemory = memory ?? state.agent.builderChatMemory ?? null;
  return {
    preset: state.agent.presetId,
    weights: { ...ep.weights },
    source: state.source.kind,
    sourceId: state.source.id,
    customized: isBuilderCustomized(state),
    engineParams: engineParamsFromPreset(ep),
    ...(effectiveMemory ? { negotiationAgentBuilderMemory: effectiveMemory } : {}),
  };
}

const DEFAULT_FALLBACK_PRESET = NEGOTIATION_AGENT_PRESETS[3]; // balancer

/* ─── Component ───────────────────────────────────────────── */

export function AgentBuilder({
  role,
  value,
  onChange,
  embedded = false,
  hidePicker = false,
  pageTitle,
  pageSubtitle,
  saveLabel,
  onDelete,
  chatSlot,
  name = "",
  onNameChange,
  onSave,
  saving = false,
  backHref,
}: AgentBuilderProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Embedded "Save as new agent" — only relevant when overrides are active.
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");
  const [savedAsId, setSavedAsId] = useState<string | null>(null);

  const handleSaveAsAgent = () => {
    if (!value || !isBuilderCustomized(value)) return;
    const ep = resolveEffectivePreset(value);
    const finalName = saveAsName.trim() || `${ep.copy[role].name} (custom)`;
    const agent = draftNegotiationAgentStore.create({
      name: finalName,
      role,
      emoji: ep.emoji,
      negotiationAgentPresetId: value.agent.presetId,
      weights: { ...ep.weights },
      engineParams: engineParamsFromPreset(ep),
    });
    // Re-select as the freshly-saved custom agent (the customization now lives
    // on the agent itself, so the build is no longer "dirty").
    onChange(builderStateFromAgentRow(agent, role, value.item));
    setSaveAsOpen(false);
    setSaveAsName("");
    setSavedAsId(agent.id);
  };

  const resolvedBackHref = backHref ?? (role === "buyer" ? "/buy/agents" : "/sell/agents");
  const effective = value ? resolveEffectivePreset(value) : undefined;
  const copy = effective?.copy[role];

  const handlePresetSelect = (preset: NegotiationAgentPreset) => {
    onChange(createBuilderState({ side: role, presetId: preset.id, item: value?.item }));
  };

  const handleCustomSelect = (agent: NegotiationAgent) => {
    onChange(builderStateFromAgentRow(agent, role, value?.item));
  };

  const handleOverridesApply = (o: AdvancedOverrides) => {
    if (!value) return;
    // AdvancedOverrides = weights + the 12 engine knobs → split into the
    // build-state shape (sparse overrides on top of the base preset).
    const { weights, ...engineParams } = o;
    onChange({
      ...value,
      agent: { ...value.agent, weights: { ...weights }, engineParams },
      dirty: true,
    });
    setAdvancedOpen(false);
  };

  const basePresetForModal: NegotiationAgentPreset = value
    ? (getNegotiationAgentPreset(value.agent.presetId) ?? DEFAULT_FALLBACK_PRESET)
    : DEFAULT_FALLBACK_PRESET;

  const saveAsControl =
    embedded && value?.dirty ? (
      <SaveAsAgentControl
        baseName={effective?.copy[role].name ?? "Agent"}
        open={saveAsOpen}
        name={saveAsName}
        onNameChange={setSaveAsName}
        onOpen={() => setSaveAsOpen(true)}
        onCancel={() => {
          setSaveAsOpen(false);
          setSaveAsName("");
        }}
        onConfirm={handleSaveAsAgent}
      />
    ) : null;

  const savedConfirmation =
    embedded && savedAsId && value?.source.id === savedAsId ? (
      <div className="rounded-md border border-success/40 bg-success-soft px-3 py-2 text-[11px] text-success">
        ✓ Saved to My Agents — reusable in future listings.
      </div>
    ) : null;

  const root = embedded ? (
    <SplitLayout
      role={role}
      left={
        <LeftColumn
          role={role}
          value={value}
          hidePicker={hidePicker}
          chatSlot={chatSlot}
          onSelectPreset={handlePresetSelect}
          onSelectCustom={handleCustomSelect}
        />
      }
      right={
        <>
          <RightSidebar
            effective={effective}
            hasOverrides={value ? isBuilderCustomized(value) : false}
            onOpenAdvanced={() => setAdvancedOpen(true)}
          />
          {saveAsControl}
          {savedConfirmation}
        </>
      }
    />
  ) : (
    <div className="mx-auto max-w-[1100px] px-4 py-8 sm:px-6 sm:py-10">
      <PageHeader
        backHref={resolvedBackHref}
        title={pageTitle ?? "Create Agent"}
        subtitle={
          pageSubtitle ??
          `Your AI will handle ${role === "seller" ? "buyer" : "seller"} negotiations automatically. Pick a style and customize its approach.`
        }
      />

      <SplitLayout
        role={role}
        left={
          <LeftColumn
            role={role}
            value={value}
            hidePicker={hidePicker}
            chatSlot={chatSlot}
            onSelectPreset={handlePresetSelect}
            onSelectCustom={handleCustomSelect}
          />
        }
        right={
          <>
            {/* Name input */}
            <div className="rounded-xl border border-line bg-surface-raised p-5">
              <label
                htmlFor="agent-name"
                className="mb-2 block font-bold text-[11px] text-ink-secondary uppercase tracking-wider"
              >
                Agent Name
              </label>
              <Input
                id="agent-name"
                value={name}
                onChange={(e) => onNameChange?.(e.target.value)}
                placeholder={copy?.name ?? "Untitled Agent"}
              />
            </div>

            <RightSidebar
              effective={effective}
              hasOverrides={value ? isBuilderCustomized(value) : false}
              onOpenAdvanced={() => setAdvancedOpen(true)}
            />

            {/* Save / Cancel / Delete */}
            <div className="space-y-2">
              {(() => {
                // In Edit mode (hidePicker) the user is already on a specific
                // agent — Save is gated by `dirty` only (no "already saved" hint
                // because the page itself is for editing).
                const isExistingClean =
                  !hidePicker && value?.source.kind === "custom" && !value.dirty;
                const editDisabledByClean = hidePicker && !value?.dirty && !!value;
                const disabled =
                  !value || saving || !onSave || isExistingClean || editDisabledByClean;
                return (
                  <>
                    <Button fullWidth loading={saving} disabled={disabled} onClick={onSave}>
                      {saving ? "Saving..." : (saveLabel ?? "Save Agent")}
                    </Button>
                    {isExistingClean && (
                      <p className="text-[11px] text-ink-muted text-center">
                        Already saved. Change something to save a new version.
                      </p>
                    )}
                    {editDisabledByClean && (
                      <p className="text-[11px] text-ink-muted text-center">No changes yet.</p>
                    )}
                  </>
                );
              })()}
              <Link
                href={resolvedBackHref}
                className={cn(buttonVariants({ variant: "secondary", fullWidth: true }))}
              >
                Cancel
              </Link>
              {onDelete && (
                <Button variant="destructive" fullWidth onClick={onDelete}>
                  <Trash2 className="size-3.5" />
                  Delete agent
                </Button>
              )}
            </div>
          </>
        }
      />
    </div>
  );

  return (
    <>
      {root}
      <AdvancedSettingsModal
        open={advancedOpen}
        preset={basePresetForModal}
        initial={
          value && effective && isBuilderCustomized(value)
            ? overridesFromEffective(effective)
            : undefined
        }
        onClose={() => setAdvancedOpen(false)}
        onApply={handleOverridesApply}
      />
    </>
  );
}

/* ─── Layout helpers ──────────────────────────────────────── */

function SplitLayout({
  left,
  right,
}: {
  role: Role;
  left: React.ReactNode;
  right: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
      <div className="space-y-5 min-w-0">{left}</div>
      <aside className="space-y-4">{right}</aside>
    </div>
  );
}

function LeftColumn({
  role,
  value,
  hidePicker = false,
  chatSlot,
  onSelectPreset,
  onSelectCustom,
}: {
  role: Role;
  value: AgentBuilderState | null;
  hidePicker?: boolean;
  chatSlot?: React.ReactNode;
  onSelectPreset: (p: NegotiationAgentPreset) => void;
  onSelectCustom: (a: NegotiationAgent) => void;
}) {
  return (
    <>
      {!hidePicker && (
        <AgentsList
          role={role}
          embedded
          selectMode={{
            selectedPresetId:
              value?.source.kind === "preset"
                ? (value.source.id as NegotiationAgentPresetId)
                : null,
            selectedCustomId: value?.source.kind === "custom" ? value.source.id : null,
            onSelectPreset,
            onSelectCustom,
          }}
        />
      )}

      {chatSlot}
    </>
  );
}

function RightSidebar({
  effective,
  hasOverrides,
  onOpenAdvanced,
}: {
  embedded?: boolean;
  effective?: NegotiationAgentPreset;
  hasOverrides: boolean;
  onOpenAdvanced: () => void;
}) {
  return (
    <>
      {/* Strategy Matrix */}
      <div className="bg-surface-raised border border-line rounded-xl p-5">
        <h3 className="text-[11px] font-bold tracking-wider uppercase text-ink-secondary mb-4 text-center">
          Strategy Matrix
        </h3>
        {effective ? (
          <div className="flex justify-center">
            <StrategyRadar preset={effective} size={220} labels={true} />
          </div>
        ) : (
          <p className="text-center text-[11px] text-ink-muted py-8">
            Pick an agent to see its strategy
          </p>
        )}
      </div>

      {/* Advanced Settings */}
      <button
        type="button"
        onClick={onOpenAdvanced}
        disabled={!effective}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-info/40 bg-info-soft px-4 py-2.5 font-medium text-info text-sm transition-colors hover:bg-info-soft disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Settings2 className="size-3.5" />
        Advanced Settings
        {hasOverrides && <span className="ml-1 font-mono text-[10px]">●</span>}
      </button>
    </>
  );
}

/* ─── Save-as-new-agent inline control (embedded mode only) ── */

function SaveAsAgentControl({
  baseName,
  open,
  name,
  onNameChange,
  onOpen,
  onCancel,
  onConfirm,
}: {
  baseName: string;
  open: boolean;
  name: string;
  onNameChange: (n: string) => void;
  onOpen: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-action-primary/40 bg-action-primary/10 px-4 py-2.5 font-medium text-action-primary text-sm transition-colors hover:bg-action-primary/20"
      >
        <Save className="size-3.5" />
        Save as new agent
      </button>
    );
  }
  return (
    <div className="rounded-md border border-success/40 bg-success-soft p-3">
      <p className="mb-2 text-[11px] text-ink-secondary">Save as new agent</p>
      <Input
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onConfirm();
          else if (e.key === "Escape") onCancel();
        }}
        placeholder={`${baseName} (custom)`}
        className="mb-2"
      />
      <div className="flex gap-2">
        <Button size="sm" className="flex-1" onClick={onConfirm}>
          Save
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

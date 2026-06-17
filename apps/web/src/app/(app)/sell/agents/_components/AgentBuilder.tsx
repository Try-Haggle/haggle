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
import Link from "next/link";
import { useState } from "react";
import {
  type AdvancedOverrides,
  AdvancedSettingsModal,
} from "@/components/agents/AdvancedSettingsModal";
import { StrategyRadar } from "@/components/agents/StrategyRadar";
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
  return {
    preset: state.agent.presetId,
    weights: { ...ep.weights },
    source: state.source.kind,
    sourceId: state.source.id,
    customized: isBuilderCustomized(state),
    engineParams: engineParamsFromPreset(ep),
    ...(memory ? { negotiationAgentBuilderMemory: memory } : {}),
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
      <div
        className="rounded-md px-3 py-2 text-[11px]"
        style={{
          background: "var(--fb-success-bg)",
          border: "1px solid color-mix(in srgb, var(--fb-success-fg) 40%, transparent)",
          color: "var(--fb-success-fg)",
        }}
      >
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
    <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <div className="flex items-center justify-between mb-6 gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-ink mb-1">{pageTitle ?? "Create Agent"}</h1>
          <p className="text-[13px] text-ink-secondary">
            {pageSubtitle ??
              `Your AI will handle ${role === "seller" ? "buyer" : "seller"} negotiations automatically. Pick a style and customize its approach.`}
          </p>
        </div>
        <Link
          href={resolvedBackHref}
          className="text-[13px] text-ink-secondary hover:text-ink whitespace-nowrap"
        >
          ← Back
        </Link>
      </div>

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
            <div className="bg-surface-raised border border-line rounded-xl p-5">
              <label
                htmlFor="agent-name"
                className="block text-[11px] font-bold tracking-wider uppercase text-ink-secondary mb-2"
              >
                Agent Name
              </label>
              <input
                id="agent-name"
                type="text"
                value={name}
                onChange={(e) => onNameChange?.(e.target.value)}
                placeholder={copy?.name ?? "Untitled Agent"}
                className="w-full px-3 py-2 text-sm rounded-md bg-surface-sunken/60 border border-line text-ink placeholder:text-ink-muted focus:outline-none focus:border-focus focus:ring-1 focus:ring-focus"
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
                    <button
                      type="button"
                      onClick={onSave}
                      disabled={disabled}
                      className="w-full px-4 py-2.5 text-sm font-bold rounded-md bg-cta text-on-cta hover:bg-cta-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {saving ? "Saving..." : (saveLabel ?? "Save Agent")}
                    </button>
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
                className="block w-full px-4 py-2.5 text-sm font-medium rounded-md text-center text-ink-secondary bg-surface-sunken border border-line hover:bg-surface-overlay transition-colors"
              >
                Cancel
              </Link>
              {onDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md bg-error-soft border border-error/40 text-error hover:bg-error-soft transition-colors"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 6h18" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  Delete agent
                </button>
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
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md bg-info-soft border border-info/40 text-info hover:bg-info-soft transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        Advanced Settings
        {hasOverrides && <span className="text-[10px] font-mono ml-1">●</span>}
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
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md bg-action-primary/10 border border-action-primary/40 text-action-primary hover:bg-action-primary/20 transition-colors"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
          <polyline points="17 21 17 13 7 13 7 21" />
          <polyline points="7 3 7 8 15 8" />
        </svg>
        Save as new agent
      </button>
    );
  }
  return (
    <div
      className="rounded-md p-3"
      style={{
        background: "color-mix(in srgb, var(--fb-success-fg) 6%, transparent)",
        border: "1px solid color-mix(in srgb, var(--fb-success-fg) 40%, transparent)",
      }}
    >
      <p className="text-[11px] text-ink-secondary mb-2">Save as new agent</p>
      <input
        type="text"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onConfirm();
          else if (e.key === "Escape") onCancel();
        }}
        placeholder={`${baseName} (custom)`}
        className="w-full px-2.5 py-1.5 text-[12px] rounded-md bg-surface-sunken/60 border border-line text-ink placeholder:text-ink-muted focus:outline-none focus:border-focus focus:ring-1 focus:ring-focus mb-2"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="flex-1 px-3 py-1.5 text-[12px] font-bold rounded-md bg-cta text-on-cta hover:bg-cta-hover"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-[12px] text-ink-secondary hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

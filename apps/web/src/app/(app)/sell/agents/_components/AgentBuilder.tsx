"use client";

import {
  type AgentProfile,
  getNegotiationPreset,
  NEGOTIATION_PRESETS,
  type NegotiationPreset,
  type NegotiationPresetId,
  type NegotiationWeights,
} from "@haggle/shared";
import Link from "next/link";
import { useState } from "react";
import {
  type AdvancedOverrides,
  AdvancedSettingsModal,
} from "@/components/agents/AdvancedSettingsModal";
import { StrategyRadar } from "@/components/agents/StrategyRadar";
import { localAgents } from "@/lib/local-agents";
import { AgentsList } from "./AgentsList";

type Role = "buyer" | "seller";

/** Controlled value used by both the standalone page builder and embedded
 *  pickers (wizard step 5, buyer-landing). */
export interface AgentBuilderValue {
  sourceKind: "preset" | "custom";
  sourceId: string;
  basePresetId: NegotiationPresetId;
  effectivePreset: NegotiationPreset;
  overrides: AdvancedOverrides | null;
  /** True when the user has changed something since selecting this source
   *  (Advanced sliders moved, future LLM tuning, etc.). False right after
   *  picking a preset or my-agent. Drives the "Save as new agent" CTA. */
  dirty: boolean;
}

export interface AgentBuilderProps {
  role: Role;
  value: AgentBuilderValue | null;
  onChange: (value: AgentBuilderValue | null) => void;
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
   *  buyer-landing passes <StrategyChat> here so the LLM tuning sits inside
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

function applyOverridesToPreset(
  base: NegotiationPreset,
  o: AdvancedOverrides | null,
): NegotiationPreset {
  if (!o) return base;
  return {
    ...base,
    weights: { ...o.weights },
    alpha: o.alpha,
    beta: o.beta,
    u_threshold: o.u_threshold,
    u_aspiration: o.u_aspiration,
    anchor_ratio: o.anchor_ratio,
    v_t_floor: o.v_t_floor,
    w_rep: o.w_rep,
    r_score_minimum: o.r_score_minimum,
    i_completeness_minimum: o.i_completeness_minimum,
    v_s_base: o.v_s_base,
    n_threshold: o.n_threshold,
    late_round_aggression_modifier: o.late_round_aggression_modifier,
  };
}

function overridesFromAgent(
  agent: AgentProfile,
  base: NegotiationPreset,
): { weights: NegotiationWeights; overrides: AdvancedOverrides | null } {
  const weights = agent.weights ? { ...agent.weights } : { ...base.weights };
  if (!agent.engineParams && !agent.weights) {
    return { weights, overrides: null };
  }
  const overrides: AdvancedOverrides = {
    weights,
    alpha: agent.engineParams?.alpha ?? base.alpha,
    beta: agent.engineParams?.beta ?? base.beta,
    u_threshold: agent.engineParams?.u_threshold ?? base.u_threshold,
    u_aspiration: agent.engineParams?.u_aspiration ?? base.u_aspiration,
    anchor_ratio: agent.engineParams?.anchor_ratio ?? base.anchor_ratio,
    v_t_floor: agent.engineParams?.v_t_floor ?? base.v_t_floor,
    w_rep: agent.engineParams?.w_rep ?? base.w_rep,
    r_score_minimum: agent.engineParams?.r_score_minimum ?? base.r_score_minimum,
    i_completeness_minimum:
      agent.engineParams?.i_completeness_minimum ?? base.i_completeness_minimum,
    v_s_base: agent.engineParams?.v_s_base ?? base.v_s_base,
    n_threshold: agent.engineParams?.n_threshold ?? base.n_threshold,
    late_round_aggression_modifier:
      agent.engineParams?.late_round_aggression_modifier ?? base.late_round_aggression_modifier,
  };
  return { weights, overrides };
}

const DEFAULT_FALLBACK_PRESET = NEGOTIATION_PRESETS[3]; // balancer

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
    if (!value?.overrides) return;
    const baseCopy = value.effectivePreset.copy[role];
    const finalName = saveAsName.trim() || `${baseCopy.name} (custom)`;
    const agent = localAgents.create({
      name: finalName,
      role,
      emoji: value.effectivePreset.emoji,
      negotiationPresetId: value.basePresetId,
      weights: { ...value.effectivePreset.weights },
      engineParams: {
        alpha: value.overrides.alpha,
        beta: value.overrides.beta,
        u_threshold: value.overrides.u_threshold,
        u_aspiration: value.overrides.u_aspiration,
        anchor_ratio: value.overrides.anchor_ratio,
        v_t_floor: value.overrides.v_t_floor,
        w_rep: value.overrides.w_rep,
        r_score_minimum: value.overrides.r_score_minimum,
        i_completeness_minimum: value.overrides.i_completeness_minimum,
        v_s_base: value.overrides.v_s_base,
        n_threshold: value.overrides.n_threshold,
        late_round_aggression_modifier: value.overrides.late_round_aggression_modifier,
      },
    });
    // Switch selection to the freshly-saved custom agent. The customization
    // now lives on the agent itself, so we drop the "customized" overlay.
    onChange({
      sourceKind: "custom",
      sourceId: agent.id,
      basePresetId: value.basePresetId,
      effectivePreset: value.effectivePreset,
      overrides: null,
      dirty: false,
    });
    setSaveAsOpen(false);
    setSaveAsName("");
    setSavedAsId(agent.id);
  };

  const resolvedBackHref = backHref ?? (role === "buyer" ? "/buy/agents" : "/sell/agents");
  const effective = value?.effectivePreset;
  const copy = effective?.copy[role];

  const handlePresetSelect = (preset: NegotiationPreset) => {
    onChange({
      sourceKind: "preset",
      sourceId: preset.id,
      basePresetId: preset.id,
      effectivePreset: preset,
      overrides: null,
      dirty: false,
    });
  };

  const handleCustomSelect = (agent: AgentProfile) => {
    const basePresetId = agent.negotiationPresetId ?? DEFAULT_FALLBACK_PRESET.id;
    const base = getNegotiationPreset(basePresetId);
    if (!base) return;
    const { overrides } = overridesFromAgent(agent, base);
    onChange({
      sourceKind: "custom",
      sourceId: agent.id,
      basePresetId,
      effectivePreset: applyOverridesToPreset(base, overrides),
      overrides,
      dirty: false,
    });
  };

  const handleOverridesApply = (o: AdvancedOverrides) => {
    if (!value) return;
    const base = getNegotiationPreset(value.basePresetId);
    if (!base) return;
    onChange({
      ...value,
      effectivePreset: applyOverridesToPreset(base, o),
      overrides: o,
      dirty: true,
    });
    setAdvancedOpen(false);
  };

  const basePresetForModal: NegotiationPreset = value
    ? (getNegotiationPreset(value.basePresetId) ?? DEFAULT_FALLBACK_PRESET)
    : DEFAULT_FALLBACK_PRESET;

  const saveAsControl =
    embedded && value?.dirty ? (
      <SaveAsAgentControl
        baseName={value.effectivePreset.copy[role].name}
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
    embedded && savedAsId && value?.sourceId === savedAsId ? (
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
            hasOverrides={!!value?.overrides}
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
              hasOverrides={!!value?.overrides}
              onOpenAdvanced={() => setAdvancedOpen(true)}
            />

            {/* Save / Cancel / Delete */}
            <div className="space-y-2">
              {(() => {
                // In Edit mode (hidePicker) the user is already on a specific
                // agent — Save is gated by `dirty` only (no "already saved" hint
                // because the page itself is for editing).
                const isExistingClean =
                  !hidePicker && value?.sourceKind === "custom" && !value.dirty;
                const editDisabledByClean = hidePicker && !value?.dirty && !!value;
                const disabled =
                  !value || saving || !onSave || isExistingClean || editDisabledByClean;
                return (
                  <>
                    <button
                      type="button"
                      onClick={onSave}
                      disabled={disabled}
                      className="w-full px-4 py-2.5 text-sm font-bold rounded-md bg-action-primary text-on-accent hover:bg-action-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
        initial={value?.overrides ?? undefined}
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
  value: AgentBuilderValue | null;
  hidePicker?: boolean;
  chatSlot?: React.ReactNode;
  onSelectPreset: (p: NegotiationPreset) => void;
  onSelectCustom: (a: AgentProfile) => void;
}) {
  return (
    <>
      {!hidePicker && (
        <AgentsList
          role={role}
          embedded
          selectMode={{
            selectedPresetId:
              value?.sourceKind === "preset" ? (value.sourceId as NegotiationPresetId) : null,
            selectedCustomId: value?.sourceKind === "custom" ? value.sourceId : null,
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
  effective?: NegotiationPreset;
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
          className="flex-1 px-3 py-1.5 text-[12px] font-bold rounded-md bg-action-primary text-on-accent hover:bg-action-primary-hover"
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

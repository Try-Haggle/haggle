"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  getNegotiationAgentPreset,
  type NegotiationAgentPresetId,
} from "@haggle/shared";
import {
  createNegotiationAgent,
  type NegotiationAgentConfig,
} from "@/lib/negotiation-agents-api";
import type { NegotiationAgentBuilderMemory } from "@/lib/negotiation-agent-builder-types";
import {
  AgentBuilder,
  applyChatStrategyToDraft,
  type NegotiationAgentDraft,
} from "../_components/AgentBuilder";
import { NegotiationAgentBuilderChat } from "@/app/l/[publicId]/negotiation-agent-builder-chat";

type Role = "buyer" | "seller";

const RECOGNIZED_IDS: NegotiationAgentPresetId[] = [
  "hunter",
  "closer",
  "verifier",
  "balancer",
];

function initialValueFromPresetId(raw?: string): NegotiationAgentDraft | null {
  if (!raw || !RECOGNIZED_IDS.includes(raw as NegotiationAgentPresetId)) return null;
  const preset = getNegotiationAgentPreset(raw as NegotiationAgentPresetId);
  if (!preset) return null;
  return {
    sourceKind: "preset",
    sourceId: preset.id,
    basePresetId: preset.id,
    effectivePreset: preset,
    overrides: null,
    dirty: false,
  };
}

interface NewAgentFormProps {
  role: Role;
  initialPresetId?: string;
}

export function NewAgentForm({ role, initialPresetId }: NewAgentFormProps) {
  const router = useRouter();
  const [value, setValue] = useState<NegotiationAgentDraft | null>(() =>
    initialValueFromPresetId(initialPresetId),
  );
  const [name, setName] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Latest memory captured from the builder chat. Persisted with the agent so
   *  budget/style stated during configuration carries into the snapshot. */
  const [builderChatMemory, setBuilderChatMemory] =
    useState<NegotiationAgentBuilderMemory | null>(null);

  const backHref = role === "buyer" ? "/buy/agents" : "/sell/agents";

  const handleSave = async () => {
    if (!value) return;
    setSaving(true);
    setError(null);
    const copy = value.effectivePreset.copy[role];
    const config: NegotiationAgentConfig = {
      emoji: value.effectivePreset.emoji,
      basePresetId: value.basePresetId,
      negotiationAgentPresetId: value.basePresetId,
      weights: { ...value.effectivePreset.weights },
      builderChatMemory: builderChatMemory ?? undefined,
      ...(value.overrides
        ? {
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
              late_round_aggression_modifier:
                value.overrides.late_round_aggression_modifier,
            },
          }
        : {}),
    };
    try {
      await createNegotiationAgent({
        name: name.trim() || copy.name,
        role,
        config,
      });
      router.push(backHref);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save agent");
      setSaving(false);
    }
  };

  const presetKey = value?.basePresetId ?? "none";
  return (
    <>
      {error && (
        <div className="mx-auto mb-4 max-w-[1100px] px-4 sm:px-6">
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        </div>
      )}
      <AgentBuilder
        role={role}
        value={value}
        onChange={setValue}
        name={name}
        onNameChange={setName}
        onSave={handleSave}
        saving={saving}
        backHref={backHref}
        chatSlot={
          value && (
            <NegotiationAgentBuilderChat
              agent={value.effectivePreset}
              listingPublicId={`agent-new-${role}-${presetKey}`}
              listingTitle="General negotiation strategy"
              listingCategory={null}
              listingPrice={null}
              role={role}
              onNegotiationAgentBuilderMemoryUpdate={setBuilderChatMemory}
              onStrategyUpdate={(s) =>
                setValue((prev) => (prev ? applyChatStrategyToDraft(prev, s) : prev))
              }
            />
          )
        }
      />
    </>
  );
}

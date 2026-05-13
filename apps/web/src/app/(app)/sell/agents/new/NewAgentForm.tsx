"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  getNegotiationPreset,
  type NegotiationPresetId,
} from "@haggle/shared";
import { localAgents } from "@/lib/local-agents";
import {
  AgentBuilder,
  type AgentBuilderValue,
} from "../_components/AgentBuilder";
import { StrategyChat } from "@/app/l/[publicId]/strategy-chat";

type Role = "buyer" | "seller";

const RECOGNIZED_IDS: NegotiationPresetId[] = [
  "hunter",
  "closer",
  "verifier",
  "balancer",
];

function initialValueFromPresetId(raw?: string): AgentBuilderValue | null {
  if (!raw || !RECOGNIZED_IDS.includes(raw as NegotiationPresetId)) return null;
  const preset = getNegotiationPreset(raw as NegotiationPresetId);
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
  const [value, setValue] = useState<AgentBuilderValue | null>(() =>
    initialValueFromPresetId(initialPresetId),
  );
  const [name, setName] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const backHref = role === "buyer" ? "/buy/agents" : "/sell/agents";

  const handleSave = () => {
    if (!value) return;
    setSaving(true);
    const copy = value.effectivePreset.copy[role];
    localAgents.create({
      name: name.trim() || copy.name,
      role,
      emoji: value.effectivePreset.emoji,
      negotiationPresetId: value.basePresetId,
      weights: { ...value.effectivePreset.weights },
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
    });
    router.push(backHref);
  };

  const presetKey = value?.basePresetId ?? "none";
  return (
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
          <StrategyChat
            agent={value.effectivePreset}
            listingPublicId={`agent-new-${role}-${presetKey}`}
            listingTitle="General negotiation strategy"
            listingCategory={null}
            listingPrice={null}
            role={role}
          />
        )
      }
    />
  );
}

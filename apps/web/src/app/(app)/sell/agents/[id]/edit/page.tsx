"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getNegotiationAgentPreset,
  type NegotiationAgent,
} from "@haggle/shared";
import {
  deleteNegotiationAgent,
  getNegotiationAgent,
  rowToNegotiationAgent,
  updateNegotiationAgent,
  type NegotiationAgentConfig,
} from "@/lib/negotiation-agents-api";
import type { NegotiationAgentBuilderMemory } from "@/lib/negotiation-agent-builder-types";
import {
  AgentBuilder,
  applyChatStrategyToDraft,
  type NegotiationAgentDraft,
} from "../../_components/AgentBuilder";
import type { AdvancedOverrides } from "@/components/agents/AdvancedSettingsModal";
import { NegotiationAgentBuilderChat } from "@/app/l/[publicId]/negotiation-agent-builder-chat";

function agentToBuilderValue(agent: NegotiationAgent): NegotiationAgentDraft | null {
  const basePresetId = agent.negotiationAgentPresetId ?? "balancer";
  const base = getNegotiationAgentPreset(basePresetId);
  if (!base) return null;
  const weights = agent.weights ? { ...agent.weights } : { ...base.weights };
  const overrides: AdvancedOverrides = {
    weights,
    alpha: agent.engineParams?.alpha ?? base.alpha,
    beta: agent.engineParams?.beta ?? base.beta,
    u_threshold: agent.engineParams?.u_threshold ?? base.u_threshold,
    u_aspiration: agent.engineParams?.u_aspiration ?? base.u_aspiration,
    anchor_ratio: agent.engineParams?.anchor_ratio ?? base.anchor_ratio,
    v_t_floor: agent.engineParams?.v_t_floor ?? base.v_t_floor,
    w_rep: agent.engineParams?.w_rep ?? base.w_rep,
    r_score_minimum:
      agent.engineParams?.r_score_minimum ?? base.r_score_minimum,
    i_completeness_minimum:
      agent.engineParams?.i_completeness_minimum ??
      base.i_completeness_minimum,
    v_s_base: agent.engineParams?.v_s_base ?? base.v_s_base,
    n_threshold: agent.engineParams?.n_threshold ?? base.n_threshold,
    late_round_aggression_modifier:
      agent.engineParams?.late_round_aggression_modifier ??
      base.late_round_aggression_modifier,
  };
  const effectivePreset = {
    ...base,
    weights,
    alpha: overrides.alpha,
    beta: overrides.beta,
    u_threshold: overrides.u_threshold,
    u_aspiration: overrides.u_aspiration,
    anchor_ratio: overrides.anchor_ratio,
    v_t_floor: overrides.v_t_floor,
    w_rep: overrides.w_rep,
    r_score_minimum: overrides.r_score_minimum,
    i_completeness_minimum: overrides.i_completeness_minimum,
    v_s_base: overrides.v_s_base,
    n_threshold: overrides.n_threshold,
    late_round_aggression_modifier: overrides.late_round_aggression_modifier,
  };
  return {
    sourceKind: "custom",
    sourceId: agent.id,
    basePresetId,
    effectivePreset,
    overrides,
    dirty: false,
  };
}

export default function EditAgentPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [agent, setAgent] = useState<NegotiationAgent | null | undefined>(undefined);
  const [value, setValue] = useState<NegotiationAgentDraft | null>(null);
  const [name, setName] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [initialName, setInitialName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [builderChatMemory, setBuilderChatMemory] =
    useState<NegotiationAgentBuilderMemory | null>(null);

  // Load the agent on mount.
  useEffect(() => {
    if (!params?.id) return;
    let cancelled = false;
    (async () => {
      const row = await getNegotiationAgent(params.id);
      if (cancelled) return;
      const found = row ? rowToNegotiationAgent(row) : null;
      setAgent(found ?? null);
      if (found) {
        setValue(agentToBuilderValue(found));
        setName(found.name);
        setInitialName(found.name);
        const stored = row?.negotiationAgentConfig?.builderChatMemory;
        if (stored && typeof stored === "object") {
          setBuilderChatMemory(stored as unknown as NegotiationAgentBuilderMemory);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params?.id]);

  const role = (agent?.role === "buyer" ? "buyer" : "seller") as
    | "buyer"
    | "seller";
  const backHref = role === "buyer" ? "/buy/agents" : "/sell/agents";

  // Augment dirty: name change should also count.
  const augmentedValue = useMemo<NegotiationAgentDraft | null>(() => {
    if (!value) return value;
    const nameChanged = name.trim() !== initialName.trim();
    return { ...value, dirty: value.dirty || nameChanged };
  }, [value, name, initialName]);

  const handleSave = async () => {
    if (!agent || !augmentedValue) return;
    setSaving(true);
    setError(null);
    const o = augmentedValue.overrides;
    const config: NegotiationAgentConfig = {
      emoji: augmentedValue.effectivePreset.emoji,
      basePresetId: augmentedValue.basePresetId,
      negotiationAgentPresetId: augmentedValue.basePresetId,
      weights: { ...augmentedValue.effectivePreset.weights },
      builderChatMemory: builderChatMemory ?? undefined,
      engineParams: o
        ? {
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
          }
        : undefined,
    };
    try {
      await updateNegotiationAgent(agent.id, {
        name: name.trim() || agent.name,
        config,
      });
      router.push(backHref);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save agent");
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!agent) return;
    if (!confirm(`Delete "${agent.name}"? This cannot be undone.`)) return;
    setError(null);
    try {
      await deleteNegotiationAgent(agent.id);
      router.push(backHref);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete agent");
    }
  };

  if (agent === undefined) {
    return (
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-8">
        <p className="text-slate-400 text-[13px]">Loading agent…</p>
      </div>
    );
  }

  if (agent === null) {
    return (
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-8">
        <p className="text-rose-400 text-[13px] mb-3">
          Agent not found. It may have been deleted.
        </p>
        <button
          type="button"
          onClick={() => router.push("/sell/agents")}
          className="text-[13px] text-cyan-400 hover:text-cyan-300"
        >
          ← Back to Agents
        </button>
      </div>
    );
  }

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
        value={augmentedValue}
        onChange={setValue}
        hidePicker
        pageTitle="Edit Agent"
        pageSubtitle="Customize this agent's negotiation behavior. Changes apply to future listings using this agent."
        saveLabel="Save Changes"
        name={name}
        onNameChange={setName}
        onSave={handleSave}
        onDelete={handleDelete}
        saving={saving}
        backHref={backHref}
        chatSlot={
          augmentedValue && (
            <NegotiationAgentBuilderChat
              agent={augmentedValue.effectivePreset}
              listingPublicId={`agent-edit-${agent.id}`}
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

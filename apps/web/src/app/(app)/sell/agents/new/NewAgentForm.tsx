"use client";

import {
  type AgentBuilderState,
  applyChatStrategyToState,
  createBuilderState,
  engineParamsFromPreset,
  isBuilderCustomized,
  type NegotiationAgentPresetId,
  resolveEffectivePreset,
} from "@haggle/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { NegotiationAgentBuilderChat } from "@/app/l/[publicId]/negotiation-agent-builder-chat";
import { Alert } from "@/components/ui";
import type { NegotiationAgentBuilderMemory } from "@/lib/negotiation-agent-builder-types";
import { createNegotiationAgent, type NegotiationAgentConfig } from "@/lib/negotiation-agents-api";
import { AgentBuilder } from "../_components/AgentBuilder";

type Role = "buyer" | "seller";

const RECOGNIZED_IDS: NegotiationAgentPresetId[] = ["hunter", "closer", "verifier", "balancer"];

function initialStateFromPresetId(raw: string | undefined, side: Role): AgentBuilderState | null {
  if (!raw || !RECOGNIZED_IDS.includes(raw as NegotiationAgentPresetId)) return null;
  return createBuilderState({ side, presetId: raw as NegotiationAgentPresetId });
}

interface NewAgentFormProps {
  role: Role;
  initialPresetId?: string;
}

export function NewAgentForm({ role, initialPresetId }: NewAgentFormProps) {
  const router = useRouter();
  const [value, setValue] = useState<AgentBuilderState | null>(() =>
    initialStateFromPresetId(initialPresetId, role),
  );
  const [name, setName] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Latest memory captured from the builder chat. Persisted with the agent so
   *  budget/style stated during configuration carries into the snapshot. */
  const [builderChatMemory, setBuilderChatMemory] = useState<NegotiationAgentBuilderMemory | null>(
    null,
  );

  const backHref = role === "buyer" ? "/buy/agents" : "/sell/agents";

  const handleSave = async () => {
    if (!value) return;
    setSaving(true);
    setError(null);
    const ep = resolveEffectivePreset(value);
    const copy = ep.copy[role];
    const config: NegotiationAgentConfig = {
      emoji: ep.emoji,
      basePresetId: value.agent.presetId,
      negotiationAgentPresetId: value.agent.presetId,
      weights: { ...ep.weights },
      builderChatMemory: builderChatMemory ?? undefined,
      // When customized, persist the full resolved engine knobs.
      ...(isBuilderCustomized(value) ? { engineParams: engineParamsFromPreset(ep) } : {}),
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

  const presetKey = value?.agent.presetId ?? "none";
  return (
    <>
      {error && (
        <div className="mx-auto mb-4 max-w-[1100px] px-4 sm:px-6">
          <Alert tone="error">{error}</Alert>
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
              agent={resolveEffectivePreset(value)}
              listingPublicId={`agent-new-${role}-${presetKey}`}
              listingTitle="General negotiation strategy"
              listingCategory={null}
              listingPrice={null}
              role={role}
              onNegotiationAgentBuilderMemoryUpdate={setBuilderChatMemory}
              onStrategyUpdate={(s) =>
                setValue((prev) => (prev ? applyChatStrategyToState(prev, s) : prev))
              }
            />
          )
        }
      />
    </>
  );
}

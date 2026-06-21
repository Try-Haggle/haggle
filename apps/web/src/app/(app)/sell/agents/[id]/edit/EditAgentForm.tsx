"use client";

import {
  type AgentBuilderState,
  applyChatStrategyToState,
  type BuilderSide,
  builderStateFromAgentRow,
  engineParamsFromPreset,
  type NegotiationAgent,
  resolveEffectivePreset,
} from "@haggle/shared";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { NegotiationAgentBuilderChat } from "@/app/l/[publicId]/negotiation-agent-builder-chat";
import type { NegotiationAgentBuilderMemory } from "@/lib/negotiation-agent-builder-types";
import {
  deleteNegotiationAgent,
  getNegotiationAgent,
  type NegotiationAgentConfig,
  rowToNegotiationAgent,
  updateNegotiationAgent,
} from "@/lib/negotiation-agents-api";
import { AgentBuilder } from "../../_components/AgentBuilder";

/** Shared edit form. Role is derived from the loaded agent, so the same
 *  component backs both `/sell/agents/:id/edit` and `/buy/agents/:id/edit`. */
export function EditAgentForm() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [agent, setAgent] = useState<NegotiationAgent | null | undefined>(undefined);
  const [value, setValue] = useState<AgentBuilderState | null>(null);
  const [name, setName] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [initialName, setInitialName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [builderChatMemory, setBuilderChatMemory] = useState<NegotiationAgentBuilderMemory | null>(
    null,
  );

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
        const side: BuilderSide = found.role === "buyer" ? "buyer" : "seller";
        setValue(builderStateFromAgentRow(found, side));
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

  const role = (agent?.role === "buyer" ? "buyer" : "seller") as "buyer" | "seller";
  const backHref = role === "buyer" ? "/buy/agents" : "/sell/agents";

  // Augment dirty: name change should also count.
  const augmentedValue = useMemo<AgentBuilderState | null>(() => {
    if (!value) return value;
    const nameChanged = name.trim() !== initialName.trim();
    return { ...value, dirty: value.dirty || nameChanged };
  }, [value, name, initialName]);

  const handleSave = async () => {
    if (!agent || !augmentedValue) return;
    setSaving(true);
    setError(null);
    const ep = resolveEffectivePreset(augmentedValue);
    const config: NegotiationAgentConfig = {
      emoji: ep.emoji,
      basePresetId: augmentedValue.agent.presetId,
      negotiationAgentPresetId: augmentedValue.agent.presetId,
      weights: { ...ep.weights },
      builderChatMemory: builderChatMemory ?? undefined,
      // Persist the full resolved engine knobs (one extractor, shared).
      engineParams: engineParamsFromPreset(ep),
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
        <p className="text-ink-secondary text-[13px]">Loading agent…</p>
      </div>
    );
  }

  if (agent === null) {
    return (
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-8">
        <p className="text-error text-[13px] mb-3">Agent not found. It may have been deleted.</p>
        <button
          type="button"
          onClick={() => router.push(backHref)}
          className="text-[13px] text-action-primary hover:text-action-primary-hover"
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
          <div className="rounded-md border border-error/30 bg-error-soft px-3 py-2 text-sm text-error">
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
              agent={resolveEffectivePreset(augmentedValue)}
              listingPublicId={`agent-edit-${agent.id}`}
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

"use client";

import {
  type AgentBuilderState,
  engineParamsFromPreset,
  isBuilderCustomized,
  type NegotiationAgent,
  type NegotiationAgentPresetId,
  resolveEffectivePreset,
} from "@haggle/shared";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  moveStoredSessions,
  NegotiationAgentBuilderChat,
  readStoredMessages,
  sweepExpiredSessions,
} from "@/app/l/[publicId]/negotiation-agent-builder-chat";
import { AgentStudio } from "@/components/agent-studio";
import type { StudioSelection } from "@/components/agent-studio/types";
import { Spinner } from "@/components/ui";
import type { NegotiationAgentBuilderMemory } from "@/lib/negotiation-agent-builder-types";
import {
  createNegotiationAgent,
  deleteBuilderThread,
  deleteNegotiationAgent,
  listNegotiationAgents,
  type NegotiationAgentConfig,
  rowToNegotiationAgent,
  saveBuilderThread,
  updateNegotiationAgent,
} from "@/lib/negotiation-agents-api";

/**
 * The Agents tab — the Agent Studio wired to the production agents API.
 *
 * This replaces the three-route list → new → edit flow that used to back
 * /buy/agents and /sell/agents. Those pages made building an agent feel like
 * filling in a settings form: pick a card, land on a different page, fill a
 * name, save, get bounced back to a grid. The studio is one surface where the
 * agent is built by talking to it, so create and edit stop being separate
 * destinations — selecting a preset starts a new agent, selecting a saved one
 * continues it, and the same Save commits either.
 *
 * Presentation lives in `components/agent-studio`; everything that touches the
 * platform is here. That split is what let the studio be designed against
 * fixtures at /preview/agent-studio and adopted without a rewrite — the same
 * arrangement Listing Detail v2 uses.
 *
 * Buyer and seller share this component. They genuinely differ in only two
 * places, both already handled below the surface: presets carry per-role copy
 * (`preset.copy[role]`), so a Patient Lister reads as a seller's agent and a
 * Careful Checker as a buyer's, and the briefing chat takes the same `role` to
 * ask the right side's questions. Nothing else about the flow differs, so
 * nothing else is forked.
 */

type Role = "buyer" | "seller";

const PRESET_IDS: NegotiationAgentPresetId[] = ["hunter", "closer", "verifier", "balancer"];

/**
 * Deep-link selection.
 *
 * The old routes are redirected here (`/agents/new?preset=x` → `?preset=x`,
 * `/agents/:id/edit` → `?agent=:id`), so every link that used to reach the
 * builder still opens the right thread.
 */
function selectionFromParams(
  preset: string | null,
  agent: string | null,
  savedAgents: NegotiationAgent[],
): StudioSelection | undefined {
  if (agent && savedAgents.some((a) => a.id === agent)) {
    return { kind: "saved", id: agent };
  }
  if (preset && PRESET_IDS.includes(preset as NegotiationAgentPresetId)) {
    return { kind: "preset", id: preset as NegotiationAgentPresetId };
  }
  return undefined;
}

/**
 * Build state → the row shape the API persists.
 *
 * Kept identical to what the old new/edit forms wrote so agents created before
 * and after the swap are the same records: the resolved weights always, and
 * the full engine knobs only once the build actually diverges from its preset
 * (an untouched preset stays a pointer to that preset rather than a frozen
 * copy of today's numbers).
 */
function configFromState(
  state: AgentBuilderState,
  memory: NegotiationAgentBuilderMemory | null,
): NegotiationAgentConfig {
  const effective = resolveEffectivePreset(state);
  return {
    emoji: effective.emoji,
    basePresetId: state.agent.presetId,
    negotiationAgentPresetId: state.agent.presetId,
    weights: { ...effective.weights },
    builderChatMemory: memory ?? undefined,
    ...(isBuilderCustomized(state) ? { engineParams: engineParamsFromPreset(effective) } : {}),
  };
}

export function AgentStudioPage({ role }: { role: Role }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [savedAgents, setSavedAgents] = useState<NegotiationAgent[] | null>(null);

  const presetParam = searchParams.get("preset");
  const agentParam = searchParams.get("agent");

  const refresh = useCallback(async () => {
    const rows = await listNegotiationAgents(role);
    // System rows are the presets themselves; the roster renders those from
    // the shared catalogue, so only the user's own agents come from the API.
    return rows.filter((row) => !row.isSystem).map(rowToNegotiationAgent);
  }, [role]);

  // Preset briefings are namespaced per visit and so are never read again once
  // abandoned. Swept here, where the studio opens, rather than on a timer.
  useEffect(() => {
    sweepExpiredSessions();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const agents = await refresh();
        if (!cancelled) setSavedAgents(agents);
      } catch {
        // Non-fatal: the four presets alone are enough to build an agent, so a
        // failed roster fetch degrades to "no saved agents" rather than an
        // error page that blocks the whole tab.
        if (!cancelled) setSavedAgents([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const handleSave = useCallback(
    async (state: AgentBuilderState, memory: NegotiationAgentBuilderMemory | null) => {
      const config = configFromState(state, memory);
      const effective = resolveEffectivePreset(state);
      const fallbackName = effective.copy[role].name;
      const name = state.agent.name?.trim() || fallbackName;

      // `source` is what the build was seeded from: a custom row means this
      // thread is an existing agent and must update in place, not fork a copy.
      const existingId = state.source.kind === "custom" ? state.source.id : null;

      if (existingId) {
        await updateNegotiationAgent(existingId, { name, config });
        setSavedAgents(await refresh());
        return { id: existingId };
      }

      const created = await createNegotiationAgent({ name, role, config });
      setSavedAgents(await refresh());
      // Handing the id back lets the studio move this thread onto the saved
      // agent, so a second Save updates it instead of creating a duplicate.
      return { id: created.id };
    },
    [role, refresh],
  );

  /**
   * A preset thread just became a saved agent, so its conversation has to
   * follow it — first to the new browser namespace, then into the database.
   *
   * This is the moment the transcript becomes a record. Up to here it was
   * browser-only, because a preset is a template rather than an agent and its
   * briefing is thrown away when you walk off; from here the conversation
   * belongs to something that exists, and has to survive this device. The
   * write is made here rather than left to the chat's own mirror so that
   * closing the tab right after Save cannot lose what was just committed.
   */
  const handleThreadStorageMove = useCallback(async (from: string, to: string) => {
    moveStoredSessions(from, to);
    const messages = readStoredMessages(to);
    if (messages.length === 0) return;
    await saveBuilderThread({ key: to, messages });
  }, []);

  const handleDelete = useCallback(
    async (agentId: string, storageId: string) => {
      await deleteNegotiationAgent(agentId);
      // The conversation goes with the agent. Best-effort and after the fact:
      // a transcript that outlives its agent is litter, not a failed delete.
      void deleteBuilderThread(storageId);
      setSavedAgents(await refresh());
      // Drop a stale ?agent= so a reload doesn't try to reopen what was
      // just deleted.
      if (agentParam === agentId) {
        router.replace(role === "buyer" ? "/buy/agents" : "/sell/agents", { scroll: false });
      }
    },
    [refresh, agentParam, role, router],
  );

  // The roster is what the studio seeds selections from, so the first paint
  // waits for it rather than mounting empty and re-seeding underneath the user.
  if (savedAgents === null) {
    return (
      <div className="mx-auto flex h-[calc(100dvh-4rem)] items-center justify-center lg:max-w-7xl lg:px-6">
        <span className="flex items-center gap-2 text-[13px] text-ink-secondary">
          <Spinner size="sm" />
          Loading agents…
        </span>
      </div>
    );
  }

  return (
    /* The studio sits in the app's content column on desktop rather than
       bleeding to the viewport edges. The nav's own content is capped at the
       same width, so a full-bleed workspace put the roster's edge ~350px left
       of the logo above it — and widening the nav to match would have moved a
       persistent element every time you entered this tab.

       On a phone it stays edge to edge: there is no column to align with
       there, and insetting a three-pane workspace on a 375px screen only
       costs it room. */
    <div className="mx-auto h-[calc(100dvh-4rem)] lg:max-w-7xl lg:px-6">
      <AgentStudio
        role={role}
        savedAgents={savedAgents}
        // Read only on the studio's first mount, which happens after the
        // roster has loaded — so this needs no memo to stay stable, and later
        // recomputations can't fight the user's own selection.
        initialSelection={selectionFromParams(presetParam, agentParam, savedAgents)}
        onSave={handleSave}
        onDelete={handleDelete}
        onThreadStorageMove={handleThreadStorageMove}
        renderChat={({
          effective,
          storageId,
          durable,
          role: chatRole,
          onMemoryUpdate,
          onStrategyUpdate,
        }) => (
          <NegotiationAgentBuilderChat
            agent={effective}
            // No listing here — these agents are account-level and get picked
            // per deal later. The chat keys its local draft off this id, so a
            // per-thread value keeps each agent's conversation separate.
            //
            // A saved agent also gets a server key, so its transcript is
            // mirrored to the database as it grows and is there on any device.
            // A preset gets none: its briefing is a draft that either becomes
            // an agent — Save carries it over — or is discarded.
            {...(durable ? { serverThreadKey: storageId } : {})}
            listingPublicId={storageId}
            listingTitle="General negotiation strategy"
            listingCategory={null}
            listingPrice={null}
            role={chatRole}
            variant="bare"
            onNegotiationAgentBuilderMemoryUpdate={onMemoryUpdate}
            onStrategyUpdate={onStrategyUpdate}
          />
        )}
      />
    </div>
  );
}

"use client";

import type { AgentAnimal, NegotiationAgentPreset } from "@haggle/shared";
import { useState } from "react";
import {
  AgentPicker,
  type AgentSelection,
  NegotiatorPanel,
  resolveSelectedPreset,
  type SavedAgentOption,
  type StrategyOverride,
} from "@/components/listing-detail";
import { deriveAgentView } from "@/components/listing-detail/strategy";
import { Drawer } from "@/components/ui";
import { useMediaQuery } from "@/hooks/use-media-query";
import { type AgentChatThread, agentChatThread, newChatVisitId } from "@/lib/agent-chat-thread";
import type { AgentIdentity, SellerAgentPick } from "./seller-agent-pick";

/**
 * Step 5 — the seller's negotiator, on the listing page's pattern.
 *
 * The step used to embed the whole AgentBuilder: a preset grid, a radar,
 * weight dials, an advanced-knob modal and the briefing chat, all inline.
 * That is a configuration app inside one question of a five-question flow,
 * and it forced this step to a 1100px column while every other step sat at
 * 512px.
 *
 * The buyer's listing page already solved the same job — pick an agent for one
 * deal — by showing what you have (the current pick as a card, saved agents
 * one tap away) and keeping every knob one tap further, in a drawer. This is
 * those two components, told they are on the seller's side, plus the one thing
 * only a seller does here: choosing the animal and colour buyers will meet.
 */

export interface SellerAgentStepProps {
  pick: SellerAgentPick;
  onPickChange: (next: SellerAgentPick) => void;
  savedAgents?: SavedAgentOption[];
  /** The briefing conversation for the pick being edited, rendered by the wizard. */
  chatSlot?: (args: {
    preset: NegotiationAgentPreset;
    /** Which conversation this is — the same one the Agents tab opens for this pick. */
    thread: AgentChatThread;
    /** The pick being briefed, so the wizard can hand a saved agent its memory. */
    selection: AgentSelection;
    onStrategyUpdate: (strategy: StrategyOverride) => void;
  }) => React.ReactNode;
  /** Hints the briefing has captured so far; drives the card's Ready state. */
  briefHintCount?: number;
  /** Required safety questions still unanswered — publishing waits on these. */
  openRequirementCount?: number;
}

function sameSelection(a: AgentSelection | null, b: AgentSelection | null): boolean {
  return !!a && !!b && a.kind === b.kind && a.id === b.id;
}

export function SellerAgentStep({
  pick,
  onPickChange,
  savedAgents = [],
  chatSlot,
  briefHintCount = 0,
  openRequirementCount = 0,
}: SellerAgentStepProps) {
  const { selection, overrides, identity } = pick;
  const [panelOpen, setPanelOpen] = useState(false);
  /**
   * The drawer edits a DRAFT selection, committed when it closes — the listing
   * page's rule. With one shared selection, trying agents inside the drawer
   * visibly re-arranged the dimmed step behind it, which reads as the page
   * moving on its own. Closing always commits: nothing in the drawer is
   * destructive, so a discard step would only add a question nobody asked.
   */
  const [panelDraft, setPanelDraft] = useState<AgentSelection | null>(null);
  /**
   * Which errand opened the drawer — decided once, per open. Deriving it live
   * from "is anything picked" made the archetype grid vanish right after the
   * first tap, mid-comparison. Deselecting everything brings it back.
   */
  const [openedToChoose, setOpenedToChoose] = useState(false);
  // Matches the Drawer's own desktop/mobile split.
  const isCompact = useMediaQuery("(max-width: 1023px)");
  // Scopes preset conversations to this visit; saved agents ignore it.
  const [visitId] = useState(newChatVisitId);

  /**
   * Saved agents wear the face and colour picked here, so the card, the tiles
   * and the chat all show the agent as the seller has dressed it — including
   * after re-dressing a saved agent that already had a face of its own.
   */
  const dressedSaved = savedAgents.map((agent) => {
    const chosen = identity[`saved:${agent.id}`];
    return chosen
      ? {
          ...agent,
          emoji: chosen.emoji ?? agent.emoji,
          accentColor: chosen.accentColor ?? agent.accentColor,
        }
      : agent;
  });

  function view(sel: AgentSelection | null) {
    const base = deriveAgentView({
      selection: sel,
      overrides,
      savedAgents: dressedSaved,
      role: "seller",
      resolvePreset: resolveSelectedPreset,
    });
    const chosen = base.key ? identity[base.key] : undefined;
    if (!chosen) return base;
    const dress = (preset: NegotiationAgentPreset | undefined) =>
      preset && {
        ...preset,
        ...(chosen.emoji ? { emoji: chosen.emoji } : {}),
        ...(chosen.accentColor ? { accentColor: chosen.accentColor } : {}),
      };
    return { ...base, merged: dress(base.merged), named: dress(base.named) };
  }

  const committed = view(selection);
  const panelSelection = panelOpen ? panelDraft : selection;
  const panel = panelOpen ? view(panelDraft) : committed;

  function openPanel() {
    setPanelDraft(selection);
    // No pick yet means the empty-state door, which exists to choose one.
    setOpenedToChoose(selection === null);
    setPanelOpen(true);
  }

  function closePanel() {
    onPickChange({ ...pick, selection: panelDraft });
    setPanelOpen(false);
  }

  /** Tile taps toggle: a different agent switches, the current one deselects. */
  function toggleCommitted(next: AgentSelection) {
    onPickChange({ ...pick, selection: sameSelection(selection, next) ? null : next });
  }

  function togglePanelDraft(next: AgentSelection) {
    setPanelDraft((current) => (sameSelection(current, next) ? null : next));
  }

  /** Drawer edits (dials, chat, avatar) write to the pick being edited. */
  function applyOverride(next: StrategyOverride) {
    if (!panel.key) return;
    onPickChange({ ...pick, overrides: { ...overrides, [panel.key]: next } });
  }

  function clearOverride() {
    if (!panel.key) return;
    const { [panel.key]: _dropped, ...rest } = overrides;
    onPickChange({ ...pick, overrides: rest });
  }

  function applyIdentity(patch: AgentIdentity) {
    if (!panel.key) return;
    onPickChange({
      ...pick,
      identity: { ...identity, [panel.key]: { ...identity[panel.key], ...patch } },
    });
  }

  return (
    <>
      {/* biome-ignore lint/a11y/useValidAriaRole: "role" is an AgentPicker prop (buyer/seller), not an ARIA role */}
      <AgentPicker
        role="seller"
        selection={selection}
        onSelect={toggleCommitted}
        // The un-renamed merge: the card's "Based on …" line needs the base
        // archetype's name, which `named` has already replaced with a saved
        // agent's own. The drawer gets `named` — there the agent speaks as itself.
        presetOverride={committed.merged}
        savedAgents={dressedSaved}
        onOpenPanel={openPanel}
        briefHintCount={briefHintCount}
        openRequirementCount={openRequirementCount}
      />

      <Drawer
        open={panelOpen}
        onClose={closePanel}
        side={isCompact ? "bottom" : "right"}
        title="Your negotiator"
        // The wizard covers the app shell at z-[60]; a default-layer drawer
        // opened behind it and looked like the button did nothing.
        layer="z-[70]"
      >
        <div className="h-full">
          {/* biome-ignore lint/a11y/useValidAriaRole: "role" is a NegotiatorPanel prop (buyer/seller), not an ARIA role */}
          <NegotiatorPanel
            role="seller"
            selection={panelSelection}
            onSelect={togglePanelDraft}
            savedAgents={dressedSaved}
            effective={panel.named}
            showPresets={openedToChoose || panelSelection === null}
            override={panel.override}
            onOverrideChange={applyOverride}
            onResetOverride={clearOverride}
            onAvatarChange={(animal: AgentAnimal) => applyIdentity({ emoji: animal })}
            onAccentChange={(accentColor) => applyIdentity({ accentColor })}
            chatSlot={
              panel.named && chatSlot && panelSelection
                ? chatSlot({
                    preset: panel.named,
                    thread: agentChatThread("seller", panelSelection, visitId),
                    selection: panelSelection,
                    onStrategyUpdate: applyOverride,
                  })
                : undefined
            }
          />
        </div>
      </Drawer>
    </>
  );
}

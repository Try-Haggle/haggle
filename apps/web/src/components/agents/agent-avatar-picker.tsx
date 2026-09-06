"use client";

import { AGENT_ANIMALS, type AgentAnimal, resolveAgentAvatar } from "@haggle/shared";
import type { ReactNode } from "react";
import { Popover, usePopoverClose } from "@/components/ui";
import { cn } from "@/lib/cn";
import { AgentAvatar } from "./agent-avatar";

interface AgentAvatarPickerProps {
  /** The stored avatar string — resolves to the option that reads as current. */
  value: string | null | undefined;
  onChange: (animal: AgentAnimal) => void;
  /** The chip that opens the picker. It receives the toggle handler. */
  trigger: ReactNode;
  className?: string;
}

/**
 * Pick an agent's face from the vendored animals.
 *
 * The face is identity, not strategy — choosing one never marks the build as
 * "customized" — so the picker is deliberately small: one grid, no search, no
 * categories. Twenty faces is few enough to scan in one glance, which is the
 * whole reason the vendored set stops at head-on animals.
 */
export function AgentAvatarPicker({ value, onChange, trigger, className }: AgentAvatarPickerProps) {
  const current = resolveAgentAvatar(value);
  const selected = current.kind === "animal" ? current.animal : null;
  return (
    <Popover trigger={trigger} className={className} panelClassName="w-[15.75rem] p-2.5">
      <AnimalGrid selected={selected} onChange={onChange} />
    </Popover>
  );
}

/** Split out so it can close the popover it lives in after a pick. */
function AnimalGrid({
  selected,
  onChange,
}: {
  selected: AgentAnimal | null;
  onChange: (animal: AgentAnimal) => void;
}) {
  const close = usePopoverClose();
  return (
    // A fieldset is the group, and its legend is the group's accessible name —
    // the same thing an aria-labelled div would claim, said with the element
    // built for it. Toggle buttons inside, as the preset tiles do: a native
    // radio group has no way to carry the artwork.
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="px-1 pb-2 font-semibold text-[10px] text-ink-muted uppercase tracking-wider">
        Choose a face
      </legend>
      <div className="grid grid-cols-5 gap-1">
        {AGENT_ANIMALS.map((animal) => {
          const isSelected = animal === selected;
          return (
            <button
              key={animal}
              type="button"
              aria-pressed={isSelected}
              aria-label={animal.replace("-", " ")}
              title={animal.replace("-", " ")}
              onClick={() => {
                onChange(animal);
                close();
              }}
              className={cn(
                "flex size-10 items-center justify-center rounded-xl text-[22px] transition-colors",
                "focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-1",
                isSelected
                  ? "bg-surface-sunken ring-1 ring-action-primary"
                  : "hover:bg-surface-sunken",
              )}
            >
              <AgentAvatar value={animal} />
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

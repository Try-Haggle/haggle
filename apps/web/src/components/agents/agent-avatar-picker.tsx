"use client";

import {
  AGENT_ACCENT_SWATCHES,
  AGENT_ANIMALS,
  type AgentAnimal,
  normalizeAgentAccent,
  readableAgentAccent,
  resolveAgentAvatar,
} from "@haggle/shared";
import { type ReactNode, useState } from "react";
import { HexColorInput, HexColorPicker } from "react-colorful";
import { Popover, usePopoverClose } from "@/components/ui";
import { cn } from "@/lib/cn";
import { AgentAvatar } from "./agent-avatar";

interface AgentAvatarPickerProps {
  /** The stored avatar string — resolves to the option that reads as current. */
  value: string | null | undefined;
  onChange: (animal: AgentAnimal) => void;
  /** Current accent, `#rrggbb`. Only read when `onAccentChange` is given. */
  accent?: string | null;
  /**
   * Adds the colour section. Always called with a readable `#rrggbb` — a pale
   * custom pick arrives already darkened, so no caller can store one that
   * disappears as text.
   */
  onAccentChange?: (hex: string) => void;
  /** The chip that opens the picker. It receives the toggle handler. */
  trigger: ReactNode;
  className?: string;
}

/**
 * The name a stored avatar reads as — "Polar bear" for `polar-bear` — or null
 * when it is a plain glyph, which has no name worth showing.
 */
export function agentAvatarLabel(value: string | null | undefined): string | null {
  const current = resolveAgentAvatar(value);
  if (current.kind !== "animal") return null;
  const words = current.animal.replace("-", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Pick an agent's face, and optionally its colour.
 *
 * Both are identity, not strategy — choosing one never marks the build as
 * "customized" — so the picker stays small: one grid of faces, one row of
 * swatches, and a custom colour for the few who want one. Twenty faces and ten
 * colours are few enough to scan in one glance.
 */
export function AgentAvatarPicker({
  value,
  onChange,
  accent,
  onAccentChange,
  trigger,
  className,
}: AgentAvatarPickerProps) {
  const current = resolveAgentAvatar(value);
  const selected = current.kind === "animal" ? current.animal : null;
  return (
    <Popover trigger={trigger} className={className} panelClassName="w-[15.75rem] p-2.5">
      {/* With a colour section the popover stays open after a face is picked,
          so both can be chosen in one visit. */}
      <AnimalGrid selected={selected} onChange={onChange} closeOnPick={!onAccentChange} />
      {onAccentChange && (
        <AccentSection accent={normalizeAgentAccent(accent)} onChange={onAccentChange} />
      )}
    </Popover>
  );
}

/** Split out so it can close the popover it lives in after a pick. */
function AnimalGrid({
  selected,
  onChange,
  closeOnPick,
}: {
  selected: AgentAnimal | null;
  onChange: (animal: AgentAnimal) => void;
  closeOnPick: boolean;
}) {
  const close = usePopoverClose();
  return (
    // A fieldset is the group, and its legend is the group's accessible name —
    // the same thing an aria-labelled div would claim, said with the element
    // built for it. Toggle buttons inside, as the preset tiles do: a native
    // radio group has no way to carry the artwork.
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className={legendClass}>Choose an avatar</legend>
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
                if (closeOnPick) close();
              }}
              className={cn(
                "flex size-10 items-center justify-center rounded-full text-[22px] transition-colors",
                focusRing,
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

function AccentSection({
  accent,
  onChange,
}: {
  accent: string | null;
  onChange: (hex: string) => void;
}) {
  const isSwatch = AGENT_ACCENT_SWATCHES.some((s) => s.hex === accent);
  const [customOpen, setCustomOpen] = useState(Boolean(accent) && !isSwatch);
  // What the user is pointing at, before any readability correction. Kept
  // apart from `accent` so the picker's handle stays under the pointer while
  // the stored colour is quietly darkened.
  const [raw, setRaw] = useState(accent ?? AGENT_ACCENT_SWATCHES[0].hex);
  const adjusted = customOpen && accent !== null && normalizeAgentAccent(raw) !== accent;

  const pickCustom = (hex: string) => {
    const normalized = normalizeAgentAccent(hex);
    if (!normalized) return;
    setRaw(normalized);
    onChange(readableAgentAccent(normalized));
  };

  return (
    <div className="mt-3 border-line-subtle border-t pt-2.5">
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className={legendClass}>Color</legend>
        <div className="grid grid-cols-5 gap-1">
          {AGENT_ACCENT_SWATCHES.map((swatch) => {
            const isSelected = swatch.hex === accent;
            return (
              <button
                key={swatch.id}
                type="button"
                aria-pressed={isSelected}
                aria-label={swatch.id}
                title={swatch.id}
                onClick={() => {
                  setCustomOpen(false);
                  onChange(swatch.hex);
                }}
                className={cn(
                  "flex size-10 items-center justify-center rounded-full transition-colors",
                  focusRing,
                  isSelected
                    ? "bg-surface-sunken ring-1 ring-action-primary"
                    : "hover:bg-surface-sunken",
                )}
              >
                <span className="size-6 rounded-full" style={{ backgroundColor: swatch.hex }} />
              </button>
            );
          })}
        </div>

        <button
          type="button"
          aria-expanded={customOpen}
          onClick={() => {
            if (!customOpen && accent) setRaw(accent);
            setCustomOpen(!customOpen);
          }}
          className={cn(
            "mt-1.5 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-ink-secondary transition-colors hover:bg-surface-sunken",
            focusRing,
          )}
        >
          <span
            aria-hidden="true"
            className="size-4 shrink-0 rounded-full border border-line"
            style={{
              background:
                accent && !isSwatch
                  ? accent
                  : "conic-gradient(#ef4444, #f59e0b, #10b981, #3b82f6, #a855f7, #ef4444)",
            }}
          />
          Custom color
        </button>

        {customOpen && (
          <div className="mt-1.5 space-y-2 px-1">
            <HexColorPicker
              color={raw}
              onChange={pickCustom}
              style={{ width: "100%", height: 140 }}
            />
            <HexColorInput
              color={raw}
              onChange={pickCustom}
              prefixed
              aria-label="Hex color"
              className="h-8 w-full rounded-md border border-line bg-surface-overlay px-2 font-mono text-[12px] text-ink uppercase outline-none focus:border-focus"
            />
            {adjusted && (
              <p className="text-[11px] text-ink-muted leading-snug" aria-live="polite">
                Adjusted slightly so text in this color stays readable.
              </p>
            )}
          </div>
        )}
      </fieldset>
    </div>
  );
}

const legendClass = "px-1 pb-2 font-semibold text-[10px] text-ink-muted uppercase tracking-wider";
const focusRing =
  "focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-1";

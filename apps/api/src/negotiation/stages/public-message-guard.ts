/**
 * Drop an LLM chat line that names private engine numbers.
 *
 * The counterparty and HNP ACTS keep `message`. Floor, target, BOX, and
 * recommended price must not appear there — even as "I can't go below $X".
 */

import type { CoreMemory } from "../types.js";

const RESERVATION_PHRASE =
  /\b(floor|reservation|walk[-\s]?away|won'?t go (below|under)|can(?:not|'t) go (below|under)|lowest I can|bottom is|마지노선|바닥|목표가|한도)\b/i;

function figuresToMinor(text: string): number[] {
  const figures = text.match(/\d[\d,]*(?:\.\d+)?/g);
  if (!figures) return [];
  return figures
    .map((raw) => Math.round(Number(raw.replace(/,/g, "")) * 100))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function collectPrivateMinors(memory: CoreMemory): number[] {
  const range = memory.coaching.acceptable_range;
  return [
    memory.boundaries.my_floor,
    memory.boundaries.my_target,
    memory.coaching.recommended_price,
    range?.min,
    range?.max,
  ].filter((n): n is number => typeof n === "number" && n > 0);
}

function collectPublicMinors(memory: CoreMemory, outgoingPriceMinor?: number): Set<number> {
  return new Set(
    [outgoingPriceMinor, memory.boundaries.opponent_offer, memory.boundaries.current_offer].filter(
      (n): n is number => typeof n === "number" && n > 0,
    ),
  );
}

export function messageLeaksPrivateState(
  text: string,
  memory: CoreMemory,
  outgoingPriceMinor?: number,
): boolean {
  const figures = figuresToMinor(text);
  if (figures.length === 0) return RESERVATION_PHRASE.test(text);

  const publicAllowed = collectPublicMinors(memory, outgoingPriceMinor);
  const privateMinors = new Set(collectPrivateMinors(memory).filter((n) => !publicAllowed.has(n)));

  if (figures.some((n) => privateMinors.has(n))) return true;

  const namedFloorOrTarget = figures.some(
    (n) => n === memory.boundaries.my_floor || n === memory.boundaries.my_target,
  );
  return namedFloorOrTarget && RESERVATION_PHRASE.test(text);
}

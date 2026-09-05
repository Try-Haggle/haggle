/**
 * Agent avatars.
 *
 * An agent's face is stored as one string in `negotiation_agent_config.emoji`.
 * Historically that string was an emoji glyph ("🎯"). It may now also be one
 * of the animal slugs below, which the web app renders as vendored artwork
 * (`apps/web/public/vendor/fluent-emoji/<slug>.svg`, Microsoft Fluent Emoji,
 * MIT — refreshed by `scripts/vendor-fluent-emoji.mjs`).
 *
 * The field is deliberately not renamed and not migrated: rows holding a glyph
 * keep rendering as that glyph, rows holding a slug render as the animal, and
 * `resolveAgentAvatar` is the single place that tells the two apart. Storing
 * the slug rather than an asset path is what keeps the artwork swappable —
 * replacing the vendored SVGs changes every avatar without touching a row.
 */

/**
 * Every animal the web app can render, in display order. Head-on faces only —
 * a roster reads by silhouette, and a side-on body next to a face looks like a
 * different product. Must stay in step with the vendor script's `ANIMALS` map;
 * the web package has a test that fails if a slug here has no file.
 */
export const AGENT_ANIMALS = [
  "fox",
  "rabbit",
  "owl",
  "bear",
  "polar-bear",
  "panda",
  "koala",
  "penguin",
  "raccoon",
  "lion",
  "tiger",
  "wolf",
  "cat",
  "dog",
  "hamster",
  "mouse",
  "frog",
  "cow",
  "pig",
  "monkey",
] as const;

export type AgentAnimal = (typeof AGENT_ANIMALS)[number];

const ANIMAL_SET: ReadonlySet<string> = new Set(AGENT_ANIMALS);

export function isAgentAnimal(value: unknown): value is AgentAnimal {
  return typeof value === "string" && ANIMAL_SET.has(value);
}

export type ResolvedAgentAvatar =
  | { kind: "animal"; animal: AgentAnimal }
  | { kind: "glyph"; glyph: string };

/**
 * Turn a stored avatar string into something renderable.
 *
 * Anything that is not a known animal slug is passed through as a glyph, so an
 * unrecognised value degrades to "shows some text" rather than to a broken
 * image. `fallback` covers the empty case (an agent saved with no face).
 */
export function resolveAgentAvatar(
  value: string | null | undefined,
  fallback = "✦",
): ResolvedAgentAvatar {
  if (isAgentAnimal(value)) return { kind: "animal", animal: value };
  const glyph = value?.trim();
  return { kind: "glyph", glyph: glyph ? glyph : fallback };
}

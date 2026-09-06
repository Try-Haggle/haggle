import { resolveAgentAvatar } from "@haggle/shared";

/** Where the vendored Fluent Emoji SVGs are served from. See NOTICE.md there. */
const ANIMAL_ASSET_DIR = "/vendor/fluent-emoji";

interface AgentAvatarProps {
  /** The stored avatar string — an emoji glyph or an animal slug. */
  value: string | null | undefined;
  /** Shown when `value` is empty. */
  fallback?: string;
  className?: string;
}

/**
 * The one way an agent's face is drawn.
 *
 * Callers keep their own chip — its size, its background, its font-size — and
 * drop this in where the bare `{emoji}` used to be. Both branches size
 * themselves in `em`, so the animal scales with the chip's font-size exactly
 * as the glyph did, and no call site needs to know which kind it got.
 *
 * **That chip is always `rounded-full`.** A face in a circle reads as *who*; a
 * face in a rounded square reads as an app icon. The size-12 chips drifted to
 * `rounded-2xl` once, and the panels stopped matching the rosters beside them.
 */
export function AgentAvatar({ value, fallback, className }: AgentAvatarProps) {
  const avatar = resolveAgentAvatar(value, fallback);
  if (avatar.kind === "glyph") {
    return <span className={className}>{avatar.glyph}</span>;
  }
  return (
    // biome-ignore lint/performance/noImgElement: local vendored SVG at a fixed em size — nothing for next/image to optimise
    <img
      src={`${ANIMAL_ASSET_DIR}/${avatar.animal}.svg`}
      alt=""
      draggable={false}
      className={className}
      // A touch larger than the glyph's em box: the artwork has transparent
      // padding, so at 1em it read smaller than the emoji it replaces.
      style={{ width: "1.45em", height: "1.45em", display: "inline-block" }}
    />
  );
}

/**
 * Motion tokens — the timing half of the design system.
 *
 * The colour system has had tokens since day one; motion never did, so every
 * animated surface in the app invented its own durations inline. These are the
 * shared values, mirrored 1:1 by the `--motion-*` CSS vars in globals.css so a
 * CSS transition and a framer-motion tween can agree.
 *
 * Character: unhurried and decelerating. Premium motion is confident, not
 * bouncy — everything eases out hard and settles. The single exception is
 * `EASE_SELECT`, used where a click should feel physically answered.
 */

/** Seconds — framer-motion's unit. CSS vars carry the same values in ms. */
export const DURATION = {
  /** Hover, press, colour shifts. Below this a transition reads as a glitch. */
  instant: 0.12,
  /** Small state changes: chip select, badge swap, icon rotate. */
  quick: 0.2,
  /** The default. Element enter/exit, panel reveal, layout settle. */
  base: 0.32,
  /** Stage-level moves: section reveal, hero entrance, expanding a panel. */
  slow: 0.52,
  /** Deliberate, once-per-page moments. Use sparingly. */
  deliberate: 0.8,
} as const;

/** Cubic-bezier control points. framer-motion takes these as-is. */
export const EASE = {
  /** Enter + exit in one curve. The workhorse. */
  standard: [0.2, 0, 0, 1],
  /** Entering the screen — starts fast, lands soft. */
  decelerate: [0.05, 0.7, 0.1, 1],
  /** Leaving the screen — starts soft, exits fast. Never use to enter. */
  accelerate: [0.3, 0, 0.8, 0.15],
  /** Slight overshoot. Reserved for direct manipulation (picking an agent). */
  select: [0.34, 1.4, 0.64, 1],
} as const;

/** Springs for anything continuous (radar morph, price ticker, layout). */
export const SPRING = {
  /** Settles without visible wobble. Values, meters, morphs. */
  smooth: { type: "spring", stiffness: 120, damping: 20, mass: 0.9 },
  /** A touch more responsive, for selection feedback. */
  snappy: { type: "spring", stiffness: 260, damping: 24, mass: 0.8 },
} as const;

/** Stagger step between siblings in a revealed group. */
export const STAGGER = {
  tight: 0.04,
  base: 0.07,
  loose: 0.12,
} as const;

/* ─── Reusable variants ───────────────────────────────────── */

/**
 * Standard entrance: rise and fade. `y` stays small on purpose — a large
 * travel distance reads as cheap. 8px is enough to register as motion.
 */
export const riseIn = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION.base, ease: EASE.decelerate },
  },
};

/** Parent of a staggered group. Children use `riseIn`. */
export const staggerGroup = (step: number = STAGGER.base, delay = 0) => ({
  hidden: {},
  visible: {
    transition: { staggerChildren: step, delayChildren: delay },
  },
});

/** Panel that expands in place (agent detail, chat disclosure). */
export const expandPanel = {
  collapsed: { opacity: 0, height: 0 },
  expanded: {
    opacity: 1,
    height: "auto",
    transition: {
      height: { duration: DURATION.base, ease: EASE.standard },
      opacity: { duration: DURATION.quick, ease: EASE.standard, delay: 0.08 },
    },
  },
};

/* ─── Reduced motion ──────────────────────────────────────────
 *
 * These variants are deliberately unconditional, and nothing here should ever
 * be swapped based on `useReducedMotion()`. That hook reads a media query, and
 * the server cannot: branching `initial` on it makes the server render one
 * initial style and a reduced-motion client render another, which React reports
 * as a hydration mismatch on exactly the machines we were trying to be kind to.
 *
 * Instead the subtree is wrapped in `<MotionConfig reducedMotion="user">`.
 * Framer drops transform and layout animation for those users after mount, so
 * the first render is identical on both sides. `useReducedMotion()` is still
 * fine for decisions made strictly after mount (a looping pulse, say) — never
 * for `initial`, and never for whether an element renders at all.
 */

/**
 * Soft Auto/Manual control mode — web client shapes (Eng2 M2).
 *
 * SoT: docs/wip/auto-manual-control-mode-sot.md (staging tip after #150).
 * Also: docs/wip/product-decisions-2026-09-07.md §7;
 *       docs/wip/haggle-core-platform-protocol-design.md (Hard/Soft).
 *
 * Field names match Eng1 M1 / DB: buyer_control_mode, seller_control_mode,
 * pending_* , soft_ai_inflight_party. Credits stay server-side — do not invent
 * credit math in the web client.
 */

import { ApiError, api } from "@/lib/api-client";

export const CONTROL_MODES = ["auto", "manual"] as const;
export type ControlMode = (typeof CONTROL_MODES)[number];

export type ControlModeParty = "buyer" | "seller";

/** Client sync state for Soft control_mode toggle / handoff UX. */
export type ControlModeSyncState =
  | "idle"
  | "handoff" // waiting for in-flight Soft AI/API to finish (SoT §3)
  | "saving"
  | "stubbed" // M1 API not available yet
  | "error";

/** CU-ready labels (SoT §6) — short, unambiguous, agent-surface friendly. */
export const CONTROL_MODE_LABEL: Record<ControlMode, string> = {
  auto: "Auto",
  manual: "Manual",
};

export const DEFAULT_CONTROL_MODE: ControlMode = "auto";

/** localStorage key for Settings default preference (applied at session create by M1). */
export const DEFAULT_CONTROL_MODE_PREF_KEY = "haggle_default_control_mode";

/**
 * Feature flag: UI is always shown (SoT default Auto ON, no start chooser).
 * When the M1 PATCH route is missing, toggles queue + surface a sync stub.
 */
export const CONTROL_MODE_UI_ENABLED = true;

/** SoT/M1 session fields the web may read from GET /negotiations/sessions/:id. */
export type SessionControlModeFields = {
  buyer_control_mode?: ControlMode | null;
  seller_control_mode?: ControlMode | null;
  buyer_pending_control_mode?: ControlMode | null;
  seller_pending_control_mode?: ControlMode | null;
  soft_ai_inflight_party?: ControlModeParty | null;
};

export type PatchControlModeResponse = SessionControlModeFields & {
  /** True when the mode was applied immediately. */
  applied?: boolean;
  /** True when the server deferred apply until Soft AI in-flight finishes (SoT §3 / M1). */
  pending_handoff?: boolean;
  /** @deprecated prefer pending_handoff (M1). */
  pending?: boolean;
  session_id?: string;
};

export function isControlMode(value: unknown): value is ControlMode {
  return value === "auto" || value === "manual";
}

/**
 * Parse a server mode value. Unknown / missing → SoT default `auto`.
 * Never invent a peer mode from client claims — callers must pass server fields only.
 */
export function parseControlMode(value: unknown): ControlMode {
  return isControlMode(value) ? value : DEFAULT_CONTROL_MODE;
}

export function controlModeLabel(mode: ControlMode): string {
  return CONTROL_MODE_LABEL[mode];
}

/** CU-ready counterpart line, e.g. "Counterpart: Manual". */
export function counterpartModeLabel(mode: ControlMode): string {
  return `Counterpart: ${controlModeLabel(mode)}`;
}

/** CU-ready own line, e.g. "You: Auto". */
export function ownModeLabel(mode: ControlMode): string {
  return `You: ${controlModeLabel(mode)}`;
}

/**
 * Resolve own + peer modes from **server session fields only** (anti-spoof).
 * Do not pass client-claimed peer mode into this helper.
 */
export function modesFromServerSession(
  session: SessionControlModeFields | null | undefined,
  party: ControlModeParty,
): { own: ControlMode; peer: ControlMode; ownPending: ControlMode | null; inflight: boolean } {
  const buyer = parseControlMode(session?.buyer_control_mode);
  const seller = parseControlMode(session?.seller_control_mode);
  const own = party === "buyer" ? buyer : seller;
  const peer = party === "buyer" ? seller : buyer;
  const pendingRaw =
    party === "buyer" ? session?.buyer_pending_control_mode : session?.seller_pending_control_mode;
  const ownPending = isControlMode(pendingRaw) ? pendingRaw : null;
  const inflight = session?.soft_ai_inflight_party === party;
  return { own, peer, ownPending, inflight };
}

/** Same-tab + cross-tab listeners for Settings default preference. */
const DEFAULT_CONTROL_MODE_PREF_EVENT = "haggle:default-control-mode";
const DEFAULT_CONTROL_MODE_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365; // 1y

function readDefaultControlModeCookie(): ControlMode | null {
  if (typeof document === "undefined") return null;
  try {
    const prefix = `${DEFAULT_CONTROL_MODE_PREF_KEY}=`;
    for (const part of document.cookie.split("; ")) {
      if (!part.startsWith(prefix)) continue;
      const value = part.slice(prefix.length);
      return isControlMode(value) ? value : null;
    }
  } catch {
    // cookie access blocked
  }
  return null;
}

function writeDefaultControlModeCookie(mode: ControlMode): boolean {
  if (typeof document === "undefined") return false;
  try {
    // Cookie Store API is async / not universal; dual-write with document.cookie is intentional.
    // biome-ignore lint/suspicious/noDocumentCookie: sync preference mirror for reload/re-entry
    document.cookie = `${DEFAULT_CONTROL_MODE_PREF_KEY}=${mode}; Path=/; Max-Age=${DEFAULT_CONTROL_MODE_COOKIE_MAX_AGE_SEC}; SameSite=Lax`;
    return readDefaultControlModeCookie() === mode;
  } catch {
    return false;
  }
}

/**
 * Read Settings Soft control_mode default (SoT §2).
 * Prefers localStorage; falls back to cookie (SSR-friendly / private-mode resilient).
 */
export function readDefaultControlModePreference(): ControlMode {
  if (typeof window === "undefined") return DEFAULT_CONTROL_MODE;
  try {
    const fromStorage = window.localStorage.getItem(DEFAULT_CONTROL_MODE_PREF_KEY);
    if (isControlMode(fromStorage)) return fromStorage;
  } catch {
    // localStorage blocked — try cookie
  }
  return readDefaultControlModeCookie() ?? DEFAULT_CONTROL_MODE;
}

/**
 * Persist Settings Soft control_mode default for the next session start.
 * Dual-writes localStorage + cookie so re-entry / reload still see Manual|Auto.
 * @returns true when at least one store retained the value
 */
export function writeDefaultControlModePreference(mode: ControlMode): boolean {
  if (typeof window === "undefined") return false;
  if (!isControlMode(mode)) return false;

  let stored = false;
  try {
    window.localStorage.setItem(DEFAULT_CONTROL_MODE_PREF_KEY, mode);
    stored = window.localStorage.getItem(DEFAULT_CONTROL_MODE_PREF_KEY) === mode;
  } catch {
    // private mode / quota
  }

  const cookieOk = writeDefaultControlModeCookie(mode);
  const ok = stored || cookieOk;

  if (ok) {
    try {
      window.dispatchEvent(new Event(DEFAULT_CONTROL_MODE_PREF_EVENT));
    } catch {
      // EventTarget unavailable — readers still pick up on remount
    }
  }
  return ok;
}

/** Subscribe to Settings default preference changes (same tab + storage events). */
export function subscribeDefaultControlModePreference(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener(DEFAULT_CONTROL_MODE_PREF_EVENT, handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(DEFAULT_CONTROL_MODE_PREF_EVENT, handler);
  };
}

/**
 * Attach Settings Soft default to POST /negotiations/start body (SoT §2 / M1).
 * Explicit body.buyer_control_mode wins; otherwise the persisted preference is used.
 */
export function withDefaultControlModePreference(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const explicit = body.buyer_control_mode;
  if (isControlMode(explicit)) {
    return { ...body, buyer_control_mode: explicit };
  }
  return {
    ...body,
    buyer_control_mode: readDefaultControlModePreference(),
  };
}

/**
 * PATCH Soft control_mode for the authenticated party.
 * M1 route (SoT shapes): PATCH /negotiations/sessions/:id/control-mode
 * Body: { control_mode: "auto" | "manual" }
 */
export async function patchSessionControlMode(
  sessionId: string,
  controlMode: ControlMode,
): Promise<
  { ok: true; data: PatchControlModeResponse } | { ok: false; stub: true; reason: string }
> {
  try {
    const data = await api.patch<PatchControlModeResponse>(
      `/negotiations/sessions/${sessionId}/control-mode`,
      { control_mode: controlMode },
    );
    return { ok: true, data };
  } catch (err) {
    if (
      err instanceof ApiError &&
      (err.status === 404 || err.status === 501 || err.status === 405)
    ) {
      // M1 not on staging yet — UI keeps SoT field names; caller may queue locally.
      return {
        ok: false,
        stub: true,
        reason: "CONTROL_MODE_API_UNAVAILABLE",
      };
    }
    throw err;
  }
}

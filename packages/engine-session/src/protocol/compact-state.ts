/**
 * HNP public compact state.
 *
 * A protocol compresses what both sides are allowed to see: speech acts,
 * prices, and issue positions. It does not carry private floors, targets,
 * persona, or model strategy. Any agent that has the same public act
 * sequence must reconstruct the same state.
 *
 * Research this follows:
 * - Dialogue State Tracking: overwrite slot values; state size is O(issues),
 *   not O(tokens of transcript).
 * - Agreement Tracking for Multi-Issue Negotiation (Yamaguchi et al., 2023):
 *   track what is open / aligned, not the raw chat.
 * - FIPA-style dialogue acts: OFFER / COUNTER / ACCEPT are the units, not
 *   paragraphs.
 */

import type { HnpActorRole, HnpCoreMessageType, HnpIssueValue, HnpMoney } from "./core.js";
import { fromMinorUnits } from "./core.js";

export const HNP_COMPACT_STATE_VERSION = "hnp.compact.v1" as const;
export const HNP_COMPACT_STATE_CAPABILITY = "hnp.core.compact_state" as const;

const CLAIM_MAX_CHARS = 80;

export type HnpPublicActType = Extract<
  HnpCoreMessageType,
  "OFFER" | "COUNTER" | "ACCEPT" | "REJECT" | "ESCALATE" | "CANCEL"
>;

/** One public move. Deterministic input to the reducer. */
export interface HnpPublicAct {
  sequence: number;
  role: Extract<HnpActorRole, "BUYER" | "SELLER">;
  type: HnpPublicActType;
  total_price?: HnpMoney;
  issues?: HnpIssueValue[];
  /** What they said to the other party — never private reasoning. */
  claim?: string;
}

export type HnpIssueTrackStatus = "OPEN" | "ALIGNED" | "REJECTED";

export interface HnpIssueTrack {
  issue_id: string;
  kind?: "NEGOTIABLE" | "INFORMATIONAL";
  buyer?: string;
  seller?: string;
  status: HnpIssueTrackStatus;
}

export interface HnpPublicCompactState {
  version: typeof HNP_COMPACT_STATE_VERSION;
  sequence: number;
  currency: string;
  price: {
    buyer_minor?: number;
    seller_minor?: number;
    last_role?: "BUYER" | "SELLER";
  };
  issues: HnpIssueTrack[];
  acts: Array<{
    sequence: number;
    role: "BUYER" | "SELLER";
    type: HnpPublicActType;
    price_minor?: number;
    claim?: string;
  }>;
}

export const HNP_COMPACT_STATE_LEGEND = [
  "HNP compact v1 — public negotiation state only.",
  "Same act sequence → same state. No reservation prices or private strategy.",
  "PRICE: latest buyer/seller offer. ISSUE: last value each side stated; ALIGNED if equal.",
  "ACT: sequence role type $price | short public claim.",
].join(" ");

export function sanitizeHnpPublicClaim(claim: string | undefined): string | undefined {
  if (typeof claim !== "string") return undefined;
  const compact = claim.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  return compact.length <= CLAIM_MAX_CHARS ? compact : `${compact.slice(0, CLAIM_MAX_CHARS - 1)}…`;
}

function issueValueKey(value: HnpIssueValue["value"]): string {
  return String(value);
}

function upsertIssue(
  tracks: Map<string, HnpIssueTrack>,
  issue: HnpIssueValue,
  role: "BUYER" | "SELLER",
): void {
  const current = tracks.get(issue.issue_id) ?? {
    issue_id: issue.issue_id,
    kind: issue.kind,
    status: "OPEN" as const,
  };
  const next: HnpIssueTrack = {
    ...current,
    kind: issue.kind ?? current.kind,
    [role === "BUYER" ? "buyer" : "seller"]: issueValueKey(issue.value),
  };
  if (next.buyer != null && next.seller != null) {
    next.status = next.buyer === next.seller ? "ALIGNED" : "OPEN";
  }
  tracks.set(issue.issue_id, next);
}

/**
 * Reduce a public act sequence into compact state.
 * Order is by `sequence`. Duplicate sequences keep the later act.
 */
export function reduceHnpPublicCompactState(
  acts: readonly HnpPublicAct[],
  currency = "USD",
): HnpPublicCompactState {
  const ordered = [...acts].sort((a, b) => a.sequence - b.sequence);
  const issues = new Map<string, HnpIssueTrack>();
  const compactActs: HnpPublicCompactState["acts"] = [];
  let buyer_minor: number | undefined;
  let seller_minor: number | undefined;
  let last_role: "BUYER" | "SELLER" | undefined;
  let sequence = 0;
  let usedCurrency = currency;

  for (const act of ordered) {
    sequence = act.sequence;
    const priceMinor = act.total_price?.units_minor;
    if (act.total_price?.currency) usedCurrency = act.total_price.currency;
    if (act.type === "OFFER" || act.type === "COUNTER") {
      if (typeof priceMinor === "number") {
        if (act.role === "BUYER") buyer_minor = priceMinor;
        else seller_minor = priceMinor;
        last_role = act.role;
      }
    }
    for (const issue of act.issues ?? []) {
      upsertIssue(issues, issue, act.role);
    }
    compactActs.push({
      sequence: act.sequence,
      role: act.role,
      type: act.type,
      price_minor: priceMinor,
      claim: sanitizeHnpPublicClaim(act.claim),
    });
  }

  return {
    version: HNP_COMPACT_STATE_VERSION,
    sequence,
    currency: usedCurrency,
    price: { buyer_minor, seller_minor, last_role },
    issues: [...issues.values()].sort((a, b) => a.issue_id.localeCompare(b.issue_id)),
    acts: compactActs,
  };
}

function usd(minor: number | undefined, currency: string): string {
  if (typeof minor !== "number") return "—";
  return `${currency === "USD" ? "$" : `${currency} `}${fromMinorUnits(minor).toFixed(2)}`;
}

/** LLM-readable rendering. Still only public fields. */
export function encodeHnpCompactStateForLlm(state: HnpPublicCompactState): string {
  const lines = [
    "HNP:",
    `  ${HNP_COMPACT_STATE_LEGEND}`,
    `  PRICE: buyer=${usd(state.price.buyer_minor, state.currency)} seller=${usd(state.price.seller_minor, state.currency)} last=${state.price.last_role ?? "—"}`,
  ];
  if (state.issues.length > 0) {
    lines.push("  ISSUES:");
    for (const issue of state.issues) {
      lines.push(
        `    ${issue.issue_id} ${issue.status} buyer=${issue.buyer ?? "—"} seller=${issue.seller ?? "—"}`,
      );
    }
  }
  if (state.acts.length > 0) {
    lines.push("  ACTS:");
    for (const act of state.acts) {
      const price = usd(act.price_minor, state.currency);
      const claim = act.claim ? ` | ${act.claim}` : "";
      lines.push(`    ${act.sequence} ${act.role} ${act.type} ${price}${claim}`);
    }
  }
  return lines.join("\n");
}

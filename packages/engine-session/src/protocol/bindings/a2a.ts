/**
 * A2A binding — A2A carries tasks; HNP is the negotiation payload.
 *
 * A2A does not get a second offer schema. Task parts embed HnpEnvelope JSON.
 */

import type { HnpEnvelope } from "../core.js";

export const A2A_HNP_SKILL = "hnp.core.negotiation" as const;

export interface A2AHnpTaskPart {
  kind: "data";
  skill: typeof A2A_HNP_SKILL;
  mime_type: "application/hnp+json";
  data: HnpEnvelope;
}

export function hnpEnvelopeToA2ATaskPart(envelope: HnpEnvelope): A2AHnpTaskPart {
  return {
    kind: "data",
    skill: A2A_HNP_SKILL,
    mime_type: "application/hnp+json",
    data: envelope,
  };
}

export function a2aTaskPartToHnpEnvelope(part: A2AHnpTaskPart): HnpEnvelope {
  if (part.skill !== A2A_HNP_SKILL || part.mime_type !== "application/hnp+json") {
    throw new Error("A2A_HNP_PART_MISMATCH");
  }
  return part.data;
}

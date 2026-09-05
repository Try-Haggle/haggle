export {
  AGENT_ANIMALS,
  type AgentAnimal,
  isAgentAnimal,
  type ResolvedAgentAvatar,
  resolveAgentAvatar,
} from "./avatar.js";
export {
  FIELD_DESCRIPTORS,
  type FieldDescriptor,
  type FieldDimension,
  type FieldTier,
  fieldsByTier,
  getFieldDescriptor,
} from "./field-descriptions.js";
export {
  getNegotiationAgentPreset,
  NEGOTIATION_AGENT_PRESETS,
} from "./negotiation-agent-presets.js";

export { presetToEngineParameters } from "./preset-to-params.js";
export type {
  NegotiationAgentPreset,
  NegotiationAgentPresetCopy,
  NegotiationAgentPresetId,
  NegotiationWeights,
} from "./types.js";
export { DEFAULT_NEGOTIATION_AGENT_PRESET_ID } from "./types.js";

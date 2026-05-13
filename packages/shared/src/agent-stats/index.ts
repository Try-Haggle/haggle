export type {
  StatKey,
  EngineStats,
  StatGroup,
  AgentRole,
  StatCopy,
  RoleCopy,
  AgentPreset,
  AgentProfile,
  EngineParameters,
} from "./types.js";

export {
  STAT_KEYS,
  STAT_GROUP,
  STAT_BUDGET,
  STAT_MIN,
  STAT_MAX,
} from "./types.js";

export {
  AGENT_PRESETS,
  DEFAULT_PRESET_ID,
  getPreset,
} from "./presets.js";

export {
  SELLER_COPY,
  BUYER_COPY,
  STAT_LABELS,
  SECTION_LABELS,
  SECTION_SUBTITLES,
  copyFor,
} from "./copy.js";

export {
  statsToParameters,
  validateStats,
  type StatsValidation,
} from "./stats-to-params.js";

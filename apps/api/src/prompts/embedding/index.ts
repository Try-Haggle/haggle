/**
 * Embedding prompts barrel (Step 62).
 *
 * Exports: default / electronics / fashion builders + registry + types.
 */

export { buildDefaultEmbeddingInput, getPriceBand } from "./default.js";
export { buildElectronicsEmbeddingInput } from "./electronics.js";
export { buildFashionEmbeddingInput } from "./fashion.js";
export { EMBEDDING_BUILDERS, resolveEmbeddingBuilder } from "./registry.js";
export type {
  EmbeddingBuilderEntry,
  EmbeddingCategory,
  EmbeddingInputBuilder,
} from "./types.js";

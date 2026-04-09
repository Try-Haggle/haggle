/**
 * Embedding input builder types (Step 62 Part A).
 *
 * A builder converts a listing snapshot into the text input that is fed
 * to the embedding model. Different categories may emphasize different
 * fields — the registry (see ./registry.ts) picks the right builder.
 */

export type EmbeddingCategory = "electronics" | "fashion" | "default";

export type EmbeddingInputBuilder = (
  snapshot: Record<string, unknown>,
) => string;

export interface EmbeddingBuilderEntry {
  category: EmbeddingCategory;
  /** Substring matches against lowercase snapshot.category. Order matters: first match wins. */
  categoryKeywords: readonly string[];
  build: EmbeddingInputBuilder;
}

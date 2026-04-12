/**
 * Tag Graph Service — DAG traversal + mutation over `tag_edges`.
 *
 * Pure DB layer. No LLM / HTTP calls.
 *
 * - Ancestors / descendants via Postgres WITH RECURSIVE (depth-bounded).
 * - Cycle prevention enforced at application layer.
 * - Duplicate-edge detection via unique constraint violation (Postgres 23505),
 *   surfaced as a typed error (not thrown).
 *
 * Step 50 — see handoff/ARCHITECT-BRIEF.md and docs/features/tag-system-design.md §3.1
 */

import { and, eq, sql, tagEdges, type Database } from "@haggle/db";

export const MAX_DEPTH = 32;

export interface TagGraphError {
  code: "CYCLE" | "SELF_LOOP" | "DEPTH_EXCEEDED" | "DUPLICATE_EDGE";
  message: string;
}

export type AddEdgeResult = { ok: true } | { ok: false; error: TagGraphError };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown; cause?: unknown };
  if (e.code === "23505") return true;
  // Some drivers wrap the original error in `.cause`.
  if (
    e.cause &&
    typeof e.cause === "object" &&
    (e.cause as { code?: unknown }).code === "23505"
  ) {
    return true;
  }
  if (typeof e.message === "string" && e.message.includes("tag_edges_unique")) {
    return true;
  }
  return false;
}

function uniqueStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(values));
}

// ---------------------------------------------------------------------------
// Traversal
// ---------------------------------------------------------------------------

/**
 * Return all ancestor tag ids of `tagId` (transitive parents), up to MAX_DEPTH.
 * Does NOT include `tagId` itself.
 */
export async function getAncestors(
  db: Database,
  tagId: string,
): Promise<string[]> {
  const result = await db.execute(sql`
    WITH RECURSIVE ancestors AS (
      SELECT parent_tag_id AS ancestor_id, 1 AS depth
        FROM tag_edges
       WHERE child_tag_id = ${tagId}
      UNION
      SELECT te.parent_tag_id, a.depth + 1
        FROM tag_edges te
        JOIN ancestors a ON te.child_tag_id = a.ancestor_id
       WHERE a.depth < ${MAX_DEPTH}
    )
    SELECT DISTINCT ancestor_id FROM ancestors
  `);
  const rows = result as unknown as Array<{ ancestor_id: string }>;
  return rows.map((r) => r.ancestor_id).filter((id): id is string => !!id);
}

/**
 * Return all descendant tag ids of `tagId` (transitive children), up to MAX_DEPTH.
 * Does NOT include `tagId` itself.
 */
export async function getDescendants(
  db: Database,
  tagId: string,
): Promise<string[]> {
  const result = await db.execute(sql`
    WITH RECURSIVE descendants AS (
      SELECT child_tag_id AS descendant_id, 1 AS depth
        FROM tag_edges
       WHERE parent_tag_id = ${tagId}
      UNION
      SELECT te.child_tag_id, d.depth + 1
        FROM tag_edges te
        JOIN descendants d ON te.parent_tag_id = d.descendant_id
       WHERE d.depth < ${MAX_DEPTH}
    )
    SELECT DISTINCT descendant_id FROM descendants
  `);
  const rows = result as unknown as Array<{ descendant_id: string }>;
  return rows.map((r) => r.descendant_id).filter((id): id is string => !!id);
}

/**
 * Direct parents (one hop).
 */
export async function getParents(
  db: Database,
  tagId: string,
): Promise<string[]> {
  const rows = await db
    .select({ parentTagId: tagEdges.parentTagId })
    .from(tagEdges)
    .where(eq(tagEdges.childTagId, tagId));
  return uniqueStrings(rows.map((r) => r.parentTagId));
}

/**
 * Direct children (one hop).
 */
export async function getChildren(
  db: Database,
  tagId: string,
): Promise<string[]> {
  const rows = await db
    .select({ childTagId: tagEdges.childTagId })
    .from(tagEdges)
    .where(eq(tagEdges.parentTagId, tagId));
  return uniqueStrings(rows.map((r) => r.childTagId));
}

// ---------------------------------------------------------------------------
// Mutation
// ---------------------------------------------------------------------------

/**
 * Add a parent→child edge.
 * Fails typed (does not throw) for SELF_LOOP / CYCLE / DUPLICATE_EDGE.
 */
export async function addEdge(
  db: Database,
  parentTagId: string,
  childTagId: string,
): Promise<AddEdgeResult> {
  if (parentTagId === childTagId) {
    return {
      ok: false,
      error: {
        code: "SELF_LOOP",
        message: `Cannot add self-loop edge for tag ${parentTagId}`,
      },
    };
  }

  // Cycle check: if `parent` is currently a descendant of `child`, adding
  // parent→child would close a loop.
  const childDescendants = await getDescendants(db, childTagId);
  if (childDescendants.includes(parentTagId)) {
    return {
      ok: false,
      error: {
        code: "CYCLE",
        message: `Adding edge ${parentTagId} → ${childTagId} would create a cycle`,
      },
    };
  }

  try {
    await db.insert(tagEdges).values({ parentTagId, childTagId });
    return { ok: true };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return {
        ok: false,
        error: {
          code: "DUPLICATE_EDGE",
          message: `Edge ${parentTagId} → ${childTagId} already exists`,
        },
      };
    }
    throw err;
  }
}

/**
 * Remove a parent→child edge. Idempotent.
 */
export async function removeEdge(
  db: Database,
  parentTagId: string,
  childTagId: string,
): Promise<void> {
  await db
    .delete(tagEdges)
    .where(
      and(
        eq(tagEdges.parentTagId, parentTagId),
        eq(tagEdges.childTagId, childTagId),
      ),
    );
}

// ---------------------------------------------------------------------------
// Set operations
// ---------------------------------------------------------------------------

/**
 * Given a set of tag ids, return the minimal set by removing any tag that
 * has a descendant also in the set (keep the most specific tags).
 *
 * Used by the L7 step of the placement pipeline.
 */
export async function pruneAncestorsFromSet(
  db: Database,
  tagIds: string[],
): Promise<string[]> {
  const unique = uniqueStrings(tagIds);
  if (unique.length <= 1) return unique;

  const descendantSets = await Promise.all(
    unique.map((id) => getDescendants(db, id).then((d) => new Set(d))),
  );

  return unique.filter((_id, i) => {
    // Drop `id` if any OTHER id in the set is a descendant of it.
    for (let j = 0; j < unique.length; j++) {
      if (i === j) continue;
      if (descendantSets[i].has(unique[j])) return false;
    }
    return true;
  });
}

/**
 * Given a set of tag ids, expand each to include all ancestors.
 * Returns deduplicated union. Used for search expansion.
 */
export async function expandWithAncestors(
  db: Database,
  tagIds: string[],
): Promise<string[]> {
  const unique = uniqueStrings(tagIds);
  if (unique.length === 0) return [];

  const ancestorLists = await Promise.all(
    unique.map((id) => getAncestors(db, id)),
  );

  const out = new Set<string>(unique);
  for (const list of ancestorLists) {
    for (const id of list) out.add(id);
  }
  return Array.from(out);
}

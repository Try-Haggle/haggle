/**
 * Unit tests for tag-graph.service.
 *
 * `@haggle/db` is globally mocked in src/__tests__/setup.ts. We override
 * that mock per-file to provide a `sql` tag function that captures its
 * interpolated values, so our in-memory fake Database can read the target
 * tag id from the sql descriptor and simulate WITH RECURSIVE queries.
 *
 * Covers the 14 test cases listed in handoff/ARCHITECT-BRIEF.md Step 50.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Override the global @haggle/db mock ─────────────────────────────
vi.mock("@haggle/db", () => {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const raw = strings.join(" ");
    return { __sql: true, raw, values };
  };
  return {
    sql,
    eq: (col: unknown, val: unknown) => ({ __op: "eq", col, val }),
    and: (...conds: unknown[]) => ({ __op: "and", conds }),
    tagEdges: {
      parentTagId: { __col: "parentTagId" },
      childTagId: { __col: "childTagId" },
      __table: "tag_edges",
    },
  };
});

// Import AFTER the mock is registered.
import {
  MAX_DEPTH,
  addEdge,
  expandWithAncestors,
  getAncestors,
  getChildren,
  getDescendants,
  getParents,
  pruneAncestorsFromSet,
  removeEdge,
} from "../services/tag-graph.service.js";

// ─── In-memory fake Database ─────────────────────────────────────────

interface Edge {
  parentTagId: string;
  childTagId: string;
}

function createFakeDb(initial: Edge[] = []) {
  const edges: Edge[] = initial.map((e) => ({ ...e }));

  function descendantsOf(tagId: string, maxDepth = MAX_DEPTH): string[] {
    const out = new Set<string>();
    // BFS with per-path depth tracking
    const queue: Array<{ id: string; depth: number }> = [
      { id: tagId, depth: 0 },
    ];
    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (depth >= maxDepth) continue;
      for (const e of edges) {
        if (e.parentTagId === id && !out.has(e.childTagId)) {
          out.add(e.childTagId);
          queue.push({ id: e.childTagId, depth: depth + 1 });
        }
      }
    }
    return Array.from(out);
  }

  function ancestorsOf(tagId: string, maxDepth = MAX_DEPTH): string[] {
    const out = new Set<string>();
    const queue: Array<{ id: string; depth: number }> = [
      { id: tagId, depth: 0 },
    ];
    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (depth >= maxDepth) continue;
      for (const e of edges) {
        if (e.childTagId === id && !out.has(e.parentTagId)) {
          out.add(e.parentTagId);
          queue.push({ id: e.parentTagId, depth: depth + 1 });
        }
      }
    }
    return Array.from(out);
  }

  const db = {
    _edges: edges,

    execute: async (descriptor: unknown) => {
      const d = descriptor as { raw?: string; values?: unknown[] };
      const raw = d?.raw ?? "";
      const values = (d?.values as string[] | undefined) ?? [];
      // Both queries pass the target tag id as the first interpolated value.
      const tagId = values[0] ?? "";
      if (raw.includes("ancestors")) {
        return ancestorsOf(tagId).map((id) => ({ ancestor_id: id }));
      }
      if (raw.includes("descendants")) {
        return descendantsOf(tagId).map((id) => ({ descendant_id: id }));
      }
      return [];
    },

    select: (_cols: unknown) => ({
      from: (_table: unknown) => ({
        where: async (cond: unknown) => {
          const c = cond as {
            __op?: string;
            col?: { __col?: string };
            val?: string;
          };
          if (c?.__op === "eq" && c.col?.__col === "childTagId") {
            return edges
              .filter((e) => e.childTagId === c.val)
              .map((e) => ({ parentTagId: e.parentTagId }));
          }
          if (c?.__op === "eq" && c.col?.__col === "parentTagId") {
            return edges
              .filter((e) => e.parentTagId === c.val)
              .map((e) => ({ childTagId: e.childTagId }));
          }
          return [];
        },
      }),
    }),

    insert: (_table: unknown) => ({
      values: async (vals: Edge) => {
        const exists = edges.some(
          (e) =>
            e.parentTagId === vals.parentTagId &&
            e.childTagId === vals.childTagId,
        );
        if (exists) {
          const err = new Error(
            'duplicate key value violates unique constraint "tag_edges_unique"',
          ) as Error & { code: string };
          err.code = "23505";
          throw err;
        }
        edges.push({ ...vals });
      },
    }),

    delete: (_table: unknown) => ({
      where: async (cond: unknown) => {
        const c = cond as {
          __op?: string;
          conds?: Array<{ col?: { __col?: string }; val?: string }>;
        };
        if (c?.__op !== "and" || !c.conds) return;
        const parentCond = c.conds.find((x) => x.col?.__col === "parentTagId");
        const childCond = c.conds.find((x) => x.col?.__col === "childTagId");
        const p = parentCond?.val;
        const ch = childCond?.val;
        if (!p || !ch) return;
        for (let i = edges.length - 1; i >= 0; i--) {
          if (edges[i].parentTagId === p && edges[i].childTagId === ch) {
            edges.splice(i, 1);
          }
        }
      },
    }),
  };

  return db;
}

type FakeDb = ReturnType<typeof createFakeDb>;

// ─── Tests ───────────────────────────────────────────────────────────

describe("tag-graph.service", () => {
  let db: FakeDb;

  beforeEach(() => {
    db = createFakeDb();
  });

  // Case 1 — linear chain A→B→C→D, ancestors of D = {A,B,C}
  it("getAncestors returns transitive parents in a linear chain", async () => {
    db._edges.push(
      { parentTagId: "A", childTagId: "B" },
      { parentTagId: "B", childTagId: "C" },
      { parentTagId: "C", childTagId: "D" },
    );
    const result = await getAncestors(db as unknown as never, "D");
    expect(result.sort()).toEqual(["A", "B", "C"]);
  });

  // Case 2 — multi-parent: A→C, B→C, ancestors of C = {A,B}
  it("getAncestors handles multiple parents", async () => {
    db._edges.push(
      { parentTagId: "A", childTagId: "C" },
      { parentTagId: "B", childTagId: "C" },
    );
    const result = await getAncestors(db as unknown as never, "C");
    expect(result.sort()).toEqual(["A", "B"]);
  });

  // Case 3 — orphan tag → []
  it("getAncestors returns [] for orphan tag", async () => {
    const result = await getAncestors(db as unknown as never, "X");
    expect(result).toEqual([]);
  });

  // Case 4 — descendants symmetric case
  it("getDescendants returns transitive children", async () => {
    db._edges.push(
      { parentTagId: "A", childTagId: "B" },
      { parentTagId: "B", childTagId: "C" },
      { parentTagId: "C", childTagId: "D" },
    );
    const result = await getDescendants(db as unknown as never, "A");
    expect(result.sort()).toEqual(["B", "C", "D"]);
  });

  // Case 5 — getParents / getChildren are 1-hop only
  it("getParents and getChildren return only direct neighbors (1-hop)", async () => {
    db._edges.push(
      { parentTagId: "A", childTagId: "B" },
      { parentTagId: "B", childTagId: "C" },
      { parentTagId: "X", childTagId: "B" },
    );
    const parents = await getParents(db as unknown as never, "B");
    expect(parents.sort()).toEqual(["A", "X"]);
    const children = await getChildren(db as unknown as never, "B");
    expect(children).toEqual(["C"]);
  });

  // Case 6 — addEdge success
  it("addEdge adds an edge successfully", async () => {
    const res = await addEdge(db as unknown as never, "parent", "child");
    expect(res.ok).toBe(true);
    expect(db._edges).toEqual([
      { parentTagId: "parent", childTagId: "child" },
    ]);
  });

  // Case 7 — self-loop rejected
  it("addEdge rejects a self-loop with SELF_LOOP", async () => {
    const res = await addEdge(db as unknown as never, "A", "A");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("SELF_LOOP");
    expect(db._edges).toEqual([]);
  });

  // Case 8 — cycle: A→B exists, then B→A rejected
  it("addEdge rejects a cycle-creating edge with CYCLE", async () => {
    db._edges.push({ parentTagId: "A", childTagId: "B" });
    // addEdge(B, A): cycle check asks for descendants of A → {B},
    // which contains the proposed parent (B), so → CYCLE.
    const res = await addEdge(db as unknown as never, "B", "A");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("CYCLE");
    expect(db._edges).toEqual([{ parentTagId: "A", childTagId: "B" }]);
  });

  // Case 9 — duplicate edge → DUPLICATE_EDGE
  it("addEdge returns DUPLICATE_EDGE on unique violation", async () => {
    db._edges.push({ parentTagId: "A", childTagId: "B" });
    // descendants of B = {} → cycle check passes; insert hits unique constraint.
    const res = await addEdge(db as unknown as never, "A", "B");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("DUPLICATE_EDGE");
    expect(db._edges).toHaveLength(1);
  });

  // Case 10 — removeEdge works and is idempotent
  it("removeEdge deletes the edge and is idempotent", async () => {
    db._edges.push({ parentTagId: "A", childTagId: "B" });
    await removeEdge(db as unknown as never, "A", "B");
    expect(db._edges).toEqual([]);
    await expect(
      removeEdge(db as unknown as never, "A", "B"),
    ).resolves.toBeUndefined();
  });

  // Case 11 — pruneAncestorsFromSet: A→B→C, input [A,B,C] → [C]
  it("pruneAncestorsFromSet keeps only the most specific tags", async () => {
    db._edges.push(
      { parentTagId: "A", childTagId: "B" },
      { parentTagId: "B", childTagId: "C" },
    );
    const result = await pruneAncestorsFromSet(db as unknown as never, [
      "A",
      "B",
      "C",
    ]);
    expect(result).toEqual(["C"]);
  });

  // Case 12 — disjoint tags preserved
  it("pruneAncestorsFromSet preserves disjoint tags", async () => {
    // No edges — every tag has no descendants in the set.
    const result = await pruneAncestorsFromSet(db as unknown as never, [
      "X",
      "Y",
      "Z",
    ]);
    expect(result.sort()).toEqual(["X", "Y", "Z"]);
  });

  // Case 13 — expandWithAncestors: A→B→C, input [C] → [A,B,C]
  it("expandWithAncestors returns the tag plus all its ancestors", async () => {
    db._edges.push(
      { parentTagId: "A", childTagId: "B" },
      { parentTagId: "B", childTagId: "C" },
    );
    const result = await expandWithAncestors(db as unknown as never, ["C"]);
    expect(result.sort()).toEqual(["A", "B", "C"]);
  });

  // Case 14 — MAX_DEPTH guard: a 35-node chain caps at MAX_DEPTH ancestors
  it("getAncestors caps traversal at MAX_DEPTH", async () => {
    const ids = Array.from({ length: 35 }, (_, i) => `T${i}`);
    for (let i = 0; i < ids.length - 1; i++) {
      db._edges.push({ parentTagId: ids[i], childTagId: ids[i + 1] });
    }
    // T34 has 34 real ancestors but MAX_DEPTH=32 caps the traversal.
    const result = await getAncestors(db as unknown as never, "T34");
    expect(result.length).toBeLessThanOrEqual(MAX_DEPTH);
    expect(result.length).toBe(MAX_DEPTH);
  });
});

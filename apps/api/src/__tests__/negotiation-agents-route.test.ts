import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../middleware/auth.js";

// ─── Mock @haggle/db ────────────────────────────────────────────────
// Provide a column-shaped stub for `negotiationAgents` and identity-only
// implementations of the operators the route consults (eq, and, or, inArray).
// The fake db chain implements only `from / where / limit / returning`.

vi.mock("@haggle/db", () => {
  const col = (name: string) => ({ name });
  return {
    eq: (c: unknown, v: unknown) => ({ __op: "eq", c, v }),
    and: (...conds: unknown[]) => ({ __op: "and", conds }),
    or: (...conds: unknown[]) => ({ __op: "or", conds }),
    inArray: (c: unknown, vs: unknown[]) => ({ __op: "inArray", c, vs }),
    desc: (c: unknown) => ({ __op: "desc", c }),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      raw: strings.join("?"),
      values,
    }),
    negotiationAgents: {
      id: col("id"),
      name: col("name"),
      displayName: col("display_name"),
      description: col("description"),
      advisorSkillId: col("advisor_skill_id"),
      negotiationAgentConfig: col("negotiation_agent_config"),
      role: col("role"),
      isSystem: col("is_system"),
      userId: col("user_id"),
      createdAt: col("created_at"),
      updatedAt: col("updated_at"),
    },
  };
});

import { registerNegotiationAgentRoutes } from "../routes/negotiation-agents.js";

// ─── Fake db ────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

interface FakeDb {
  calls: Array<{ op: string; payload?: unknown }>;
  selectResults: Row[][];
  insertResults: Row[][];
  updateResults: Row[][];
  select: (...a: unknown[]) => unknown;
  insert: (...a: unknown[]) => unknown;
  update: (...a: unknown[]) => unknown;
  delete: (...a: unknown[]) => unknown;
}

function createFakeDb(): FakeDb {
  const db: FakeDb = {
    calls: [],
    selectResults: [],
    insertResults: [],
    updateResults: [],
    select: () => {},
    insert: () => {},
    update: () => {},
    delete: () => {},
  };

  db.select = () => {
    const rows = db.selectResults.shift() ?? [];
    db.calls.push({ op: "select" });
    type Chain = {
      from: (...a: unknown[]) => Chain;
      where: (cond: unknown) => Chain;
      limit: (n: number) => Chain;
      orderBy: (...cols: unknown[]) => Chain;
      then: (r: (v: Row[]) => unknown) => Promise<unknown>;
    };
    const chain: Chain = {
      from: () => chain,
      where: (cond) => {
        db.calls.push({ op: "select.where", payload: cond });
        return chain;
      },
      limit: (n) => {
        db.calls.push({ op: "select.limit", payload: n });
        return chain;
      },
      orderBy: (...cols) => {
        db.calls.push({ op: "select.orderBy", payload: cols });
        return chain;
      },
      // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock — production code awaits this query chain
      then: (r) => Promise.resolve(r(rows)),
    };
    return chain;
  };

  db.insert = () => {
    db.calls.push({ op: "insert" });
    const chain = {
      values: (payload: unknown) => {
        db.calls.push({ op: "insert.values", payload });
        return {
          returning: () => Promise.resolve(db.insertResults.shift() ?? []),
        };
      },
    };
    return chain;
  };

  db.update = () => {
    db.calls.push({ op: "update" });
    const chain = {
      set: (payload: unknown) => {
        db.calls.push({ op: "update.set", payload });
        return {
          where: (cond: unknown) => {
            db.calls.push({ op: "update.where", payload: cond });
            return {
              returning: () => Promise.resolve(db.updateResults.shift() ?? []),
            };
          },
        };
      },
    };
    return chain;
  };

  db.delete = () => {
    db.calls.push({ op: "delete" });
    return {
      where: (cond: unknown) => {
        db.calls.push({ op: "delete.where", payload: cond });
        return Promise.resolve(undefined);
      },
    };
  };

  return db;
}

const asDb = (db: FakeDb) => db as unknown as import("@haggle/db").Database;

function buildApp(db: FakeDb, user?: AuthUser) {
  const app = Fastify();
  app.decorateRequest("user", undefined);
  app.addHook("onRequest", async (request) => {
    request.user = user;
  });
  registerNegotiationAgentRoutes(app, asDb(db));
  return app;
}

const USER: AuthUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "u@h.test",
  role: "user",
};

const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";

function agentRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "My Hunter",
    displayName: "My Hunter",
    description: null,
    advisorSkillId: "negotiation-agent-builder-v1",
    negotiationAgentConfig: { negotiationAgentPresetId: "hunter" },
    role: "seller",
    isSystem: false,
    userId: USER.id,
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:00:00.000Z",
    ...overrides,
  };
}

let db: FakeDb;
beforeEach(() => {
  db = createFakeDb();
});

// ─── CRUD ───────────────────────────────────────────────────────────

describe("POST /negotiations/agents", () => {
  it("requires auth", async () => {
    const app = buildApp(db);
    const res = await app.inject({
      method: "POST",
      url: "/negotiations/agents",
      payload: { name: "X" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("rejects body without name", async () => {
    const app = buildApp(db, USER);
    const res = await app.inject({
      method: "POST",
      url: "/negotiations/agents",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_AGENT");
    await app.close();
  });

  it("inserts the agent owned by the authenticated user", async () => {
    const app = buildApp(db, USER);
    db.insertResults.push([agentRow()]);
    const res = await app.inject({
      method: "POST",
      url: "/negotiations/agents",
      payload: {
        name: "My Hunter",
        role: "seller",
        config: { negotiationAgentPresetId: "hunter" },
      },
    });
    expect(res.statusCode).toBe(201);
    const insertValuesCall = db.calls.find((c) => c.op === "insert.values");
    expect(insertValuesCall).toBeTruthy();
    const payload = insertValuesCall!.payload as Row;
    expect(payload.userId).toBe(USER.id);
    expect(payload.isSystem).toBe(false);
    expect(payload.role).toBe("seller");
    expect(payload.name).toBe("My Hunter");
    expect(payload.displayName).toBe("My Hunter");
    expect(payload.advisorSkillId).toBe("negotiation-agent-builder-v1");
    expect(res.json().agent.id).toBe(agentRow().id);
    await app.close();
  });

  it("defaults role to 'both' when omitted", async () => {
    const app = buildApp(db, USER);
    db.insertResults.push([agentRow({ role: "both" })]);
    const res = await app.inject({
      method: "POST",
      url: "/negotiations/agents",
      payload: { name: "Generic" },
    });
    expect(res.statusCode).toBe(201);
    const payload = db.calls.find((c) => c.op === "insert.values")!.payload as Row;
    expect(payload.role).toBe("both");
    await app.close();
  });
});

describe("GET /negotiations/agents", () => {
  it("requires auth", async () => {
    const app = buildApp(db);
    const res = await app.inject({ method: "GET", url: "/negotiations/agents" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("returns system presets + user's customs unfiltered when role=any", async () => {
    const app = buildApp(db, USER);
    db.selectResults.push([
      agentRow({ id: "sys-1", isSystem: true, userId: null, role: "both" }),
      agentRow({ id: "own-1", isSystem: false, userId: USER.id, role: "seller" }),
    ]);
    const res = await app.inject({
      method: "GET",
      url: "/negotiations/agents?role=any",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().agents).toHaveLength(2);
    // Should not narrow on role.
    const whereCall = db.calls.find((c) => c.op === "select.where");
    const cond = whereCall!.payload as { __op: string };
    expect(cond.__op).toBe("or");
    await app.close();
  });

  it("narrows by role when role=seller", async () => {
    const app = buildApp(db, USER);
    db.selectResults.push([agentRow({ role: "seller" })]);
    const res = await app.inject({
      method: "GET",
      url: "/negotiations/agents?role=seller",
    });
    expect(res.statusCode).toBe(200);
    const whereCall = db.calls.find((c) => c.op === "select.where");
    const cond = whereCall!.payload as { __op: string; conds: unknown[] };
    expect(cond.__op).toBe("and");
    // Second leaf should be inArray over ["seller", "both"].
    const inArrayLeaf = cond.conds[1] as { __op: string; vs: string[] };
    expect(inArrayLeaf.__op).toBe("inArray");
    expect(inArrayLeaf.vs).toEqual(["seller", "both"]);
    await app.close();
  });

  it("asks the database for most-recently-updated first", async () => {
    // Without an ORDER BY the rows arrived in physical order, so editing an
    // agent could silently move it in the roster. createdAt is the tiebreaker
    // so rows written in the same millisecond keep a stable order.
    const app = buildApp(db, USER);
    db.selectResults.push([]);
    await app.inject({ method: "GET", url: "/negotiations/agents?role=any" });
    const order = db.calls.find((c) => c.op === "select.orderBy");
    expect(order).toBeDefined();
    expect(order?.payload).toEqual([
      { __op: "desc", c: { name: "updated_at" } },
      { __op: "desc", c: { name: "created_at" } },
    ]);
    await app.close();
  });

  it("rejects an invalid role value", async () => {
    const app = buildApp(db, USER);
    const res = await app.inject({
      method: "GET",
      url: "/negotiations/agents?role=garbage",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_QUERY");
    await app.close();
  });
});

describe("GET /negotiations/agents/:id", () => {
  it("returns 404 when missing", async () => {
    const app = buildApp(db, USER);
    db.selectResults.push([]);
    const res = await app.inject({
      method: "GET",
      url: "/negotiations/agents/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 403 when fetching another user's custom agent", async () => {
    const app = buildApp(db, USER);
    db.selectResults.push([agentRow({ isSystem: false, userId: OTHER_USER_ID })]);
    const res = await app.inject({
      method: "GET",
      url: "/negotiations/agents/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("allows reading system presets even when userId mismatches", async () => {
    const app = buildApp(db, USER);
    db.selectResults.push([agentRow({ isSystem: true, userId: null })]);
    const res = await app.inject({
      method: "GET",
      url: "/negotiations/agents/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe("PATCH /negotiations/agents/:id", () => {
  it("returns 403 for system presets", async () => {
    const app = buildApp(db, USER);
    db.selectResults.push([agentRow({ isSystem: true, userId: null })]);
    const res = await app.inject({
      method: "PATCH",
      url: "/negotiations/agents/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      payload: { name: "tampered" },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("updates name + displayName + role together", async () => {
    const app = buildApp(db, USER);
    db.selectResults.push([agentRow()]);
    db.updateResults.push([agentRow({ name: "Renamed", role: "both" })]);
    const res = await app.inject({
      method: "PATCH",
      url: "/negotiations/agents/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      payload: { name: "Renamed", role: "both" },
    });
    expect(res.statusCode).toBe(200);
    const setPayload = db.calls.find((c) => c.op === "update.set")!.payload as Row;
    expect(setPayload.name).toBe("Renamed");
    expect(setPayload.displayName).toBe("Renamed");
    expect(setPayload.role).toBe("both");
    expect(setPayload.updatedAt).toBeInstanceOf(Date);
    await app.close();
  });
});

describe("DELETE /negotiations/agents/:id", () => {
  it("returns 404 when missing", async () => {
    const app = buildApp(db, USER);
    db.selectResults.push([]);
    const res = await app.inject({
      method: "DELETE",
      url: "/negotiations/agents/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 403 for another user's agent", async () => {
    const app = buildApp(db, USER);
    db.selectResults.push([agentRow({ isSystem: false, userId: OTHER_USER_ID })]);
    const res = await app.inject({
      method: "DELETE",
      url: "/negotiations/agents/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("returns 204 when the owner deletes their own agent", async () => {
    const app = buildApp(db, USER);
    db.selectResults.push([agentRow()]);
    const res = await app.inject({
      method: "DELETE",
      url: "/negotiations/agents/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(res.statusCode).toBe(204);
    expect(db.calls.some((c) => c.op === "delete.where")).toBe(true);
    await app.close();
  });
});

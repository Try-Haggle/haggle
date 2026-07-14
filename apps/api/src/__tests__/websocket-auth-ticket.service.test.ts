import { describe, expect, it, vi } from "vitest";
import type { Database } from "@haggle/db";
import {
  consumeWebSocketAuthTicket,
  extractWebSocketTicketProtocol,
  getWebSocketTicketPolicyStatus,
  issueWebSocketAuthTicket,
} from "../services/websocket-auth-ticket.service.js";

function mockDb(executeResults: unknown[][]) {
  const execute = vi.fn().mockImplementation(async () => executeResults.shift() ?? []);
  const tx = { execute };
  const transaction = vi.fn(async (fn: (input: typeof tx) => unknown) => fn(tx));
  return { execute, transaction } as unknown as Database & {
    execute: typeof execute;
    transaction: typeof transaction;
  };
}

describe("WebSocket one-time auth tickets", () => {
  it("parses only one exact ticket subprotocol", () => {
    const raw = "a".repeat(43);
    expect(extractWebSocketTicketProtocol(`haggle-ticket.${raw}`)).toBe(raw);
    expect(extractWebSocketTicketProtocol(`haggle-ticket.${raw}, other`)).toBeNull();
    expect(extractWebSocketTicketProtocol(`haggle-ticket.${"a".repeat(42)}`)).toBeNull();
    expect(extractWebSocketTicketProtocol("bearer.secret")).toBeNull();
    expect(extractWebSocketTicketProtocol(undefined)).toBeNull();
  });

  it("issues a notification ticket with a bounded lifetime and no DB raw token", async () => {
    const expiresAt = new Date(Date.now() + 30_000);
    const db = mockDb([[], [], [], [{ expires_at: expiresAt }]]);
    const issued = await issueWebSocketAuthTicket(db, {
      userId: "00000000-0000-4000-a000-000000000010",
      channel: "notification",
    });
    expect(issued).toMatchObject({ expiresInSeconds: 30 });
    expect(issued?.protocol).toMatch(/^haggle-ticket\.[A-Za-z0-9_-]{43}$/);
    expect(db.transaction).toHaveBeenCalledOnce();
  });

  it("requires negotiation participation before issuing a scoped ticket", async () => {
    const deniedDb = mockDb([[]]);
    await expect(issueWebSocketAuthTicket(deniedDb, {
      userId: "00000000-0000-4000-a000-000000000010",
      channel: "negotiation",
      resourceId: "11111111-1111-4111-8111-111111111111",
    })).resolves.toBeNull();

    const allowedDb = mockDb([[{ authorized: true }], [], [], [],
      [{ expires_at: new Date(Date.now() + 30_000) }]]);
    await expect(issueWebSocketAuthTicket(allowedDb, {
      userId: "00000000-0000-4000-a000-000000000010",
      channel: "negotiation",
      resourceId: "11111111-1111-4111-8111-111111111111",
    })).resolves.toMatchObject({ expiresInSeconds: 30 });
  });

  it("returns a principal only for one matching atomic consume", async () => {
    const ticket = "b".repeat(43);
    const db = mockDb([[{ user_id: "00000000-0000-4000-a000-000000000010" }], []]);
    await expect(consumeWebSocketAuthTicket(db, {
      ticket,
      channel: "notification",
    })).resolves.toEqual({ userId: "00000000-0000-4000-a000-000000000010" });
    await expect(consumeWebSocketAuthTicket(db, {
      ticket,
      channel: "notification",
    })).resolves.toBeNull();
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed and scope-inconsistent consumes before the database", async () => {
    const db = mockDb([]);
    await expect(consumeWebSocketAuthTicket(db, { ticket: "short", channel: "notification" })).resolves.toBeNull();
    await expect(consumeWebSocketAuthTicket(db, {
      ticket: "c".repeat(43), channel: "negotiation",
    })).resolves.toBeNull();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("publishes an aggregate policy without tickets, hashes, or users", () => {
    expect(getWebSocketTicketPolicyStatus()).toEqual({
      transport: "sec-websocket-protocol",
      accessTokenInUrl: false,
      ttlSeconds: 30,
      singleUse: true,
      storage: "postgres",
      storedValue: "sha256",
      channelBound: true,
      resourceBound: true,
      oneActivePerScope: true,
      supersedesUnconsumed: true,
      browserOriginAllowlist: true,
      originRequired: false,
      rejectedOriginConsumesTicket: false,
      cleanupBatch: 100,
      containsTicket: false,
      containsHash: false,
      containsUserId: false,
    });
  });
});

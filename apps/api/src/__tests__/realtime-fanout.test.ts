/**
 * Realtime fan-out adapter (Postgres LISTEN/NOTIFY).
 *
 * Covers the parts that decide whether an event reaches a socket on another
 * instance: envelope encode/decode, self-echo suppression, the NOTIFY size cap,
 * and the local-only fallback when DATABASE_LISTEN_URL is absent.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetRealtimeFanoutForTests,
  closeRealtimeFanout,
  decodeEnvelope,
  encodeEnvelope,
  getRealtimeFanoutStatus,
  initRealtimeFanout,
  NOTIFY_PAYLOAD_MAX_BYTES,
  publishRealtime,
  type RealtimeEnvelope,
} from "../realtime/fanout.js";

const listenMock = vi.fn();
const closeMock = vi.fn();

vi.mock("@haggle/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createPgListener: () => ({ listen: listenMock, close: closeMock }),
  };
});

function fakeDb(execute: (query: unknown) => Promise<unknown> = async () => undefined) {
  return { execute: vi.fn(execute) } as unknown as Parameters<typeof initRealtimeFanout>[0]["db"];
}

const silentLog = { warn: vi.fn() };

beforeEach(() => {
  __resetRealtimeFanoutForTests();
  listenMock.mockReset();
  closeMock.mockReset();
  closeMock.mockResolvedValue(undefined);
  silentLog.warn.mockReset();
});

describe("envelope wire format", () => {
  const envelope: RealtimeEnvelope = {
    target: { kind: "user", userIds: ["u1", "u2"] },
    event: { type: "message.new", conversationId: "c1" },
  };

  it("round-trips a user-addressed envelope from another instance", () => {
    const decoded = decodeEnvelope(encodeEnvelope(envelope, "other-instance"), "self");
    expect(decoded).toEqual(envelope);
  });

  it("drops the publisher's own echo so it is not delivered twice", () => {
    expect(decodeEnvelope(encodeEnvelope(envelope, "self"), "self")).toBeNull();
  });

  it("rejects malformed, unversioned, and unknown-target payloads", () => {
    expect(decodeEnvelope("not json", "self")).toBeNull();
    expect(decodeEnvelope(JSON.stringify({ v: 2, origin: "o", ...envelope }), "self")).toBeNull();
    expect(
      decodeEnvelope(
        JSON.stringify({ v: 1, origin: "o", target: { kind: "room", id: "x" }, event: {} }),
        "self",
      ),
    ).toBeNull();
    expect(
      decodeEnvelope(
        JSON.stringify({ v: 1, origin: "o", target: { kind: "user", userIds: [7] }, event: {} }),
        "self",
      ),
    ).toBeNull();
  });

  it("round-trips a session-addressed envelope", () => {
    const sessionEnvelope: RealtimeEnvelope = {
      target: { kind: "session", sessionId: "s1" },
      event: { type: "round_update" },
    };
    expect(decodeEnvelope(encodeEnvelope(sessionEnvelope, "other"), "self")).toEqual(
      sessionEnvelope,
    );
  });
});

describe("initRealtimeFanout", () => {
  it("falls back to local-only delivery when DATABASE_LISTEN_URL is unset", async () => {
    await initRealtimeFanout({
      db: fakeDb(),
      deliver: vi.fn(),
      listenUrl: undefined,
      log: silentLog,
    });

    expect(getRealtimeFanoutStatus().mode).toBe("local-only");
    expect(listenMock).not.toHaveBeenCalled();
    expect(silentLog.warn).toHaveBeenCalled();
  });

  it("listens on the realtime channel when given a session-mode url", async () => {
    listenMock.mockResolvedValue(undefined);
    await initRealtimeFanout({
      db: fakeDb(),
      deliver: vi.fn(),
      listenUrl: "postgresql://localhost:5432/postgres",
      log: silentLog,
    });

    expect(listenMock).toHaveBeenCalledWith("haggle_realtime", expect.any(Function));
    expect(getRealtimeFanoutStatus()).toMatchObject({ mode: "postgres", listening: true });
    await closeRealtimeFanout();
  });

  it("keeps serving locally when LISTEN fails", async () => {
    listenMock.mockRejectedValue(new Error("pooler does not support LISTEN"));
    await initRealtimeFanout({
      db: fakeDb(),
      deliver: vi.fn(),
      listenUrl: "postgresql://pooler:6543/postgres",
      log: silentLog,
    });

    expect(getRealtimeFanoutStatus().mode).toBe("local-only");
  });

  it("delivers envelopes received from another instance", async () => {
    const deliver = vi.fn();
    listenMock.mockResolvedValue(undefined);
    await initRealtimeFanout({
      db: fakeDb(),
      deliver,
      listenUrl: "postgresql://localhost:5432/postgres",
      log: silentLog,
    });

    const handler = listenMock.mock.calls[0][1] as (payload: string) => void;
    handler(
      encodeEnvelope(
        { target: { kind: "user", userIds: ["u1"] }, event: { type: "message.new" } },
        "other-instance",
      ),
    );

    expect(deliver).toHaveBeenCalledWith({
      target: { kind: "user", userIds: ["u1"] },
      event: { type: "message.new" },
    });
    await closeRealtimeFanout();
  });
});

describe("publishRealtime", () => {
  it("delivers locally and notifies the other instances", async () => {
    const deliver = vi.fn();
    const db = fakeDb();
    await initRealtimeFanout({ db, deliver, listenUrl: undefined, log: silentLog });

    publishRealtime({ target: { kind: "user", userIds: ["u1"] }, event: { type: "x" } });

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it("skips everything when no user is targeted", async () => {
    const deliver = vi.fn();
    const db = fakeDb();
    await initRealtimeFanout({ db, deliver, listenUrl: undefined, log: silentLog });

    publishRealtime({ target: { kind: "user", userIds: [] }, event: { type: "x" } });

    expect(deliver).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("still delivers locally when a socket send throws", async () => {
    const db = fakeDb();
    await initRealtimeFanout({
      db,
      deliver: () => {
        throw new Error("socket gone");
      },
      listenUrl: undefined,
      log: silentLog,
    });

    expect(() =>
      publishRealtime({ target: { kind: "user", userIds: ["u1"] }, event: { type: "x" } }),
    ).not.toThrow();
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it("does not NOTIFY payloads over the pg_notify limit", async () => {
    const deliver = vi.fn();
    const db = fakeDb();
    await initRealtimeFanout({ db, deliver, listenUrl: undefined, log: silentLog });

    publishRealtime({
      target: { kind: "user", userIds: ["u1"] },
      event: { type: "message.new", body: "x".repeat(NOTIFY_PAYLOAD_MAX_BYTES) },
    });

    expect(deliver).toHaveBeenCalledTimes(1); // local delivery still happens
    expect(db.execute).not.toHaveBeenCalled();
    expect(getRealtimeFanoutStatus().oversizedDropped).toBe(1);
  });

  it("never rejects when NOTIFY fails", async () => {
    const db = fakeDb(async () => {
      throw new Error("connection lost");
    });
    await initRealtimeFanout({ db, deliver: vi.fn(), listenUrl: undefined, log: silentLog });

    expect(() =>
      publishRealtime({ target: { kind: "user", userIds: ["u1"] }, event: { type: "x" } }),
    ).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    expect(silentLog.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "realtime_fanout_notify_failed" }),
      expect.any(String),
    );
  });
});

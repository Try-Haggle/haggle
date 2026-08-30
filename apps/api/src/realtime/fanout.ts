/**
 * Cross-instance realtime fan-out.
 *
 * Every realtime event in this API is addressed either to a set of users
 * (notifications, messaging) or to a negotiation session room. Sockets live in
 * the process that accepted them, so an event produced on instance A must reach
 * the sockets held by instance B.
 *
 * Transport: Postgres LISTEN/NOTIFY — no new infrastructure. Publishing uses
 * `pg_notify` on the normal pooled connection (it runs inside a transaction, so
 * the transaction-mode pooler is fine). Subscribing needs a *session* bound
 * connection, which the transaction pooler cannot give us, hence the separate
 * DATABASE_LISTEN_URL. Without it the process still works — it just only
 * reaches its own sockets, which is correct for a single instance.
 */

import { randomUUID } from "node:crypto";
import { createPgListener, type Database, type PgListener, sql } from "@haggle/db";

export const REALTIME_CHANNEL = "haggle_realtime";

/**
 * pg_notify payloads are capped at 8000 bytes. We stay well under it; producers
 * are expected to drop heavy fields (e.g. a long message body) and let the
 * client refetch instead. Oversized envelopes are still delivered locally.
 */
export const NOTIFY_PAYLOAD_MAX_BYTES = 7000;

export type RealtimeTarget =
  | { kind: "user"; userIds: string[] }
  | { kind: "session"; sessionId: string };

export interface RealtimeEnvelope {
  target: RealtimeTarget;
  event: Record<string, unknown>;
}

interface WireEnvelope extends RealtimeEnvelope {
  v: 1;
  /** Instance that published it — used to skip our own NOTIFY echo. */
  origin: string;
}

export type RealtimeDeliverer = (envelope: RealtimeEnvelope) => void;

export interface RealtimeFanoutStatus {
  instanceId: string;
  mode: "postgres" | "local-only";
  listening: boolean;
  /** Envelopes that exceeded the NOTIFY limit and were delivered locally only. */
  oversizedDropped: number;
}

// ─── Module state ─────────────────────────────────────────────────────────────

const INSTANCE_ID = randomUUID();

let deliverer: RealtimeDeliverer | null = null;
let database: Database | null = null;
let listener: PgListener | null = null;
let listening = false;
let oversizedDropped = 0;
let logger: { warn: (obj: unknown, msg: string) => void } | null = null;

// ─── Wire format ──────────────────────────────────────────────────────────────

export function encodeEnvelope(envelope: RealtimeEnvelope, origin: string = INSTANCE_ID): string {
  const wire: WireEnvelope = { v: 1, origin, ...envelope };
  return JSON.stringify(wire);
}

/** Returns null for anything malformed, foreign-versioned, or self-originated. */
export function decodeEnvelope(
  payload: string,
  selfOrigin: string = INSTANCE_ID,
): RealtimeEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const wire = parsed as Partial<WireEnvelope>;
  if (wire.v !== 1) return null;
  if (wire.origin === selfOrigin) return null; // already delivered locally
  if (!wire.event || typeof wire.event !== "object") return null;

  const target = wire.target;
  if (!target || typeof target !== "object") return null;
  if (target.kind === "user") {
    if (!Array.isArray(target.userIds) || target.userIds.some((id) => typeof id !== "string")) {
      return null;
    }
  } else if (target.kind === "session") {
    if (typeof target.sessionId !== "string") return null;
  } else {
    return null;
  }

  return { target, event: wire.event };
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * Where the listener should connect.
 *
 * Supabase's session and transaction poolers differ only by port — same host,
 * same credentials — so the session URL can be derived rather than configured.
 * That matters because the failure it prevents is invisible: `LISTEN` on the
 * transaction pooler (6543) receives nothing at all, and an environment that
 * forgot the variable would look healthy while cross-instance realtime was
 * silently dead.
 *
 * Anything that is not a 6543 pooler is used as-is: direct connections (local
 * development, `db.<ref>.supabase.co:5432`) support LISTEN already.
 */
export function resolveListenUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const explicit = env.DATABASE_LISTEN_URL?.trim();
  if (explicit) return explicit;

  const primary = env.DATABASE_URL?.trim();
  if (!primary) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(primary);
  } catch {
    return primary;
  }

  if (parsed.hostname.endsWith("pooler.supabase.com") && parsed.port === "6543") {
    parsed.port = "5432";
    return parsed.toString();
  }
  return primary;
}

export interface InitRealtimeFanoutOptions {
  db: Database;
  /** Delivers an envelope to sockets held by this process. */
  deliver: RealtimeDeliverer;
  /**
   * Session-mode connection string. Defaults to DATABASE_LISTEN_URL, or the
   * session-port form of DATABASE_URL — see resolveListenUrl.
   */
  listenUrl?: string | undefined;
  log?: { warn: (obj: unknown, msg: string) => void };
}

export async function initRealtimeFanout(options: InitRealtimeFanoutOptions): Promise<void> {
  deliverer = options.deliver;
  database = options.db;
  logger = options.log ?? null;
  oversizedDropped = 0;

  const url = "listenUrl" in options ? options.listenUrl : resolveListenUrl();
  if (!url) {
    logger?.warn(
      { event: "realtime_fanout_local_only", instanceId: INSTANCE_ID },
      "No database URL to listen on — realtime events reach this instance's sockets only.",
    );
    return;
  }

  try {
    listener = createPgListener(url);
    await listener.listen(REALTIME_CHANNEL, (payload) => {
      const envelope = decodeEnvelope(payload);
      if (envelope) deliverer?.(envelope);
    });
    listening = true;
  } catch (err) {
    listening = false;
    listener = null;
    logger?.warn(
      { event: "realtime_fanout_listen_failed", err: (err as Error).message },
      "Realtime LISTEN failed — falling back to local-only delivery",
    );
  }
}

export async function closeRealtimeFanout(): Promise<void> {
  const current = listener;
  listener = null;
  listening = false;
  deliverer = null;
  database = null;
  if (current) await current.close().catch(() => {});
}

export function getRealtimeFanoutStatus(): RealtimeFanoutStatus {
  return {
    instanceId: INSTANCE_ID,
    mode: listening ? "postgres" : "local-only",
    listening,
    oversizedDropped,
  };
}

// ─── Publishing ───────────────────────────────────────────────────────────────

/**
 * Deliver locally, then fan out to the other instances.
 *
 * Fire-and-forget by design: a realtime event is never worth failing the write
 * that produced it, and clients reconcile on reconnect.
 */
export function publishRealtime(envelope: RealtimeEnvelope): void {
  if (envelope.target.kind === "user" && envelope.target.userIds.length === 0) return;

  try {
    deliverer?.(envelope);
  } catch {
    // A broken socket must not stop the fan-out.
  }

  const db = database;
  if (!db) return;

  const payload = encodeEnvelope(envelope);
  if (Buffer.byteLength(payload, "utf8") > NOTIFY_PAYLOAD_MAX_BYTES) {
    oversizedDropped += 1;
    logger?.warn(
      { event: "realtime_fanout_payload_too_large", type: envelope.event.type },
      "Realtime envelope exceeded the NOTIFY limit — delivered locally only",
    );
    return;
  }

  void db
    .execute(sql`SELECT pg_notify(${REALTIME_CHANNEL}, ${payload})`)
    .then(undefined, (err: Error) => {
      logger?.warn(
        { event: "realtime_fanout_notify_failed", err: err.message },
        "Realtime NOTIFY failed",
      );
    });
}

/** Test seam: resets module state between test cases. */
export function __resetRealtimeFanoutForTests(): void {
  deliverer = null;
  database = null;
  listener = null;
  listening = false;
  oversizedDropped = 0;
  logger = null;
}

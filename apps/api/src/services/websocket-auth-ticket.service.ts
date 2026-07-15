import { createHash, randomBytes } from "node:crypto";
import { type Database, sql } from "@haggle/db";

export type WebSocketTicketChannel = "negotiation" | "notification";

export interface IssuedWebSocketTicket {
  protocol: string;
  expiresAt: string;
  expiresInSeconds: 30;
}

export interface ConsumedWebSocketTicket {
  userId: string;
}

const TICKET_BYTES = 32;
const TICKET_TTL_SECONDS = 30;
const TICKET_PROTOCOL_PREFIX = "haggle-ticket.";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function hashTicket(ticket: string): string {
  return createHash("sha256").update(ticket, "utf8").digest("hex");
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown[] } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

export function extractWebSocketTicketProtocol(raw: string | string[] | undefined): string | null {
  if (typeof raw !== "string" || raw.length > 128 || raw.includes(",")) return null;
  if (!raw.startsWith(TICKET_PROTOCOL_PREFIX)) return null;
  const ticket = raw.slice(TICKET_PROTOCOL_PREFIX.length);
  return TOKEN_PATTERN.test(ticket) ? ticket : null;
}

export async function issueWebSocketAuthTicket(
  db: Database,
  input: { userId: string; channel: WebSocketTicketChannel; resourceId?: string },
): Promise<IssuedWebSocketTicket | null> {
  const ticket = randomBytes(TICKET_BYTES).toString("base64url");
  const tokenHash = hashTicket(ticket);

  return db.transaction(async (tx) => {
    if (input.channel === "negotiation") {
      if (!input.resourceId) return null;
      const participants = rowsOf<{ authorized: boolean }>(
        await tx.execute(sql`
        SELECT true AS authorized
        FROM negotiation_sessions
        WHERE id = ${input.resourceId}::uuid
          AND (${input.userId}::uuid = buyer_id OR ${input.userId}::uuid = seller_id)
        LIMIT 1
      `),
      );
      if (participants.length !== 1) return null;
    } else if (input.resourceId !== undefined) {
      return null;
    }

    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended(concat_ws(
        ':', 'haggle:websocket-ticket-issue:v1', ${input.userId}::uuid::text,
        ${input.channel}::text,
        coalesce(${input.resourceId ?? null}::uuid::text, '-')
      ), 0))
    `);
    await tx.execute(sql`
      DELETE FROM websocket_auth_tickets
      WHERE user_id = ${input.userId}::uuid
        AND channel = ${input.channel}
        AND resource_id IS NOT DISTINCT FROM ${input.resourceId ?? null}::uuid
    `);

    await tx.execute(sql`
      WITH expired AS (
        SELECT id FROM websocket_auth_tickets
        WHERE expires_at <= now()
        ORDER BY expires_at ASC, id ASC
        LIMIT 100
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM websocket_auth_tickets ticket
      USING expired
      WHERE ticket.id = expired.id
    `);
    const inserted = rowsOf<{ expires_at: Date | string }>(
      await tx.execute(sql`
      INSERT INTO websocket_auth_tickets
        (token_hash, user_id, channel, resource_id, expires_at)
      VALUES (
        ${tokenHash}, ${input.userId}::uuid, ${input.channel},
        ${input.resourceId ?? null}::uuid,
        now() + interval '30 seconds'
      )
      RETURNING expires_at
    `),
    );
    if (inserted.length !== 1) throw new Error("WEBSOCKET_TICKET_NOT_CREATED");
    return {
      protocol: `${TICKET_PROTOCOL_PREFIX}${ticket}`,
      expiresAt: new Date(inserted[0].expires_at).toISOString(),
      expiresInSeconds: TICKET_TTL_SECONDS,
    };
  });
}

export async function consumeWebSocketAuthTicket(
  db: Database,
  input: { ticket: string; channel: WebSocketTicketChannel; resourceId?: string },
): Promise<ConsumedWebSocketTicket | null> {
  if (!TOKEN_PATTERN.test(input.ticket)) return null;
  if ((input.channel === "negotiation") !== Boolean(input.resourceId)) return null;
  const tokenHash = hashTicket(input.ticket);
  const consumed = rowsOf<{ user_id: string }>(
    await db.execute(sql`
    DELETE FROM websocket_auth_tickets
    WHERE token_hash = ${tokenHash}
      AND channel = ${input.channel}
      AND resource_id IS NOT DISTINCT FROM ${input.resourceId ?? null}::uuid
      AND expires_at > now()
    RETURNING user_id
  `),
  );
  return consumed.length === 1 ? { userId: consumed[0].user_id } : null;
}

export function getWebSocketTicketPolicyStatus() {
  return {
    transport: "sec-websocket-protocol",
    accessTokenInUrl: false,
    ttlSeconds: TICKET_TTL_SECONDS,
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
  } as const;
}

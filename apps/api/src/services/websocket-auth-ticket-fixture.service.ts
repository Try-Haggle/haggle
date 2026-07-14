import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql, type Database } from "@haggle/db";
import {
  consumeWebSocketAuthTicket,
  extractWebSocketTicketProtocol,
  issueWebSocketAuthTicket,
} from "./websocket-auth-ticket.service.js";

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown[] } | null)?.rows;
  return Array.isArray(rows) ? rows as T[] : [];
}

export async function runWebSocketAuthTicketFixture(db: Database) {
  const userId = randomUUID();
  let cleanupRows = -1;
  try {
    const first = await issueWebSocketAuthTicket(db, { userId, channel: "notification" });
    const firstTicket = first && extractWebSocketTicketProtocol(first.protocol);
    if (!firstTicket) throw new Error("fixture ticket was not issued");
    const stored = rowsOf<{ token_hash: string }>(await db.execute(sql`
      SELECT token_hash FROM websocket_auth_tickets WHERE user_id = ${userId}::uuid
    `));
    const consumers = await Promise.all(Array.from({ length: 20 }, () =>
      consumeWebSocketAuthTicket(db, { ticket: firstTicket, channel: "notification" })));
    const consumed = consumers.filter(Boolean).length;
    const replay = await consumeWebSocketAuthTicket(db, {
      ticket: firstTicket,
      channel: "notification",
    });

    const second = await issueWebSocketAuthTicket(db, { userId, channel: "notification" });
    const secondTicket = second && extractWebSocketTicketProtocol(second.protocol);
    if (!secondTicket) throw new Error("fixture channel ticket was not issued");
    const wrongChannel = await consumeWebSocketAuthTicket(db, {
      ticket: secondTicket,
      channel: "negotiation",
      resourceId: randomUUID(),
    });
    const correctChannel = await consumeWebSocketAuthTicket(db, {
      ticket: secondTicket,
      channel: "notification",
    });

    const parallelIssued = await Promise.all(Array.from({ length: 20 }, () =>
      issueWebSocketAuthTicket(db, { userId, channel: "notification" })));
    const parallelTickets = parallelIssued.map((issued) =>
      issued && extractWebSocketTicketProtocol(issued.protocol));
    if (parallelTickets.some((ticket) => !ticket)) {
      throw new Error("fixture concurrent ticket was not issued");
    }
    const activeScopeRows = rowsOf<{ count: string }>(await db.execute(sql`
      SELECT count(*)::text AS count FROM websocket_auth_tickets
      WHERE user_id = ${userId}::uuid
        AND channel = 'notification'
        AND resource_id IS NULL
        AND expires_at > now()
    `));
    const parallelConsumes = await Promise.all(parallelTickets.map((ticket) =>
      consumeWebSocketAuthTicket(db, {
        ticket: ticket!, channel: "notification",
      })));
    const acceptedSupersessionTickets = parallelConsumes.filter(Boolean).length;

    const expiredRaw = randomBytes(32).toString("base64url");
    const expiredHash = createHash("sha256").update(expiredRaw).digest("hex");
    await db.execute(sql`
      INSERT INTO websocket_auth_tickets
        (token_hash, user_id, channel, resource_id, created_at, expires_at)
      VALUES (
        ${expiredHash}, ${userId}::uuid, 'notification', NULL,
        now() - interval '31 seconds', now() - interval '1 second'
      )
    `);
    const third = await issueWebSocketAuthTicket(db, { userId, channel: "notification" });
    const thirdTicket = third && extractWebSocketTicketProtocol(third.protocol);
    if (!thirdTicket) throw new Error("fixture cleanup ticket was not issued");
    const expiredRemaining = rowsOf<{ count: string }>(await db.execute(sql`
      SELECT count(*)::text AS count FROM websocket_auth_tickets
      WHERE token_hash = ${expiredHash}
    `));
    await consumeWebSocketAuthTicket(db, { ticket: thirdTicket, channel: "notification" });
    const finalRows = rowsOf<{ count: string }>(await db.execute(sql`
      SELECT count(*)::text AS count FROM websocket_auth_tickets
      WHERE user_id = ${userId}::uuid
    `));
    cleanupRows = Number(finalRows[0]?.count ?? -1);

    return {
      schemaVersion: "websocket-auth-ticket-fixture-v1",
      concurrentConsumers: 20,
      successfulConsumers: consumed,
      blockedConsumers: 20 - consumed,
      replayBlocked: replay === null,
      wrongChannelBlocked: wrongChannel === null,
      correctChannelAccepted: correctChannel?.userId === userId,
      concurrentIssuers: 20,
      activeScopeRows: Number(activeScopeRows[0]?.count ?? -1),
      acceptedSupersessionTickets,
      supersededTicketsBlocked: 20 - acceptedSupersessionTickets,
      storedRowsObserved: stored.length,
      storedHashesValid: stored.length === 1 && /^[0-9a-f]{64}$/.test(stored[0].token_hash),
      rawTicketStored: stored.some((row) => row.token_hash === firstTicket),
      expiredInserted: 1,
      expiredRemaining: Number(expiredRemaining[0]?.count ?? -1),
      cleanupRows,
      accessTokenInUrl: false,
      containsTicket: false,
      containsHash: false,
      containsUserId: false,
      externalCalls: 0,
    };
  } finally {
    await db.execute(sql`DELETE FROM websocket_auth_tickets WHERE user_id = ${userId}::uuid`);
  }
}

import type { FastifyInstance } from "fastify";
import { createHmac, timingSafeEqual } from "crypto";
import {
  type Database,
  notifications,
  notificationPreferences,
  emailDeliveries,
  eq,
  and,
  isNull,
  lt,
  sql,
  desc,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
} from "@haggle/db";
import { requireAuth } from "../middleware/require-auth.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeUnsubscribeToken(userId: string): string {
  const secret = process.env.NOTIFICATION_UNSUBSCRIBE_SECRET ?? "dev-secret";
  return createHmac("sha256", secret).update(userId).digest("hex");
}

function verifyUnsubscribeToken(userId: string, token: string): boolean {
  const expected = makeUnsubscribeToken(userId);
  try {
    return timingSafeEqual(Buffer.from(token, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

// ─── Route Registration ───────────────────────────────────────────────────────

export function registerNotificationRoutes(app: FastifyInstance, db: Database): void {

  // GET /api/notifications — cursor-based list (created_at DESC)
  app.get("/api/notifications", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.user!.id;
    const query = request.query as { cursor?: string; limit?: string };
    const limit = Math.min(Number.parseInt(query.limit ?? "20", 10), 50);

    let createdAtCursor: Date | undefined;
    let idCursor: string | undefined;
    if (query.cursor) {
      const sep = query.cursor.lastIndexOf("_");
      if (sep !== -1) {
        createdAtCursor = new Date(query.cursor.slice(0, sep));
        idCursor = query.cursor.slice(sep + 1);
      }
    }

    const rows = await db.query.notifications.findMany({
      where: (fields, ops) => {
        const base = ops.eq(fields.userId, userId);
        if (createdAtCursor && idCursor) {
          return ops.and(
            base,
            ops.or(
              ops.lt(fields.createdAt, createdAtCursor),
              ops.and(
                ops.eq(fields.createdAt, createdAtCursor),
                ops.lt(fields.id, idCursor),
              ),
            ),
          );
        }
        return base;
      },
      orderBy: (fields, { desc }) => [desc(fields.createdAt), desc(fields.id)],
      limit: limit + 1,
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore
      ? `${items[items.length - 1].createdAt.toISOString()}_${items[items.length - 1].id}`
      : null;

    return reply.send({ ok: true, notifications: items, nextCursor });
  });

  // GET /api/notifications/count — unread count for badge
  app.get("/api/notifications/count", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.user!.id;
    const [row] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return reply.send({ ok: true, count: row?.count ?? 0 });
  });

  // PATCH /api/notifications/:id/read — mark one as read
  app.patch<{ Params: { id: string } }>(
    "/api/notifications/:id/read",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userId = request.user!.id;
      const { id } = request.params;
      await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(and(eq(notifications.id, id), eq(notifications.userId, userId), isNull(notifications.readAt)));
      return reply.send({ ok: true });
    },
  );

  // PATCH /api/notifications/read-all — mark all as read
  app.patch("/api/notifications/read-all", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.user!.id;
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return reply.send({ ok: true });
  });

  // GET /api/notifications/preferences — get user preferences
  app.get("/api/notifications/preferences", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.user!.id;
    const prefs = await db.query.notificationPreferences.findMany({
      where: (fields, ops) => ops.eq(fields.userId, userId),
    });

    // Expand to full matrix: category × channel, absent rows = enabled (default ON)
    const matrix: Record<string, Record<string, boolean>> = {};
    for (const category of NOTIFICATION_CATEGORIES) {
      matrix[category] = {};
      for (const channel of NOTIFICATION_CHANNELS) {
        const found = prefs.find((p) => p.category === category && p.channel === channel);
        matrix[category][channel] = found ? found.enabled : true;
      }
    }
    return reply.send({ ok: true, preferences: matrix });
  });

  // PUT /api/notifications/preferences — update a preference
  app.put<{ Body: { category: string; channel: string; enabled: boolean } }>(
    "/api/notifications/preferences",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userId = request.user!.id;
      const { category, channel, enabled } = request.body;

      if (!NOTIFICATION_CATEGORIES.includes(category as never) || !NOTIFICATION_CHANNELS.includes(channel as never)) {
        return reply.status(400).send({ ok: false, error: "invalid_category_or_channel" });
      }

      await db
        .insert(notificationPreferences)
        .values({ userId, category: category as never, channel: channel as never, enabled })
        .onConflictDoUpdate({
          target: [notificationPreferences.userId, notificationPreferences.category, notificationPreferences.channel],
          set: { enabled, updatedAt: new Date() },
        });

      return reply.send({ ok: true });
    },
  );

  // GET /api/notifications/unsubscribe — one-click email unsubscribe
  app.get<{ Querystring: { userId?: string; token?: string } }>(
    "/api/notifications/unsubscribe",
    async (request, reply) => {
      const { userId, token } = request.query;
      if (!userId || !token || !verifyUnsubscribeToken(userId, token)) {
        return reply.status(400).send({ ok: false, error: "invalid_token" });
      }

      // Turn off all email channels across all categories
      for (const category of NOTIFICATION_CATEGORIES) {
        await db
          .insert(notificationPreferences)
          .values({ userId, category, channel: "email", enabled: false })
          .onConflictDoUpdate({
            target: [notificationPreferences.userId, notificationPreferences.category, notificationPreferences.channel],
            set: { enabled: false, updatedAt: new Date() },
          });
      }

      return reply.type("text/html").send(
        `<html><body style="font-family:sans-serif;text-align:center;padding:40px">
          <h2>Unsubscribed</h2>
          <p>You've been unsubscribed from all Haggle emails.</p>
          <p>You can re-enable notifications in <a href="${process.env.PUBLIC_APP_URL ?? "https://tryhaggle.ai"}/settings">Settings</a>.</p>
        </body></html>`,
      );
    },
  );
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@haggle/db";
import { eq, and, orderAddresses, userSavedAddresses, commerceOrders } from "@haggle/db";
import { requireAuth } from "../middleware/require-auth.js";
import { createOwnershipMiddleware } from "../middleware/ownership.js";
import { INPUT_LIMITS } from "../lib/input-limits.js";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const ZIP_RE = /^\d{5}$/;
const STATE_RE = /^[A-Z]{2}$/;

const orderAddressSchema = z.object({
  role: z.enum(["buyer", "seller"]),
  name: z.string().min(1, "name is required").max(INPUT_LIMITS.mediumTextChars),
  company: z.string().max(INPUT_LIMITS.mediumTextChars).optional(),
  street1: z.string().min(1, "street1 is required").max(INPUT_LIMITS.mediumTextChars),
  street2: z.string().max(INPUT_LIMITS.mediumTextChars).optional(),
  city: z.string().min(1, "city is required").max(INPUT_LIMITS.mediumTextChars),
  state: z.string().regex(STATE_RE, "state must be 2 uppercase letters"),
  zip: z.string().regex(ZIP_RE, "zip must be 5 digits"),
  country: z.string().default("US"),
  phone: z.string().max(32).optional(),
  email: z.string().email().optional(),
});

const savedAddressSchema = z.object({
  label: z.string().max(INPUT_LIMITS.shortTextChars).optional(),
  name: z.string().min(1, "name is required").max(INPUT_LIMITS.mediumTextChars),
  street1: z.string().min(1, "street1 is required").max(INPUT_LIMITS.mediumTextChars),
  street2: z.string().max(INPUT_LIMITS.mediumTextChars).optional(),
  city: z.string().min(1, "city is required").max(INPUT_LIMITS.mediumTextChars),
  state: z.string().regex(STATE_RE, "state must be 2 uppercase letters"),
  zip: z.string().regex(ZIP_RE, "zip must be 5 digits"),
  country: z.string().default("US"),
  phone: z.string().max(32).optional(),
  is_default: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Load a commerce order and verify the requesting user is buyer or seller. */
async function loadOrderWithOwnership(
  db: Database,
  orderId: string,
  userId: string,
): Promise<
  | { order: { id: string; buyerId: string; sellerId: string }; error: null }
  | { order: null; error: { code: number; body: { error: string } } }
> {
  const order = await db.query.commerceOrders.findFirst({
    where: (fields, ops) => ops.eq(fields.id, orderId),
  });
  if (!order) {
    return { order: null, error: { code: 404, body: { error: "ORDER_NOT_FOUND" } } };
  }
  if (order.buyerId !== userId && order.sellerId !== userId) {
    return { order: null, error: { code: 403, body: { error: "FORBIDDEN" } } };
  }
  return { order, error: null };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerAddressRoutes(app: FastifyInstance, db: Database) {
  const { requireOrderOwner } = createOwnershipMiddleware(db);

  // ─── POST /orders/:orderId/addresses ─────────────────────────────
  // Save (upsert) an address for an order.
  app.post<{ Params: { orderId: string } }>(
    "/orders/:orderId/addresses",
    { preHandler: [requireAuth, requireOrderOwner()] },
    async (request, reply) => {
      const parsed = orderAddressSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_ADDRESS", issues: parsed.error.issues });
      }

      const userId = request.user!.id;
      const { orderId } = request.params;

      // Order already verified by ownership middleware
      const order = (request as unknown as Record<string, unknown>).orderResource as
        { id: string; buyerId: string; sellerId: string };

      // Ownership check: buyer can only set buyer address, seller can only set seller address
      const userRole = order.buyerId === userId ? "buyer" : "seller";
      if (parsed.data.role !== userRole) {
        return reply.code(403).send({
          error: "ROLE_MISMATCH",
          message: `You are the ${userRole} of this order and can only set the ${userRole} address`,
        });
      }

      // Upsert: insert or update on conflict (order_id, role)
      const now = new Date();
      const values = {
        orderId,
        role: parsed.data.role,
        name: parsed.data.name,
        company: parsed.data.company ?? null,
        street1: parsed.data.street1,
        street2: parsed.data.street2 ?? null,
        city: parsed.data.city,
        state: parsed.data.state,
        zip: parsed.data.zip,
        country: parsed.data.country,
        phone: parsed.data.phone ?? null,
        email: parsed.data.email ?? null,
        updatedAt: now,
      };

      const [address] = await db
        .insert(orderAddresses)
        .values(values)
        .onConflictDoUpdate({
          target: [orderAddresses.orderId, orderAddresses.role],
          set: {
            name: values.name,
            company: values.company,
            street1: values.street1,
            street2: values.street2,
            city: values.city,
            state: values.state,
            zip: values.zip,
            country: values.country,
            phone: values.phone,
            email: values.email,
            updatedAt: values.updatedAt,
          },
        })
        .returning();

      return reply.code(201).send({ address });
    },
  );

  // ─── GET /orders/:orderId/addresses ──────────────────────────────
  // Get addresses for an order.
  app.get<{ Params: { orderId: string } }>(
    "/orders/:orderId/addresses",
    { preHandler: [requireAuth, requireOrderOwner()] },
    async (request, reply) => {
      const { orderId } = request.params;

      const rows = await db
        .select()
        .from(orderAddresses)
        .where(eq(orderAddresses.orderId, orderId));

      const result: Record<string, typeof rows[number]> = {};
      for (const row of rows) {
        result[row.role] = row;
      }

      return reply.send(result);
    },
  );

  // ─── GET /users/me/addresses ─────────────────────────────────────
  // Get user's saved address book.
  app.get(
    "/users/me/addresses",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userId = request.user!.id;

      const addresses = await db
        .select()
        .from(userSavedAddresses)
        .where(eq(userSavedAddresses.userId, userId));

      return reply.send({ addresses });
    },
  );

  // ─── POST /users/me/addresses ────────────────────────────────────
  // Add to address book.
  app.post(
    "/users/me/addresses",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const parsed = savedAddressSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_ADDRESS", issues: parsed.error.issues });
      }

      const userId = request.user!.id;

      // If is_default=true, unset other defaults first
      if (parsed.data.is_default) {
        await db
          .update(userSavedAddresses)
          .set({ isDefault: false })
          .where(
            and(
              eq(userSavedAddresses.userId, userId),
              eq(userSavedAddresses.isDefault, true),
            ),
          );
      }

      const [address] = await db
        .insert(userSavedAddresses)
        .values({
          userId,
          label: parsed.data.label ?? "home",
          name: parsed.data.name,
          street1: parsed.data.street1,
          street2: parsed.data.street2 ?? null,
          city: parsed.data.city,
          state: parsed.data.state,
          zip: parsed.data.zip,
          country: parsed.data.country,
          phone: parsed.data.phone ?? null,
          isDefault: parsed.data.is_default ?? false,
        })
        .returning();

      return reply.code(201).send({ address });
    },
  );

  // ─── PUT /users/me/addresses/:id ─────────────────────────────────
  // Update saved address.
  app.put<{ Params: { id: string } }>(
    "/users/me/addresses/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const parsed = savedAddressSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_ADDRESS", issues: parsed.error.issues });
      }

      const userId = request.user!.id;
      const { id } = request.params;

      // Ownership check
      const existing = await db.query.userSavedAddresses.findFirst({
        where: (fields, ops) => ops.eq(fields.id, id),
      });
      if (!existing) {
        return reply.code(404).send({ error: "ADDRESS_NOT_FOUND" });
      }
      if (existing.userId !== userId) {
        return reply.code(403).send({ error: "FORBIDDEN" });
      }

      // If is_default=true, unset other defaults first
      if (parsed.data.is_default) {
        await db
          .update(userSavedAddresses)
          .set({ isDefault: false })
          .where(
            and(
              eq(userSavedAddresses.userId, userId),
              eq(userSavedAddresses.isDefault, true),
            ),
          );
      }

      const [address] = await db
        .update(userSavedAddresses)
        .set({
          label: parsed.data.label ?? existing.label,
          name: parsed.data.name,
          street1: parsed.data.street1,
          street2: parsed.data.street2 ?? null,
          city: parsed.data.city,
          state: parsed.data.state,
          zip: parsed.data.zip,
          country: parsed.data.country,
          phone: parsed.data.phone ?? null,
          isDefault: parsed.data.is_default ?? existing.isDefault,
        })
        .where(eq(userSavedAddresses.id, id))
        .returning();

      return reply.send({ address });
    },
  );

  // ─── DELETE /users/me/addresses/:id ──────────────────────────────
  // Delete saved address.
  app.delete<{ Params: { id: string } }>(
    "/users/me/addresses/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userId = request.user!.id;
      const { id } = request.params;

      // Ownership check
      const existing = await db.query.userSavedAddresses.findFirst({
        where: (fields, ops) => ops.eq(fields.id, id),
      });
      if (!existing) {
        return reply.code(404).send({ error: "ADDRESS_NOT_FOUND" });
      }
      if (existing.userId !== userId) {
        return reply.code(403).send({ error: "FORBIDDEN" });
      }

      await db
        .delete(userSavedAddresses)
        .where(eq(userSavedAddresses.id, id));

      return reply.code(204).send();
    },
  );
}

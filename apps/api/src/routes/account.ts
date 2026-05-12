import type { FastifyInstance } from "fastify";
import type { Database } from "@haggle/db";
import { createClient } from "@supabase/supabase-js";
import { listingDrafts, profiles, eq } from "@haggle/db";

function getSupabaseAdmin() {
  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable",
    );
  }

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * DELETE /api/account
 * Header: Authorization: Bearer <access_token>
 *
 * Deletes the authenticated user's account and associated data.
 */
export function registerAccountRoutes(app: FastifyInstance, db: Database) {
  app.delete("/api/account", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return reply
        .status(401)
        .send({ ok: false, error: "unauthorized" });
    }

    const token = authHeader.slice(7);
    const supabase = getSupabaseAdmin();

    // Verify the token and get the user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return reply
        .status(401)
        .send({ ok: false, error: "invalid_token" });
    }

    // Clean up user's data: unlink listings
    await db
      .update(listingDrafts)
      .set({ userId: null })
      .where(eq(listingDrafts.userId, user.id));

    // Delete user from Supabase Auth
    const { error: deleteError } =
      await supabase.auth.admin.deleteUser(user.id);

    if (deleteError) {
      return reply.status(500).send({
        ok: false,
        error: "delete_failed",
        message: deleteError.message,
      });
    }

    return reply.send({ ok: true });
  });

  // POST /me/profile — sync app-side profile mirror from Supabase auth metadata.
  // Called by /settings after auth.updateUser. Idempotent upsert.
  app.post("/me/profile", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return reply.status(401).send({ ok: false, error: "unauthorized" });
    }

    const token = authHeader.slice(7);
    const supabase = getSupabaseAdmin();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return reply.status(401).send({ ok: false, error: "invalid_token" });
    }

    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const displayName =
      typeof meta.display_name === "string" ? meta.display_name : null;
    const avatarUrl =
      typeof meta.custom_avatar_url === "string"
        ? meta.custom_avatar_url
        : typeof meta.avatar_url === "string"
          ? meta.avatar_url
          : null;
    const emailVerified = user.email_confirmed_at
      ? new Date(user.email_confirmed_at)
      : null;
    const joinedAt = user.created_at ? new Date(user.created_at) : new Date();

    const existing = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, user.id))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(profiles)
        .set({
          displayName,
          avatarUrl,
          emailVerified,
          updatedAt: new Date(),
        })
        .where(eq(profiles.userId, user.id));
    } else {
      await db.insert(profiles).values({
        userId: user.id,
        displayName,
        avatarUrl,
        emailVerified,
        joinedAt,
      });
    }

    return reply.send({ ok: true });
  });
}

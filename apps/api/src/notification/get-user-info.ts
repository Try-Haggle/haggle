import { type Database } from "@haggle/db";
import { sql } from "drizzle-orm";

interface UserInfo {
  email: string;
  displayName: string;
}

/**
 * Fetch email + display name from auth.users.
 * Display name: full_name (Google OAuth) → name → email prefix (fallback).
 */
export async function getNotificationUserInfo(
  db: Database,
  userId: string,
): Promise<UserInfo | null> {
  const rows = await db.execute<{ email: string; display_name: string }>(
    sql`SELECT email,
          COALESCE(
            raw_user_meta_data->>'full_name',
            raw_user_meta_data->>'name',
            split_part(email, '@', 1)
          ) AS display_name
        FROM auth.users
        WHERE id = ${userId}
        LIMIT 1`,
  );
  const row = (rows as { email: string; display_name: string }[])[0];
  if (!row?.email) return null;
  return { email: row.email, displayName: row.display_name };
}

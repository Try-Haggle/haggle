/**
 * The one rule for a person's name in the UI.
 *
 * It lives in Supabase `user_metadata` under different keys depending on how
 * it got there: `display_name` from sign-up and the settings page, and
 * `full_name` / `name` from Google. Reading those in different orders in
 * different places meant a name changed in settings still showed the old
 * Google name on the profile page — so every reader goes through here.
 */
export function getUserDisplayName(
  user: { user_metadata?: Record<string, unknown> | null } | null | undefined,
): string | null {
  const meta = user?.user_metadata;
  for (const key of ["display_name", "full_name", "name"]) {
    const value = meta?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

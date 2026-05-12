-- profiles: lightweight user profile mirror for trust card surfaces.
-- Source of truth for auth/email remains Supabase auth.users; this table holds
-- app-side display fields (name, avatar) and a captured joined_at so the API
-- can render trust cards without admin-level Supabase reads.

CREATE TABLE IF NOT EXISTS profiles (
  user_id UUID PRIMARY KEY,
  display_name TEXT,
  avatar_url TEXT,
  email_verified TIMESTAMPTZ,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

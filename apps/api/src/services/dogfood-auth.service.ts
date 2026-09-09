/**
 * Dogfood persona ensure + short-TTL web session mint (Eng1 T1).
 * SoT: docs/wip/dogfood-auth-sot.md
 *
 * Uses Supabase Admin generateLink + verifyOtp — NOT test_unverified JWTs.
 * Never log secrets or minted tokens.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  DOGFOOD_PERSONA_EMAILS,
  DOGFOOD_PERSONA_HANDLES,
  DOGFOOD_PERSONA_USER_IDS,
  type DogfoodPersona,
} from "../lib/dogfood-auth-gate.js";

export type DogfoodWebSession = {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  persona: DogfoodPersona;
  user_id: string;
  handle: "dogfood_buyer" | "dogfood_seller";
};

export type DogfoodAuthAdmin = Pick<SupabaseClient, "auth">;

let _adminForTest: DogfoodAuthAdmin | null = null;

/** Test-only hook — inject a mock admin client. Reset in afterEach. */
export function _setDogfoodAuthAdminForTest(client: DogfoodAuthAdmin | null): void {
  _adminForTest = client;
}

function getSupabaseAdmin(): DogfoodAuthAdmin {
  if (_adminForTest) return _adminForTest;
  const url = process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("DOGFOOD_AUTH_MISCONFIGURED");
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Ensure the fixed-UUID persona exists in Supabase Auth.
 * Idempotent across staging deploys.
 */
export async function ensureDogfoodPersonaUser(
  persona: DogfoodPersona,
  admin: DogfoodAuthAdmin = getSupabaseAdmin(),
): Promise<{ userId: string; email: string; handle: "dogfood_buyer" | "dogfood_seller" }> {
  const userId = DOGFOOD_PERSONA_USER_IDS[persona];
  const email = DOGFOOD_PERSONA_EMAILS[persona];
  const handle = DOGFOOD_PERSONA_HANDLES[persona];

  const { data: existing, error: getError } = await admin.auth.admin.getUserById(userId);
  if (getError && !/not\s*found|user not found/i.test(getError.message ?? "")) {
    throw new Error("DOGFOOD_PERSONA_LOOKUP_FAILED");
  }
  if (existing?.user) {
    return { userId, email: existing.user.email ?? email, handle };
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    id: userId,
    email,
    email_confirm: true,
    user_metadata: { handle, dogfood_persona: persona },
    app_metadata: { dogfood_persona: persona },
  });

  if (createError) {
    // Race / email already present — re-fetch by id.
    const { data: retry } = await admin.auth.admin.getUserById(userId);
    if (retry?.user) {
      return { userId, email: retry.user.email ?? email, handle };
    }
    throw new Error("DOGFOOD_PERSONA_ENSURE_FAILED");
  }

  if (!created?.user) {
    throw new Error("DOGFOOD_PERSONA_ENSURE_FAILED");
  }

  return { userId, email: created.user.email ?? email, handle };
}

/**
 * Mint a short-TTL Supabase session usable by web `setSession`.
 * Does not use or enable `test_unverified` JWT mode.
 */
export async function mintDogfoodWebSession(
  persona: DogfoodPersona,
  admin: DogfoodAuthAdmin = getSupabaseAdmin(),
): Promise<DogfoodWebSession> {
  const { userId, email, handle } = await ensureDogfoodPersonaUser(persona, admin);

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  const hashedToken = linkData?.properties?.hashed_token;
  if (linkError || typeof hashedToken !== "string" || hashedToken.length === 0) {
    throw new Error("DOGFOOD_SESSION_MINT_FAILED");
  }

  const { data: otpData, error: otpError } = await admin.auth.verifyOtp({
    type: "email",
    token_hash: hashedToken,
  });

  const session = otpData?.session;
  if (
    otpError ||
    !session?.access_token ||
    !session.refresh_token ||
    typeof session.access_token !== "string" ||
    typeof session.refresh_token !== "string"
  ) {
    throw new Error("DOGFOOD_SESSION_MINT_FAILED");
  }

  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: typeof session.expires_at === "number" ? session.expires_at : undefined,
    expires_in: typeof session.expires_in === "number" ? session.expires_in : undefined,
    persona,
    user_id: userId,
    handle,
  };
}

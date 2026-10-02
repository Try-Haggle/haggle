import { NextResponse } from "next/server";
import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

async function triggerSignedUpNotification(userId: string, createdAt: string) {
  // Only fire for brand-new users (created within last 60 seconds)
  // 5 minutes window — Google OAuth can take 1-2 min to complete
  const isNewUser = Date.now() - new Date(createdAt).getTime() < 300_000;
  if (!isNewUser) return;

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
  const apiKey = process.env.INTERNAL_API_KEY;
  if (!apiKey) return;

  await fetch(`${apiUrl}/api/internal/notifications/user-signed-up`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-haggle-internal-key": apiKey,
    },
    body: JSON.stringify({ userId, isNewUser: true }),
  }).catch((err) => {
    console.error("[auth/callback] failed to trigger user.signed_up notification:", err);
  });
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  // `next` is appended to our origin, so it must be a path on this site:
  // unchecked, "@evil.com" would turn "https://app" + next into a redirect to
  // evil.com straight after a successful sign-in.
  const requestedNext = safeNextPath(searchParams.get("next"));
  const next = requestedNext ?? "/sell/dashboard";

  const supabase = await createClient();

  // OAuth flow (Google) or email confirmation (PKCE)
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Notification is best-effort — never block redirect on failure
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) await triggerSignedUpNotification(user.id, user.created_at);
      } catch (err) {
        console.error("[auth/callback] notification error (non-fatal):", err);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Magic Link / OTP flow — verifies token hash
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as "signup" | "magiclink" | "email",
    });
    if (!error) {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) await triggerSignedUpNotification(user.id, user.created_at);
      } catch (err) {
        console.error("[auth/callback] notification error (non-fatal):", err);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Auth error — back to sign-in, which shows the error at the top of the form
  // (the home page only bounced to /sign-in and dropped it). Keep `next` so a
  // retry still lands where the person was going.
  const retry = new URLSearchParams({ error: "auth_failed" });
  if (requestedNext) retry.set("next", requestedNext);
  return NextResponse.redirect(`${origin}/sign-in?${retry}`);
}

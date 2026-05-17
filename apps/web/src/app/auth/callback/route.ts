import { NextResponse } from "next/server";
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
  const next = searchParams.get("next") ?? "/sell/dashboard";

  const supabase = await createClient();

  // OAuth flow (Google) or email confirmation (PKCE)
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Notification is best-effort — never block redirect on failure
      try {
        const { data: { user } } = await supabase.auth.getUser();
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
        const { data: { user } } = await supabase.auth.getUser();
        if (user) await triggerSignedUpNotification(user.id, user.created_at);
      } catch (err) {
        console.error("[auth/callback] notification error (non-fatal):", err);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Auth error — redirect to claim page with error
  return NextResponse.redirect(`${origin}/?error=auth_failed`);
}

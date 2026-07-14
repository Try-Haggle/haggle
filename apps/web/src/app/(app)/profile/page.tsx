"use client";

import { ArrowRightLeft, LogOut, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ListRow } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

export default function ProfilePage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.push("/sign-in");
        return;
      }
      setDisplayName(
        (user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          user.email?.split("@")[0] ||
          "User") as string,
      );
      setEmail(user.email ?? "");
    });
  }, [router]);

  const handleSignOut = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/sign-in");
  }, [router]);

  function handleSwitchMode() {
    const currentMode = window.location.pathname.startsWith("/buy")
      ? "buying"
      : window.location.pathname.startsWith("/sell")
        ? "selling"
        : ((localStorage.getItem("haggle_mode") as string | null) ?? "buying");
    router.push(currentMode === "selling" ? "/buy/dashboard" : "/sell/dashboard");
  }

  return (
    <main className="min-h-screen px-4 py-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold text-ink mb-6">Profile</h1>

      {/* User info */}
      <div className="rounded-xl border border-line bg-surface-raised p-4 mb-4">
        <p className="text-sm text-ink-muted">Signed in as</p>
        <p className="mt-1 font-medium text-ink">{displayName}</p>
        <p className="text-sm text-ink-secondary">{email}</p>
      </div>

      {/* Switch mode */}
      <ListRow
        className="mb-4"
        onClick={handleSwitchMode}
        leading={<ArrowRightLeft className="size-5 text-action-primary" />}
        title="Switch mode"
      />

      {/* Account Settings */}
      <ListRow
        className="mb-4"
        href="/settings"
        showChevron
        leading={<Settings className="size-5 text-ink-secondary" />}
        title="Account Settings"
      />

      {/* TODO(notification-prefs): Notification Settings — hidden until prefs check
          is implemented in notification bus (bus.ts). Currently all events are
          transactional: true so preferences are bypassed.
      <Link href="/settings/notifications" ...>Notification Settings</Link>
      */}

      {/* Sign out */}
      <ListRow
        className="mb-4"
        onClick={handleSignOut}
        leading={<LogOut className="size-5 text-ink-secondary" />}
        title="Sign out"
      />
    </main>
  );
}

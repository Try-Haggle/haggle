"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
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
      <button
        type="button"
        onClick={handleSwitchMode}
        className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface-raised p-4 mb-4 hover:bg-surface-sunken/50 transition-colors cursor-pointer"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-action-primary"
          aria-hidden="true"
        >
          <path d="M8 3 4 7l4 4" />
          <path d="M4 7h16" />
          <path d="m16 21 4-4-4-4" />
          <path d="M20 17H4" />
        </svg>
        <span className="text-sm text-ink">Switch mode</span>
      </button>

      {/* Account Settings */}
      <Link
        href="/settings"
        className="flex items-center justify-between rounded-xl border border-line bg-surface-raised p-4 mb-4 hover:bg-surface-sunken/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-ink-secondary"
            aria-hidden="true"
          >
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span className="text-sm text-ink">Account Settings</span>
        </div>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-ink-muted"
          aria-hidden="true"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </Link>

      {/* TODO(notification-prefs): Notification Settings — hidden until prefs check
          is implemented in notification bus (bus.ts). Currently all events are
          transactional: true so preferences are bypassed.
      <Link href="/settings/notifications" ...>Notification Settings</Link>
      */}

      {/* Sign out */}
      <button
        type="button"
        onClick={handleSignOut}
        className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface-raised p-4 text-sm text-ink hover:bg-surface-sunken/50 transition-colors cursor-pointer"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        Sign out
      </button>
    </main>
  );
}

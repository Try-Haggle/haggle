import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BottomNav } from "@/components/bottom-nav";
import { Nav } from "@/components/nav";
import { createClient } from "@/lib/supabase/server";
import { getUserDisplayName } from "@/lib/user-display-name";
import { MessagesUnreadProvider } from "./_components/messages-unread-provider";
import { NotificationProvider } from "./_components/notification-provider";
import { UserEventsProvider } from "./_components/user-events-provider";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const hdrs = await headers();
    const pathname = hdrs.get("x-pathname");
    const next = pathname ? `?next=${encodeURIComponent(pathname)}` : "";
    redirect(`/sign-in${next}`);
  }

  const userName = getUserDisplayName(user);
  const userAvatarUrl = (user.user_metadata?.custom_avatar_url ||
    user.user_metadata?.avatar_url ||
    null) as string | null;

  return (
    <UserEventsProvider>
      <NotificationProvider>
        <MessagesUnreadProvider>
          <Nav userEmail={user.email ?? ""} userName={userName} userAvatarUrl={userAvatarUrl} />
          <div className="pb-16 md:pt-header md:pb-0">{children}</div>
          {/* BottomNav reads the query string to know when a conversation is
              open, which Next requires a boundary for. */}
          <Suspense fallback={null}>
            <BottomNav />
          </Suspense>
        </MessagesUnreadProvider>
      </NotificationProvider>
    </UserEventsProvider>
  );
}

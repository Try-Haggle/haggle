import { BottomNav } from "@/components/bottom-nav";
import { Nav } from "@/components/nav";
import { createClient } from "@/lib/supabase/server";

export default async function BrowseLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const userName = user
    ? ((user.user_metadata?.display_name || user.user_metadata?.name || null) as string | null)
    : null;
  const userAvatarUrl = user
    ? ((user.user_metadata?.custom_avatar_url || user.user_metadata?.avatar_url || null) as
        | string
        | null)
    : null;

  return (
    <>
      {user ? (
        <Nav userEmail={user.email ?? ""} userName={userName} userAvatarUrl={userAvatarUrl} />
      ) : (
        <nav className="fixed inset-x-0 top-0 z-50 h-14 border-line border-b bg-surface/80 backdrop-blur-md">
          <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-4 sm:px-6">
            <a
              href="/"
              className="font-bold text-ink text-lg transition-colors hover:text-action-primary"
            >
              Haggle
            </a>
            <a
              href="/sign-in"
              className="font-medium text-ink-secondary text-sm transition-colors hover:text-ink"
            >
              Sign in
            </a>
          </div>
        </nav>
      )}

      {user ? (
        <div className="pb-16 md:pt-16 md:pb-0">{children}</div>
      ) : (
        <div style={{ paddingTop: "56px" }}>{children}</div>
      )}

      {user && <BottomNav />}
    </>
  );
}

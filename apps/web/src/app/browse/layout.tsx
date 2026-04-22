import { createClient } from "@/lib/supabase/server";
import { Nav } from "@/components/nav";
import { BottomNav } from "@/components/bottom-nav";

export default async function BrowseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const userName = user
    ? ((user.user_metadata?.display_name || user.user_metadata?.name || null) as
        | string
        | null)
    : null;
  const userAvatarUrl = user
    ? ((user.user_metadata?.custom_avatar_url ||
        user.user_metadata?.avatar_url ||
        null) as string | null)
    : null;

  return (
    <>
      {user ? (
        <Nav
          userEmail={user.email ?? ""}
          userName={userName}
          userAvatarUrl={userAvatarUrl}
        />
      ) : (
        <nav className="fixed top-0 inset-x-0 z-50 h-14 border-b border-slate-800 bg-bg-primary/80 backdrop-blur-md">
          <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-4 sm:px-6">
            <a
              href="/"
              className="text-lg font-bold text-white hover:text-cyan-400 transition-colors"
            >
              Haggle
            </a>
            <a
              href="/sign-in"
              className="text-sm font-medium text-slate-400 hover:text-white transition-colors"
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

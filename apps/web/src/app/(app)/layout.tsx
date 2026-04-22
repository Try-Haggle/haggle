import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { Nav } from "@/components/nav";
import { BottomNav } from "@/components/bottom-nav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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

  const userName = (user.user_metadata?.display_name || user.user_metadata?.name || null) as string | null;
  const userAvatarUrl = (user.user_metadata?.custom_avatar_url || user.user_metadata?.avatar_url || null) as string | null;

  return (
    <>
      <Nav userEmail={user.email ?? ""} userName={userName} userAvatarUrl={userAvatarUrl} />
      <div className="pb-16 md:pt-16 md:pb-0">{children}</div>
      <BottomNav />
    </>
  );
}

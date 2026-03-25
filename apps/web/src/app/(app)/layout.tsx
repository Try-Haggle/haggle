import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Nav } from "@/components/nav";

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
    redirect("/claim");
  }

  const userName = (user.user_metadata?.display_name || user.user_metadata?.name || null) as string | null;
  const userAvatarUrl = (user.user_metadata?.custom_avatar_url || user.user_metadata?.avatar_url || null) as string | null;

  return (
    <>
      <Nav userEmail={user.email ?? ""} userName={userName} userAvatarUrl={userAvatarUrl} />
      <div className="pt-16">{children}</div>
    </>
  );
}

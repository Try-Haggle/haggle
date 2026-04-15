import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Nav } from "@/components/nav";
import { WalletProvider } from "@/lib/wallet-provider";
import "@rainbow-me/rainbowkit/styles.css";

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
    redirect("/sign-in");
  }

  const userName = (user.user_metadata?.display_name || user.user_metadata?.name || null) as string | null;
  const userAvatarUrl = (user.user_metadata?.custom_avatar_url || user.user_metadata?.avatar_url || null) as string | null;

  return (
    <WalletProvider>
      <Nav userEmail={user.email ?? ""} userName={userName} userAvatarUrl={userAvatarUrl} />
      <div className="pt-16">{children}</div>
    </WalletProvider>
  );
}

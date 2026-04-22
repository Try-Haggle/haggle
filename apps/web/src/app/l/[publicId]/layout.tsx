import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/bottom-nav";

export default async function ListingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <>{children}</>;
  }

  return (
    <>
      <div className="pb-16 md:pb-0">{children}</div>
      <BottomNav />
    </>
  );
}

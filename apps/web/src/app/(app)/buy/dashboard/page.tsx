import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BuyerDashboardContent } from "./dashboard-content";

export default async function BuyerDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/claim");
  }

  return <BuyerDashboardContent userEmail={user.email ?? ""} />;
}

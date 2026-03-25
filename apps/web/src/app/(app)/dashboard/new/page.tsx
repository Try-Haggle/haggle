import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NewListingWizard } from "./new-listing-wizard";

export default async function NewListingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/claim");
  }

  return <NewListingWizard userId={user.id} />;
}

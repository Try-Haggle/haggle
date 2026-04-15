import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NewListingWizard } from "./new-listing-wizard";

export default async function NewListingPage({
  searchParams,
}: {
  searchParams: Promise<{ draftId?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const params = await searchParams;

  return <NewListingWizard userId={user.id} resumeDraftId={params.draftId} />;
}

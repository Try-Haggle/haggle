import { redirect } from "next/navigation";
import { Suspense } from "react";
import { MessagesShell } from "@/components/messaging/messages-shell";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Messages · Haggle" };

export default async function MessagesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/sign-in?next=/messages");

  return (
    <Suspense fallback={null}>
      <MessagesShell currentUserId={user.id} />
    </Suspense>
  );
}

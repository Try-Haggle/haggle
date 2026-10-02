import { isDogfoodAuthWebSurfaceEnabled } from "@/lib/dogfood-auth-gate";
import { createClient } from "@/lib/supabase/server";
import { getUserDisplayName } from "@/lib/user-display-name";
import { SettingsContent } from "./settings-content";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // user is guaranteed by (app)/layout.tsx auth check
  const email = user!.email ?? "";
  const displayName = getUserDisplayName(user) ?? "";
  const avatarUrl =
    (user!.user_metadata?.custom_avatar_url as string) ||
    (user!.user_metadata?.avatar_url as string) ||
    "";
  const provider = user!.app_metadata?.provider ?? "email";

  return (
    <SettingsContent
      email={email}
      displayName={displayName}
      avatarUrl={avatarUrl}
      provider={provider}
      showDogfoodLogin={isDogfoodAuthWebSurfaceEnabled()}
    />
  );
}

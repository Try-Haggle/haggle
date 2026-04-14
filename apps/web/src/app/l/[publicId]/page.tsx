import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { serverApi, apiServerFireAndForget } from "@/lib/api-server";
import { BuyerLanding } from "./buyer-landing";

interface ListingData {
  id: string;
  publicId: string;
  publishedAt: string;
  title: string;
  description: string | null;
  category: string | null;
  condition: string | null;
  photoUrl: string | null;
  targetPrice: string | null;
  tags: string[] | null;
  sellerAgentPreset: string | null;
  sellingDeadline: string | null;
}

export default async function BuyerListingPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;

  let data: { ok: boolean; listing: ListingData; sellerId?: string | null };
  try {
    data = await serverApi.get<{ ok: boolean; listing: ListingData; sellerId?: string | null }>(
      `/api/public/listings/${publicId}`,
      { skipAuth: true },
    );
  } catch {
    notFound();
  }

  if (!data.ok || !data.listing) {
    notFound();
  }

  // Check auth (optional — page works for both guests and logged-in users)
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const userInfo = user
    ? {
        id: user.id,
        email: user.email ?? "",
        name: (user.user_metadata?.display_name || user.user_metadata?.name || null) as string | null,
        avatarUrl: (user.user_metadata?.custom_avatar_url || user.user_metadata?.avatar_url || null) as string | null,
      }
    : null;

  // Record view for logged-in buyers (fire-and-forget, don't block render)
  if (user) {
    const { data: { session } } = await supabase.auth.getSession();
    const authHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (session?.access_token) {
      authHeaders["Authorization"] = `Bearer ${session.access_token}`;
    }
    apiServerFireAndForget(`/api/viewed`, { userId: user.id, publicId }, authHeaders);
  }

  const isOwner = !!(user && data.sellerId && user.id === data.sellerId);

  return <BuyerLanding listing={data.listing} user={userInfo} isOwner={isOwner} />;
}

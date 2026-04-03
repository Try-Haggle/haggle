import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BuyerLanding } from "./buyer-landing";
import { SimilarListings } from "./similar-listings";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

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

  const res = await fetch(`${API_URL}/api/public/listings/${publicId}`, {
    cache: "no-store",
  });

  if (!res.ok) {
    notFound();
  }

  const data = (await res.json()) as { ok: boolean; listing: ListingData; sellerId?: string | null };

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
        email: user.email ?? "",
        name: (user.user_metadata?.display_name || user.user_metadata?.name || null) as string | null,
        avatarUrl: (user.user_metadata?.custom_avatar_url || user.user_metadata?.avatar_url || null) as string | null,
      }
    : null;

  // Record view for logged-in buyers (fire-and-forget, don't block render)
  if (user) {
    fetch(`${API_URL}/api/viewed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id, publicId }),
    }).catch(() => {
      // Silent fail — viewing history is non-critical
    });
  }

  const isOwner = !!(user && data.sellerId && user.id === data.sellerId);

  return (
    <>
      <BuyerLanding listing={data.listing} user={userInfo} isOwner={isOwner} />
      <SimilarListings publicId={publicId} userId={user?.id ?? null} />
    </>
  );
}

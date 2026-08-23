import { notFound } from "next/navigation";
import { apiServerFireAndForget, serverApi } from "@/lib/api-server";
import { createClient } from "@/lib/supabase/server";
import { BuyerLanding } from "./buyer-landing";
import { BuyerLandingV2 } from "./buyer-landing-v2";
import { SimilarListings } from "./similar-listings";

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
  sellerRequiredCriteria: Array<{ checkId: string; ask: string }> | null;
  sellerFulfillmentOffer?: {
    options: Array<{ method: string; radius_miles?: number; max_weight_lb?: number }>;
    preferred?: string;
  } | null;
  parcel?: {
    weight_oz: number;
    length_in?: number;
    width_in?: number;
    height_in?: number;
  } | null;
  /** Product facts the seller answered with canonical taxonomy options. */
  specs?: Array<{ checkId: string; label: string; value: string }> | null;
}

const VALID_ORIGINS = ["browse", "buy-dashboard", "sell-dashboard"] as const;
type Origin = (typeof VALID_ORIGINS)[number];

function parseOrigin(raw: string | undefined): Origin | null {
  if (!raw) return null;
  return (VALID_ORIGINS as readonly string[]).includes(raw) ? (raw as Origin) : null;
}

export default async function BuyerListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<{ from?: string; v?: string }>;
}) {
  const { publicId } = await params;
  const { from: fromRaw, v } = await searchParams;
  const from = parseOrigin(fromRaw);
  /**
   * v2 is the default listing detail. `?v=1` keeps the previous page reachable
   * — an escape hatch while v2 is the one real buyers land on, and the way to
   * compare the two on the same listing. Only an explicit "1" opts out, so a
   * stray value still gets the current design.
   */
  const useLegacy = v === "1";

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
        name: (user.user_metadata?.display_name || user.user_metadata?.name || null) as
          | string
          | null,
        avatarUrl: (user.user_metadata?.custom_avatar_url ||
          user.user_metadata?.avatar_url ||
          null) as string | null,
      }
    : null;

  // Record view for logged-in buyers (fire-and-forget, don't block render)
  if (user) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const authHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (session?.access_token) {
      authHeaders.Authorization = `Bearer ${session.access_token}`;
    }
    apiServerFireAndForget(`/api/viewed`, { userId: user.id, publicId }, authHeaders);
  }

  const isOwner = !!(user && data.sellerId && user.id === data.sellerId);

  return (
    <>
      {useLegacy ? (
        <>
          <BuyerLanding listing={data.listing} user={userInfo} isOwner={isOwner} from={from} />
          <SimilarListings publicId={publicId} userId={user?.id ?? null} from={from} />
        </>
      ) : (
        /* v2 takes it through `footerSlot` rather than as a sibling: the page's
           sticky action bar is fixed, and only what renders inside v2 gets the
           bottom clearance it reserves. As a sibling the last row of cards sat
           82px behind the bar. v1 has no such bar, so it keeps the sibling. */
        <BuyerLandingV2
          listing={data.listing}
          user={userInfo}
          isOwner={isOwner}
          from={from ?? undefined}
          footerSlot={<SimilarListings publicId={publicId} userId={user?.id ?? null} from={from} />}
        />
      )}
    </>
  );
}

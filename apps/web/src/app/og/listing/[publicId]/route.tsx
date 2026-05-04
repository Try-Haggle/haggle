import { ImageResponse } from "next/og";

export const runtime = "nodejs";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://haggle-production-7dee.up.railway.app";

interface ListingData {
  publicId: string;
  title: string;
  photoUrl: string | null;
  targetPrice: string | null;
  sellerAgentPreset: string | null;
}

const PRESET_LABELS: Record<string, { name: string; color: string }> = {
  gatekeeper: { name: "The Gatekeeper", color: "#ef4444" },
  diplomat: { name: "The Diplomat", color: "#f59e0b" },
  closer: { name: "The Closer", color: "#10b981" },
  hustler: { name: "The Hustler", color: "#8b5cf6" },
  scholar: { name: "The Scholar", color: "#06b6d4" },
};

function formatPrice(value: string | null): string {
  if (!value) return "—";
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  return `$${num.toLocaleString("en-US")}`;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ publicId: string }> },
) {
  const { publicId } = await params;

  let listing: ListingData | null = null;
  try {
    const res = await fetch(`${API_URL}/api/public/listings/${publicId}`, {
      next: { revalidate: 60 },
    });
    if (res.ok) {
      const body = (await res.json()) as { ok: boolean; listing: ListingData };
      if (body.ok) listing = body.listing;
    }
  } catch {
    // fall through
  }

  if (!listing) {
    return new Response("Listing not found", { status: 404 });
  }

  const preset = listing.sellerAgentPreset
    ? PRESET_LABELS[listing.sellerAgentPreset]
    : null;

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=300, s-maxage=600",
    "Content-Disposition": `inline; filename="haggle-${publicId}.png"`,
  };

  const response = new ImageResponse(
    (
      <div
        style={{
          width: "1080px",
          height: "1920px",
          display: "flex",
          flexDirection: "column",
          background:
            "linear-gradient(180deg, #0b1120 0%, #0b1120 55%, #0f172a 100%)",
          color: "#f8fafc",
          padding: "96px 80px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Brand */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            fontSize: "36px",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: "#22d3ee",
          }}
        >
          🤝 Haggle
        </div>

        {/* Photo */}
        <div
          style={{
            marginTop: "80px",
            width: "100%",
            height: "920px",
            borderRadius: "48px",
            overflow: "hidden",
            display: "flex",
            background: "#1e293b",
          }}
        >
          {listing.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={listing.photoUrl}
              alt=""
              width={920}
              height={920}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "120px",
              }}
            >
              📦
            </div>
          )}
        </div>

        {/* Title + Price */}
        <div
          style={{
            marginTop: "64px",
            display: "flex",
            flexDirection: "column",
            gap: "24px",
          }}
        >
          <div
            style={{
              fontSize: "72px",
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
            }}
          >
            {listing.title.length > 38
              ? listing.title.slice(0, 36) + "…"
              : listing.title}
          </div>
          <div
            style={{
              fontSize: "96px",
              fontWeight: 800,
              color: "#22d3ee",
              letterSpacing: "-0.03em",
            }}
          >
            {formatPrice(listing.targetPrice)}
          </div>
        </div>

        {/* Agent badge */}
        {preset && (
          <div
            style={{
              marginTop: "48px",
              display: "flex",
              alignItems: "center",
              gap: "20px",
              padding: "20px 32px",
              borderRadius: "999px",
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)",
              fontSize: "32px",
              alignSelf: "flex-start",
            }}
          >
            <div
              style={{
                width: "20px",
                height: "20px",
                borderRadius: "999px",
                background: preset.color,
              }}
            />
            <span style={{ color: "#cbd5e1" }}>Negotiating with</span>
            <span style={{ fontWeight: 600 }}>{preset.name}</span>
          </div>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Link sticker landing zone */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "24px",
          }}
        >
          <div
            style={{
              fontSize: "40px",
              fontWeight: 600,
              color: "#f8fafc",
              letterSpacing: "-0.01em",
              display: "flex",
            }}
          >
            Negotiate with my AI agent
          </div>
          <div
            style={{
              fontSize: "32px",
              color: "#22d3ee",
              fontWeight: 500,
              display: "flex",
            }}
          >
            ↓ Tap the link sticker
          </div>
          <div
            style={{
              width: "640px",
              height: "180px",
              borderRadius: "32px",
              border: "3px dashed rgba(34,211,238,0.45)",
              background: "rgba(34,211,238,0.04)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "28px",
              color: "rgba(148,163,184,0.7)",
              letterSpacing: "0.02em",
            }}
          >
            place link sticker here
          </div>
        </div>
      </div>
    ),
    {
      width: 1080,
      height: 1920,
    },
  );

  for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
  return response;
}

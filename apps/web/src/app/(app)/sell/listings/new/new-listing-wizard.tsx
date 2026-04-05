"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAmplitude } from "@/providers/amplitude-provider";
import { api } from "@/lib/api-client";

/* ─── Constants ───────────────────────────────────────────── */

const CATEGORIES = [
  { value: "electronics", label: "Electronics" },
  { value: "clothing", label: "Clothing" },
  { value: "furniture", label: "Furniture" },
  { value: "collectibles", label: "Collectibles" },
  { value: "sports", label: "Sports" },
  { value: "vehicles", label: "Vehicles" },
  { value: "books", label: "Books" },
  { value: "other", label: "Other" },
];

const CONDITIONS = [
  { value: "new", label: "New" },
  { value: "like_new", label: "Like New" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
  { value: "poor", label: "Poor" },
];

/* ─── Seller Agent Presets (same as widget) ────────────────── */

interface AgentStats {
  priceAggression: number;
  patienceLevel: number;
  riskTolerance: number;
  speedBias: number;
  detailFocus: number;
}

interface AgentPreset {
  id: string;
  name: string;
  tagline: string;
  description: string;
  accentColor: string;
  icon: string;
  stats: AgentStats;
}

const AGENT_PRESETS: AgentPreset[] = [
  {
    id: "gatekeeper",
    name: "The Gatekeeper",
    tagline: "Holds the line. Rarely budges.",
    description:
      "Defends your asking price with logic and confidence. Best for high-demand items or when you're not in a rush.",
    accentColor: "#ef4444",
    icon: "🛡️",
    stats: { priceAggression: 85, patienceLevel: 90, riskTolerance: 20, speedBias: 30, detailFocus: 75 },
  },
  {
    id: "diplomat",
    name: "The Diplomat",
    tagline: "Meets buyers halfway. Closes more.",
    description:
      "Balances getting a fair price with closing deals. Adapts to the buyer's style.",
    accentColor: "#f59e0b",
    icon: "🤝",
    stats: { priceAggression: 55, patienceLevel: 70, riskTolerance: 50, speedBias: 50, detailFocus: 60 },
  },
  {
    id: "storyteller",
    name: "The Storyteller",
    tagline: "Sells the value, not just the price.",
    description:
      "Emphasizes condition, accessories, and item value to justify the price rather than just discounting.",
    accentColor: "#a855f7",
    icon: "✨",
    stats: { priceAggression: 60, patienceLevel: 80, riskTolerance: 35, speedBias: 25, detailFocus: 95 },
  },
  {
    id: "dealmaker",
    name: "The Dealmaker",
    tagline: "Fast deals. Done. Move on.",
    description:
      "Prioritizes closing quickly. Willing to give modest discounts for a quick, committed buyer.",
    accentColor: "#eab308",
    icon: "⚡",
    stats: { priceAggression: 40, patienceLevel: 25, riskTolerance: 75, speedBias: 95, detailFocus: 35 },
  },
];

const STAT_META: { key: keyof AgentStats; label: string; gradient: string }[] = [
  { key: "priceAggression", label: "Price Aggression", gradient: "linear-gradient(90deg, #06b6d4, #22d3ee)" },
  { key: "patienceLevel", label: "Patience Level", gradient: "linear-gradient(90deg, #10b981, #34d399)" },
  { key: "riskTolerance", label: "Risk Tolerance", gradient: "linear-gradient(90deg, #f59e0b, #fbbf24)" },
  { key: "speedBias", label: "Speed Bias", gradient: "linear-gradient(90deg, #3b82f6, #60a5fa)" },
  { key: "detailFocus", label: "Detail Focus", gradient: "linear-gradient(90deg, #ef4444, #f87171)" },
];

const RADAR_LABELS = ["Price", "Patience", "Risk", "Speed", "Detail"];

const DEFAULT_STATS: AgentStats = {
  priceAggression: 50,
  patienceLevel: 50,
  riskTolerance: 50,
  speedBias: 50,
  detailFocus: 50,
};

/* ─── Image Compression ───────────────────────────────────── */

function compressImage(file: File, maxDim = 1200, quality = 0.8): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Compression failed"))),
        "image/jpeg",
        quality,
      );
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/* ─── Radar Chart ─────────────────────────────────────────── */

function RadarChart({ stats }: { stats: AgentStats }) {
  const SIZE = 250;
  const CENTER = SIZE / 2;
  const RADIUS = 85;
  const LABEL_OFFSET = 24;
  const GRID_LEVELS = [0.25, 0.5, 0.75, 1.0];
  const STAT_KEYS: (keyof AgentStats)[] = ["priceAggression", "patienceLevel", "riskTolerance", "speedBias", "detailFocus"];

  const [display, setDisplay] = useState<number[]>(STAT_KEYS.map((k) => stats[k]));
  const currentRef = useRef<number[]>(STAT_KEYS.map((k) => stats[k]));
  const animRef = useRef<number>(0);

  useEffect(() => {
    const target = STAT_KEYS.map((k) => stats[k]);
    const from = [...currentRef.current];
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min((now - start) / 600, 1);
      const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
      const next = from.map((f, i) => f + (target[i] - f) * ease);
      currentRef.current = next;
      setDisplay(next);
      if (t < 1) animRef.current = requestAnimationFrame(tick);
    };

    if (animRef.current) cancelAnimationFrame(animRef.current);
    animRef.current = requestAnimationFrame(tick);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [stats]);

  function vertex(i: number, r: number): [number, number] {
    const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    return [CENTER + r * Math.cos(angle), CENTER + r * Math.sin(angle)];
  }

  function polygonPoints(values: number[]): string {
    return values.map((v, i) => { const [x, y] = vertex(i, (v / 100) * RADIUS); return `${x},${y}`; }).join(" ");
  }

  function gridPolygon(level: number): string {
    return Array.from({ length: 5 }, (_, i) => { const [x, y] = vertex(i, level * RADIUS); return `${x},${y}`; }).join(" ");
  }

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="mx-auto block w-full max-w-[240px]">
      {GRID_LEVELS.map((level) => (
        <polygon key={level} points={gridPolygon(level)} fill="none" stroke="rgba(148,163,184,0.3)" strokeWidth="1" />
      ))}
      {Array.from({ length: 5 }, (_, i) => {
        const [x, y] = vertex(i, RADIUS);
        return <line key={i} x1={CENTER} y1={CENTER} x2={x} y2={y} stroke="rgba(148,163,184,0.2)" strokeWidth="1" />;
      })}
      <polygon points={polygonPoints(display)} fill="rgba(6,182,212,0.12)" stroke="rgba(6,182,212,0.7)" strokeWidth="2" strokeLinejoin="round" />
      {display.map((v, i) => { const [x, y] = vertex(i, (v / 100) * RADIUS); return <circle key={i} cx={x} cy={y} r="3.5" fill="#06b6d4" />; })}
      {RADAR_LABELS.map((label, i) => {
        const [x, y] = vertex(i, RADIUS + LABEL_OFFSET);
        return <text key={label} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fill="#94a3b8" fontSize="11" style={{ fontFamily: "inherit" }}>{label}</text>;
      })}
    </svg>
  );
}

/* ─── Main Wizard ─────────────────────────────────────────── */

const STEP_NAMES = ["item_details", "pricing", "agent"] as const;

export function NewListingWizard({ userId }: { userId: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { track } = useAmplitude();

  // Wizard state
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);

  // Step 1 fields
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [tagEditing, setTagEditing] = useState(false);
  const tagFieldRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState("electronics");
  const [condition, setCondition] = useState("good");

  // Step 2 fields (raw numeric strings without commas)
  const [targetPrice, setTargetPrice] = useState("");
  const [floorPrice, setFloorPrice] = useState("");
  const [sellingDeadline, setSellingDeadline] = useState("");

  // Format number with commas for display
  const formatWithCommas = (v: string) => {
    if (!v) return "";
    const n = parseInt(v, 10);
    return isNaN(n) ? v : n.toLocaleString();
  };
  // Strip commas and non-digit chars from input, keep raw number
  const handlePriceChange = (raw: string, setter: (v: string) => void) => {
    const digits = raw.replace(/[^0-9]/g, "");
    setter(digits);
  };

  // Step 3 fields
  const [selectedAgent, setSelectedAgent] = useState<AgentPreset | null>(null);

  // Published state
  const [publishResult, setPublishResult] = useState<{
    publicId: string;
    shareUrl: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const currentStats = selectedAgent?.stats ?? DEFAULT_STATS;
  const accentColor = selectedAgent?.accentColor ?? "#64748b";

  /* ─── Amplitude tracking ───────────────────────────────── */

  // Wizard Started (1회) + Step Viewed (스텝 변경 시)
  const wizardTracked = useRef(false);
  const lastTrackedStep = useRef<number | null>(null);
  useEffect(() => {
    if (!wizardTracked.current) {
      track("Listing Wizard Started", {
        source: document.referrer.includes("/sell/dashboard") ? "dashboard" : "direct",
      });
      wizardTracked.current = true;
    }
    if (lastTrackedStep.current !== step) {
      track("Listing Wizard Step Viewed", {
        step_index: step,
        step_name: STEP_NAMES[step - 1],
        draft_id: draftId,
      });
      lastTrackedStep.current = step;
    }
  }, [step]);

  /* ─── Photo handling ────────────────────────────────────── */

  async function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setError("Photo must be under 5 MB");
      return;
    }

    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
    setPhotoUrl(null);
    setError(null);
  }

  async function uploadPhoto(dId: string): Promise<string | null> {
    if (!photoFile) return photoUrl;
    if (photoUrl) return photoUrl;

    try {
      const compressed = await compressImage(photoFile);
      const supabase = createClient();
      const ext = "jpg";
      const path = `${dId}/${Date.now()}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from("listing-photos")
        .upload(path, compressed, { contentType: "image/jpeg", upsert: true });

      if (uploadErr) throw uploadErr;

      const { data } = supabase.storage.from("listing-photos").getPublicUrl(path);
      const url = data.publicUrl;
      setPhotoUrl(url);
      return url;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setError(`Photo upload failed: ${msg}`);
      return null;
    }
  }

  /* ─── API helpers ───────────────────────────────────────── */

  async function ensureDraft(): Promise<string | null> {
    if (draftId) return draftId;

    try {
      const data = await api.post<{ ok: boolean; draft: { id: string } }>(
        "/api/drafts",
        { userId },
      );
      if (!data.ok) {
        setError("Failed to create draft");
        return null;
      }
      setDraftId(data.draft.id);
      return data.draft.id;
    } catch {
      setError("Failed to create draft");
      return null;
    }
  }

  async function patchDraft(id: string, patch: Record<string, unknown>) {
    try {
      const data = await api.patch<{ ok: boolean }>(
        `/api/drafts/${id}`,
        { ...patch, userId },
      );
      if (!data.ok) {
        setError("Failed to save changes");
        return false;
      }
      return true;
    } catch {
      setError("Failed to save changes");
      return false;
    }
  }

  /* ─── Step handlers ─────────────────────────────────────── */

  async function handleStep1Next() {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (!photoFile && !photoUrl) {
      setError("Please add a photo");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const id = await ensureDraft();
      if (!id) return;

      // Upload photo
      const url = await uploadPhoto(id);
      if (!url && photoFile) return;

      // Patch draft
      const ok = await patchDraft(id, {
        title: title.trim(),
        description: description.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
        category,
        condition,
        photoUrl: url,
      });

      if (ok) setStep(2);
    } finally {
      setSaving(false);
    }
  }

  async function handleStep2Next() {
    if (!targetPrice.trim()) {
      setError("Asking price is required");
      return;
    }
    if (!sellingDeadline) {
      setError("Selling deadline is required");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const ok = await patchDraft(draftId!, {
        targetPrice: targetPrice.trim(),
        floorPrice: floorPrice.trim() || undefined,
        sellingDeadline: new Date(sellingDeadline).toISOString(),
      });

      if (ok) setStep(3);
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    if (!selectedAgent) {
      setError("Please select an agent");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // Save strategy config
      let ok = await patchDraft(draftId!, {
        strategyConfig: {
          preset: selectedAgent.id,
          ...selectedAgent.stats,
        },
      });
      if (!ok) return;

      // Publish — uses apiClient directly to preserve structured error responses
      const data = await api.post<{
        ok: boolean;
        publicId?: string;
        shareUrl?: string;
        errors?: { message: string; step: number }[];
        error?: string;
      }>(`/api/drafts/${draftId}/publish`, { userId }).catch(() => null);

      if (!data) {
        setError("Failed to publish");
        return;
      }

      if (!data.ok) {
        if (data.errors) {
          const firstErr = data.errors[0];
          setError(firstErr.message);
          setStep(firstErr.step);
        } else {
          setError(data.error || "Failed to publish");
        }
        return;
      }

      track("Listing Published", {
        draft_id: draftId,
        public_id: data.publicId,
        category,
        condition,
        has_photo: !!photoUrl,
        has_floor_price: !!floorPrice,
        agent_preset: selectedAgent.id,
      });

      setPublishResult({
        publicId: data.publicId!,
        shareUrl: data.shareUrl!,
      });
    } finally {
      setSaving(false);
    }
  }

  /* ─── Tag input ─────────────────────────────────────────── */

  function handleTagKeyDown(e: React.KeyboardEvent) {
    // Skip if IME is composing (Korean, Japanese, Chinese input)
    if (e.nativeEvent.isComposing) return;

    if ((e.key === "Enter" || e.key === ",") && tagInput.trim()) {
      e.preventDefault();
      const tag = tagInput.trim().replace(",", "");
      if (tag && !tags.includes(tag)) {
        setTags([...tags, tag]);
      }
      setTagInput("");
    }
    if (e.key === "Backspace" && !tagInput && tags.length > 0) {
      setTags(tags.slice(0, -1));
    }
  }

  /* ─── Today for date min ────────────────────────────────── */

  const today = new Date().toISOString().split("T")[0];

  /* ─── Published Screen ──────────────────────────────────── */

  if (publishResult) {
    const formatPrice = (v: string) => {
      const n = parseFloat(v);
      return isNaN(n) ? "$0" : `$${n.toLocaleString()}`;
    };

    return (
      <main className="min-h-[calc(100vh-4rem)] px-4 py-6">
        <div className="mx-auto max-w-[560px] pt-5 pb-10 text-center">
          {/* Success Icon — matches widget sparkle icon */}
          <div
            className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-xl"
            style={{ background: "rgba(16,185,129,0.12)", border: "1.5px solid rgba(16,185,129,0.35)" }}
          >
            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
              <path d="M20 3v4" /><path d="M22 5h-4" />
              <path d="M4 17v2" /><path d="M5 18H3" />
            </svg>
          </div>

          {/* Title */}
          <h2 className="text-[24px] font-bold mb-2" style={{ color: "#f1f5f9" }}>Your listing is live!</h2>
          <p className="mx-auto mb-8 max-w-[400px] text-[14px] leading-relaxed" style={{ color: "#94a3b8" }}>
            Share the link below. When buyers click it, they&apos;ll negotiate with your AI agent automatically.
          </p>

          {/* Item Summary Card */}
          <div className="flex items-center gap-4 rounded-xl text-left mb-8" style={{ padding: "18px 20px", background: "#111827", border: "1px solid #1e293b" }}>
            {photoPreview ? (
              <img src={photoPreview} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
            ) : (
              <div className="h-14 w-14 shrink-0 rounded-lg" style={{ background: "#1e293b" }} />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-semibold" style={{ color: "#f1f5f9" }}>{title || "Untitled"}</p>
              <p className="text-[20px] font-bold mt-[2px]" style={{ color: "#f1f5f9" }}>{formatPrice(targetPrice)}</p>
              {selectedAgent && (
                <p className="flex items-center gap-1.5 text-[12px] mt-1" style={{ color: "#10b981" }}>
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: selectedAgent.accentColor }} />
                  Agent: {selectedAgent.name}
                </p>
              )}
            </div>
          </div>

          {/* Share Link */}
          <p className="mb-[10px] text-left text-[11px] font-bold tracking-[0.06em]" style={{ color: "#94a3b8" }}>YOUR HAGGLE LINK</p>
          <div className="flex items-center gap-3 rounded-xl mb-6" style={{ padding: "16px 18px", background: "#111827", border: "1px solid #1e293b" }}>
            <svg className="shrink-0" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <span className="flex-1 truncate text-left text-[14px]" style={{ color: "#f1f5f9" }}>
              {publishResult.shareUrl}
            </span>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(publishResult.shareUrl);
                track("Share Link Copied", { public_id: publishResult.publicId, source: "publish_screen" });
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors"
              style={{ background: "#0d1321", border: "1px solid #1e293b", color: "#94a3b8" }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#06b6d4"; e.currentTarget.style.color = "#06b6d4"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1e293b"; e.currentTarget.style.color = "#94a3b8"; }}
            >
              {copied ? (
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                </svg>
              )}
            </button>
          </div>

          {/* Go to Dashboard */}
          <button
            type="button"
            onClick={() => router.push("/sell/dashboard")}
            className="mt-7 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-none text-[15px] font-semibold text-white transition-colors"
            style={{ background: "#10b981", padding: "14px 24px" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#059669"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#10b981"; }}
          >
            Go to Dashboard
          </button>
        </div>
      </main>
    );
  }

  /* ─── Step Indicator ────────────────────────────────────── */

  const stepLabels = ["Item Details", "Set Pricing", "AI Agent"];

  return (
    <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:p-6 max-w-4xl mx-auto">
      {/* Back button */}
      <button
        type="button"
        onClick={() => {
          setError(null);
          if (step === 1) {
            router.push("/sell/dashboard");
          } else {
            setStep(step - 1);
          }
        }}
        className="mb-4 flex cursor-pointer items-center gap-1 text-sm text-slate-400 hover:text-white transition-colors"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m15 18-6-6 6-6" /></svg>
        {step === 1 ? "Dashboard" : "Back"}
      </button>

      {/* Step indicator — matches widget exactly */}
      <div className="mb-7 flex items-center">
        {stepLabels.map((label, i) => {
          const n = i + 1;
          const isActive = n === step;
          const isComplete = n < step;

          return (
            <div key={label} className="contents">
              {i > 0 && (
                <div
                  className="mx-3 h-px flex-1"
                  style={{
                    background: isComplete || isActive ? "#06b6d4" : "#1e293b",
                  }}
                />
              )}
              <div
                className="flex shrink-0 items-center gap-1.5"
                style={{ cursor: isComplete ? "pointer" : isActive ? "default" : "not-allowed" }}
                onClick={() => {
                  if (isComplete) {
                    setError(null);
                    setStep(n);
                  }
                }}
              >
                <div
                  className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold"
                  style={{
                    border: `1.5px solid ${isActive || isComplete ? "#06b6d4" : "#1e293b"}`,
                    background: isComplete ? "#06b6d4" : "transparent",
                    color: isComplete ? "#000000" : isActive ? "#06b6d4" : "#94a3b8",
                  }}
                >
                  {isComplete ? "✓" : n}
                </div>
                <span
                  className="whitespace-nowrap text-[11px]"
                  style={{
                    color: isActive ? "#f1f5f9" : "#94a3b8",
                    fontWeight: isActive ? 500 : 400,
                  }}
                >
                  {label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/8 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* ─── STEP 1: Item Details ─────────────────────────── */}
      {step === 1 && (
        <div>
          {/* Section Heading — icon + text, matches widget */}
          <div className="mb-6 flex items-center gap-2.5">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" />
              <path d="M12 22V12" />
              <polyline points="3.29 7 12 12 20.71 7" />
              <path d="m7.5 4.27 9 5.15" />
            </svg>
            <h2 className="text-lg font-bold" style={{ color: "#f1f5f9" }}>What are you selling?</h2>
          </div>

          {/* Photo */}
          <div className="mb-5">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.05em]" style={{ color: "#cbd5e1" }}>
              Photo <span style={{ color: "#f97316" }}>*</span>
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handlePhotoSelect}
            />
            {photoPreview ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="group relative h-[200px] w-full cursor-pointer overflow-hidden rounded-xl border-2 border-dashed transition-colors"
                style={{ borderColor: "#334155" }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#ffffff")}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#334155")}
              >
                <img src={photoPreview} alt="Preview" className="h-full w-full object-cover" />
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" x2="12" y1="3" y2="15" />
                  </svg>
                </div>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="flex h-[200px] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed transition-colors"
                style={{ borderColor: "#334155", color: "#94a3b8", fontSize: "13px" }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#06b6d4")}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#334155")}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                  <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                  <circle cx="9" cy="9" r="2" />
                  <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                </svg>
                <span>Upload photo</span>
              </div>
            )}
          </div>

          {/* Title */}
          <div className="mb-5">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.05em]" style={{ color: "#cbd5e1" }}>
              Title <span style={{ color: "#f97316" }}>*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => { setTitle(e.target.value); if (error) setError(null); }}
              placeholder="e.g. MacBook Pro M3, 14 inch"
              className="w-full rounded-lg border bg-bg-input px-3 py-2.5 text-sm outline-none transition-colors"
              style={{ borderColor: "#1e293b", color: "#f1f5f9" }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "#06b6d4")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "#1e293b")}
            />
            {error && step === 1 && <p className="mt-1.5 text-[13px] text-red-500">{error}</p>}
          </div>

          {/* Description */}
          <div className="mb-5">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.05em]" style={{ color: "#cbd5e1" }}>
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe key features, specs, included accessories, reason for selling..."
              className="min-h-[80px] w-full resize-y rounded-lg border bg-bg-input px-3 py-2.5 text-sm outline-none transition-colors"
              style={{ borderColor: "#1e293b", color: "#f1f5f9" }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "#06b6d4")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "#1e293b")}
            />
          </div>

          {/* Tags — widget-style: "+ New" button that expands to input, pill chips */}
          <div className="mb-5">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.05em]" style={{ color: "#cbd5e1" }}>
              Tags
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {tagEditing ? (
                <input
                  ref={tagFieldRef}
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  onBlur={() => {
                    if (tagInput.trim()) {
                      const tag = tagInput.trim();
                      if (!tags.includes(tag)) setTags([...tags, tag]);
                    }
                    setTagInput("");
                    setTagEditing(false);
                  }}
                  placeholder="tag name..."
                  className="h-[30px] w-[110px] rounded-full border bg-bg-input px-4 text-[13px] outline-none"
                  style={{ borderColor: "#06b6d4", color: "#f1f5f9" }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setTagEditing(true);
                    setTimeout(() => tagFieldRef.current?.focus(), 0);
                  }}
                  className="flex h-[30px] cursor-pointer items-center gap-1 rounded-full border border-dashed px-4 text-[13px] transition-colors hover:border-[#06b6d4] hover:text-[#06b6d4]"
                  style={{ borderColor: "#334155", color: "#94a3b8" }}
                >
                  <span className="relative -top-px">+</span><span>New</span>
                </button>
              )}
              {tags.map((tag, i) => (
                <span
                  key={tag}
                  className="inline-flex h-[30px] items-center gap-1.5 rounded-full border px-4 text-[13px]"
                  style={{ background: "#1e293b", borderColor: "#334155", color: "#f1f5f9" }}
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => setTags(tags.filter((_, idx) => idx !== i))}
                    className="text-lg opacity-50 transition-opacity hover:opacity-100"
                    style={{ color: "#94a3b8" }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Category — full width, custom arrow select */}
          <div className="mb-5">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.05em]" style={{ color: "#cbd5e1" }}>
              Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full cursor-pointer appearance-none rounded-lg border bg-bg-input px-3 py-2.5 text-sm outline-none transition-colors"

              style={{
                borderColor: "#1e293b",
                color: "#f1f5f9",
                backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%2394a3b8' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E\")",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 12px center",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "#06b6d4")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "#1e293b")}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Condition — pill chips, full width, cyan selected */}
          <div className="mb-5">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.05em]" style={{ color: "#cbd5e1" }}>
              Condition
            </label>
            <div className="flex flex-wrap gap-2">
              {CONDITIONS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCondition(c.value)}
                  className="cursor-pointer rounded-full border px-[18px] py-2 text-[13px] transition-all"
                  style={{
                    background: condition === c.value ? "transparent" : "transparent",
                    borderColor: condition === c.value ? "#06b6d4" : "#374151",
                    color: condition === c.value ? "#06b6d4" : "#94a3b8",
                  }}
                  onMouseEnter={(e) => {
                    if (condition !== c.value) {
                      e.currentTarget.style.borderColor = "#4b5563";
                      e.currentTarget.style.color = "#f1f5f9";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (condition !== c.value) {
                      e.currentTarget.style.borderColor = "#374151";
                      e.currentTarget.style.color = "#94a3b8";
                    }
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Next Button — matches widget btn-primary */}
          <button
            type="button"
            onClick={handleStep1Next}
            disabled={saving || !title.trim() || (!photoFile && !photoUrl)}
            className="mt-7 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-none text-[15px] font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: "#10b981", padding: "14px 24px" }}
            onMouseEnter={(e) => { if (!saving) e.currentTarget.style.background = "#059669"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#10b981"; }}
          >
            {saving ? "Saving..." : "Next: Set Pricing"}
            {!saving && <span>→</span>}
          </button>
        </div>
      )}

      {/* ─── STEP 2: Pricing ──────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-6">
          {/* Section heading — matches widget .section-heading */}
          <div className="flex items-center gap-[10px] mb-6">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#06b6d4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <line x1="12" x2="12" y1="2" y2="22" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
            <h2 className="text-[18px] font-bold" style={{ color: "#f1f5f9" }}>Set your price</h2>
          </div>

          {/* Item summary card — matches widget .summary-card */}
          <div className="flex items-center gap-[14px] rounded-xl border p-4 mb-6" style={{ background: "var(--bg-card, #0f172a)", borderColor: "#1e293b" }}>
            {photoPreview ? (
              <img src={photoPreview} alt="" className="h-[44px] w-[44px] rounded-full object-cover shrink-0" />
            ) : (
              <div className="h-[44px] w-[44px] rounded-full shrink-0" style={{ background: "#1e293b" }} />
            )}
            <div>
              <p className="text-[14px] font-semibold" style={{ color: "#f1f5f9" }}>{title || "Untitled"}</p>
              <p className="text-[13px] mt-[2px]" style={{ color: "#94a3b8" }}>
                {CONDITIONS.find((c) => c.value === condition)?.label ?? "—"} · {CATEGORIES.find((c) => c.value === category)?.label ?? "—"}
              </p>
            </div>
          </div>

          {/* Asking price */}
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.05em]" style={{ color: "#cbd5e1" }}>
              Asking Price <span style={{ color: "#f97316" }}>*</span>
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style={{ color: "#94a3b8" }}>$</span>
              <input
                type="text"
                inputMode="numeric"
                value={formatWithCommas(targetPrice)}
                onChange={(e) => handlePriceChange(e.target.value, setTargetPrice)}
                placeholder="0"
                className="w-full rounded-lg border bg-bg-input py-3 pl-7 pr-4 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-1"
                style={{ borderColor: "#1e293b", ["--tw-ring-color" as string]: "#06b6d4" }}
                onFocus={(e) => { e.target.style.borderColor = "#06b6d4"; }}
                onBlur={(e) => { e.target.style.borderColor = "#1e293b"; }}
              />
            </div>
            <p className="mt-1.5 text-[12px]" style={{ color: "#94a3b8", opacity: 0.6 }}>The starting price buyers will see</p>
          </div>

          {/* Floor price */}
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.05em]" style={{ color: "#cbd5e1" }}>
              Minimum Acceptable Price{" "}
              <span className="font-normal normal-case tracking-normal" style={{ color: "#94a3b8", opacity: 0.6 }}>(private — only your AI agent knows)</span>
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style={{ color: "#94a3b8" }}>$</span>
              <input
                type="text"
                inputMode="numeric"
                value={formatWithCommas(floorPrice)}
                onChange={(e) => handlePriceChange(e.target.value, setFloorPrice)}
                placeholder="0"
                className="w-full rounded-lg border bg-bg-input py-3 pl-7 pr-4 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-1"
                style={{ borderColor: "#1e293b", ["--tw-ring-color" as string]: "#06b6d4" }}
                onFocus={(e) => { e.target.style.borderColor = "#06b6d4"; }}
                onBlur={(e) => { e.target.style.borderColor = "#1e293b"; }}
              />
            </div>
            <p className="mt-1.5 text-[12px]" style={{ color: "#94a3b8", opacity: 0.6 }}>Your AI will never agree below this price</p>
          </div>

          {/* Selling deadline */}
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.05em]" style={{ color: "#cbd5e1" }}>
              Selling Deadline <span style={{ color: "#f97316" }}>*</span>
            </label>
            <input
              type="date"
              min={today}
              value={sellingDeadline}
              onChange={(e) => setSellingDeadline(e.target.value)}
              className="w-full cursor-pointer rounded-lg border bg-bg-input px-4 py-3 text-sm focus:outline-none focus:ring-1"
              style={{ borderColor: "#1e293b", ["--tw-ring-color" as string]: "#06b6d4", colorScheme: "dark" }}
              onFocus={(e) => { e.target.style.borderColor = "#06b6d4"; }}
              onBlur={(e) => { e.target.style.borderColor = "#1e293b"; }}
            />
            <p className="mt-1.5 text-[12px]" style={{ color: "#94a3b8", opacity: 0.6 }}>Your AI agent may be more flexible as the deadline approaches</p>
          </div>

          {/* Next button — emerald to match Step 1 */}
          <button
            type="button"
            onClick={handleStep2Next}
            disabled={saving || !targetPrice.trim() || !sellingDeadline}
            className="mt-7 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-none text-[15px] font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: "#10b981", padding: "14px 24px" }}
            onMouseEnter={(e) => { if (!saving) e.currentTarget.style.background = "#059669"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#10b981"; }}
          >
            {saving ? "Saving..." : "Next: Set Up AI Agent"}
            {!saving && <span>→</span>}
          </button>
        </div>
      )}

      {/* ─── STEP 3: Agent Setup ──────────────────────────── */}
      {step === 3 && (
        <div className="space-y-6">
          {/* Section heading — matches widget .section-heading */}
          <div className="flex items-center gap-[10px] mb-2">
            <svg className="shrink-0" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#06b6d4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="10" x="3" y="11" rx="2" />
              <circle cx="12" cy="5" r="2" />
              <path d="M12 7v4" />
              <line x1="8" x2="8" y1="16" y2="16" />
              <line x1="16" x2="16" y1="16" y2="16" />
            </svg>
            <h2 className="text-[18px] font-bold" style={{ color: "#f1f5f9" }}>Set Up Your Selling Agent</h2>
          </div>
          <p className="text-[13px] mb-6" style={{ color: "#94a3b8" }}>
            Your AI will handle buyer negotiations automatically. Choose a style and customize its approach.
          </p>

          <div className="grid gap-7" style={{ gridTemplateColumns: "1fr 300px" }}>
            {/* Left: Agent cards */}
            <div>
              <div className="grid grid-cols-2 gap-3 mb-5">
                {AGENT_PRESETS.map((agent) => {
                  const isSelected = selectedAgent?.id === agent.id;
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => {
                        setSelectedAgent(agent);
                        track("Seller Agent Selected", { agent_preset: agent.id, draft_id: draftId });
                      }}
                      className="flex cursor-pointer flex-col rounded-xl border p-4 text-left transition-all"
                      style={{
                        background: "#111827",
                        borderColor: isSelected ? "#06b6d4" : "#1e293b",
                        boxShadow: isSelected ? "0 0 0 1px #06b6d4, 0 0 20px rgba(6,182,212,0.08)" : "none",
                      }}
                      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.borderColor = "#334155"; }}
                      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.borderColor = "#1e293b"; }}
                    >
                      {/* Fixed-height header so titles align across cards */}
                      <div className="flex items-start gap-[10px] mb-[10px] h-[52px]">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `${agent.accentColor}22`, color: agent.accentColor }}>
                          {agent.id === "gatekeeper" && (
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                            </svg>
                          )}
                          {agent.id === "diplomat" && (
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M18 8h1a4 4 0 0 1 0 8h-1" /><path d="M6 8H5a4 4 0 0 0 0 8h1" /><path d="M8 6v12" /><path d="M16 6v12" />
                            </svg>
                          )}
                          {agent.id === "storyteller" && (
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z" />
                            </svg>
                          )}
                          {agent.id === "dealmaker" && (
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
                            </svg>
                          )}
                        </span>
                        <div>
                          <p className="text-[14px] font-semibold" style={{ color: "#f1f5f9", lineHeight: 1.2 }}>{agent.name}</p>
                          <p className="text-[12px] font-medium mt-[2px]" style={{ color: "#06b6d4", lineHeight: 1.3 }}>{agent.tagline}</p>
                        </div>
                      </div>
                      <p className="text-[12px] leading-[1.5]" style={{ color: "#94a3b8" }}>{agent.description}</p>
                    </button>
                  );
                })}
              </div>

              {/* Chat Placeholder — matches widget */}
              <div className="mt-4 rounded-xl border overflow-hidden" style={{ borderColor: "#1e293b", background: "#0f172a" }}>
                <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: "1px solid #1e293b" }}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#06b6d4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="18" height="10" x="3" y="11" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" />
                  </svg>
                  <span className="text-[13px] font-semibold" style={{ color: "#06b6d4" }}>
                    {selectedAgent ? selectedAgent.name : "Selling Agent"}
                  </span>
                </div>
                <div className="px-4 py-4 text-[13px] leading-relaxed" style={{ color: "#94a3b8" }}>
                  <p>
                    Hi! I&apos;m your selling agent. I&apos;ll handle all price negotiations on your behalf — so you don&apos;t have to. Let me know how you&apos;d like me to approach this.
                  </p>
                  <p className="mt-3 italic" style={{ color: "#64748b" }}>
                    You can customize my approach below, or just pick a style and I&apos;ll run with it.
                  </p>
                </div>
                <div className="px-4 py-3 text-center text-[12px]" style={{ borderTop: "1px solid #1e293b", color: "#475569" }}>
                  Chat with your AI agent to fine-tune its negotiation strategy. Coming soon.
                </div>
              </div>
            </div>

            {/* Right: Agent Profile — matches widget exactly */}
            <div>
              <div className="sticky top-6">
                {/* Profile Header */}
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-[12px] font-bold tracking-[0.06em]" style={{ color: "#f1f5f9" }}>AGENT PROFILE</h3>
                  <span
                    className="whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-medium"
                    style={{
                      border: `1px solid ${selectedAgent ? "#06b6d4" : "#1e293b"}`,
                      color: selectedAgent ? "#06b6d4" : "#94a3b8",
                    }}
                  >
                    {!selectedAgent ? "No Agent" : "Default"}
                  </span>
                </div>

                {/* Pricing Summary Card */}
                <div className="mb-4 rounded-xl p-4" style={{ background: "#111827", border: "1px solid #1e293b" }}>
                  <div className="flex items-center gap-3 mb-1">
                    {photoPreview ? (
                      <img src={photoPreview} alt="" className="h-11 w-11 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="h-11 w-11 rounded-full shrink-0" style={{ background: "#1e293b" }} />
                    )}
                    <p className="text-[12px] font-semibold uppercase tracking-[0.04em] truncate" style={{ color: "#cbd5e1" }}>{title || "Untitled"}</p>
                  </div>
                  <p className="text-[22px] font-bold mb-1" style={{ color: "#10b981" }}>${Number(targetPrice || 0).toLocaleString()}</p>
                  <p className="text-[12px]" style={{ color: "#94a3b8" }}>Floor: ${Number(floorPrice || 0).toLocaleString()} (private)</p>
                </div>

                {/* Selected Agent Display */}
                {selectedAgent ? (
                  <div className="flex items-center gap-3 rounded-xl mb-5" style={{ padding: "14px 16px", background: "#111827", border: "1px solid #1e293b" }}>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `${selectedAgent.accentColor}22`, color: selectedAgent.accentColor }}>
                      {selectedAgent.id === "gatekeeper" && (
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                      )}
                      {selectedAgent.id === "diplomat" && (
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1" /><path d="M6 8H5a4 4 0 0 0 0 8h1" /><path d="M8 6v12" /><path d="M16 6v12" /></svg>
                      )}
                      {selectedAgent.id === "storyteller" && (
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z" /></svg>
                      )}
                      {selectedAgent.id === "dealmaker" && (
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></svg>
                      )}
                    </span>
                    <div>
                      <p className="text-[13px] font-semibold" style={{ color: "#f1f5f9" }}>{selectedAgent.name}</p>
                      <p className="text-[11px] mt-[1px]" style={{ color: "#94a3b8" }}>{selectedAgent.tagline}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2 rounded-xl mb-5" style={{ padding: "28px 16px", background: "#111827", border: "1px dashed #1e293b", color: "#94a3b8", fontSize: "13px" }}>
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4">
                      <rect width="18" height="10" x="3" y="11" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" />
                    </svg>
                    <p>Select an agent above</p>
                  </div>
                )}

                {/* Stat Bars */}
                <div className="flex flex-col gap-[14px] mb-6">
                  {STAT_META.map((stat) => {
                    const value = currentStats[stat.key];
                    return (
                      <div key={stat.key}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[12px] font-medium" style={{ color: "#cbd5e1" }}>{stat.label}</span>
                          <span className="text-[12px] font-semibold" style={{ color: "#f1f5f9" }}>{value}%</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-sm" style={{ background: "#0d1321" }}>
                          <div className="h-full rounded-sm" style={{ width: `${value}%`, background: stat.gradient, transition: "width 0.6s cubic-bezier(0.22, 1, 0.36, 1)" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Radar Chart */}
                <div className="rounded-xl mb-6" style={{ background: "#111827", border: "1px solid #1e293b", padding: "20px 16px" }}>
                  <p className="text-center text-[11px] font-bold tracking-[0.06em] mb-2" style={{ color: "#cbd5e1" }}>STRATEGY MATRIX</p>
                  <RadarChart stats={currentStats} />
                </div>

                {/* Publish button — inside right panel like widget */}
                <button
                  type="button"
                  onClick={handlePublish}
                  disabled={saving || !selectedAgent}
                  className="mt-7 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-none text-[15px] font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: "#10b981", padding: "14px 24px" }}
                  onMouseEnter={(e) => { if (!saving) e.currentTarget.style.background = "#059669"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "#10b981"; }}
                >
                  {saving ? "Publishing..." : "Publish & Get Share Link"}
                  {!saving && <span>→</span>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

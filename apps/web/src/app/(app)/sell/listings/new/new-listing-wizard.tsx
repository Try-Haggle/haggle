"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAmplitude } from "@/providers/amplitude-provider";
import { api } from "@/lib/api-client";
import { LISTING_CATEGORIES, LISTING_CATEGORY_LABELS } from "@haggle/shared";

/* ─── Constants ───────────────────────────────────────────── */

const CATEGORIES = LISTING_CATEGORIES.map((value) => ({
  value,
  label: LISTING_CATEGORY_LABELS[value],
}));

const CONDITIONS = [
  { value: "new", label: "New" },
  { value: "like_new", label: "Like New" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
  { value: "poor", label: "Poor" },
];

const TOTAL_STEPS = 5;

const STEP_TITLES = [
  "Add a photo",
  "Describe your item",
  "Categorize it",
  "Set your price",
  "Choose your AI agent",
];

const STEP_SUBTITLES = [
  "A clear photo helps buyers trust your listing.",
  "Give buyers the details they need to make a decision.",
  "Help buyers find your item faster.",
  "Set your asking price and negotiation floor.",
  "Pick a negotiation style for your AI agent.",
];

/* ─── Seller Agent Presets ────────────────────────────────── */

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
    stats: { priceAggression: 85, patienceLevel: 90, riskTolerance: 20, speedBias: 30, detailFocus: 75 },
  },
  {
    id: "diplomat",
    name: "The Diplomat",
    tagline: "Meets buyers halfway. Closes more.",
    description:
      "Balances getting a fair price with closing deals. Adapts to the buyer's style.",
    accentColor: "#f59e0b",
    stats: { priceAggression: 55, patienceLevel: 70, riskTolerance: 50, speedBias: 50, detailFocus: 60 },
  },
  {
    id: "storyteller",
    name: "The Storyteller",
    tagline: "Sells the value, not just the price.",
    description:
      "Emphasizes condition, accessories, and item value to justify the price rather than just discounting.",
    accentColor: "#a855f7",
    stats: { priceAggression: 60, patienceLevel: 80, riskTolerance: 35, speedBias: 25, detailFocus: 95 },
  },
  {
    id: "dealmaker",
    name: "The Dealmaker",
    tagline: "Fast deals. Done. Move on.",
    description:
      "Prioritizes closing quickly. Willing to give modest discounts for a quick, committed buyer.",
    accentColor: "#eab308",
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
  const SIZE = 220;
  const CENTER = SIZE / 2;
  const RADIUS = 75;
  const LABEL_OFFSET = 22;
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
      const ease = 1 - Math.pow(1 - t, 3);
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
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="mx-auto block w-full max-w-[200px]">
      {GRID_LEVELS.map((level) => (
        <polygon key={level} points={gridPolygon(level)} fill="none" stroke="rgba(148,163,184,0.25)" strokeWidth="1" />
      ))}
      {Array.from({ length: 5 }, (_, i) => {
        const [x, y] = vertex(i, RADIUS);
        return <line key={i} x1={CENTER} y1={CENTER} x2={x} y2={y} stroke="rgba(148,163,184,0.15)" strokeWidth="1" />;
      })}
      <polygon points={polygonPoints(display)} fill="rgba(6,182,212,0.12)" stroke="rgba(6,182,212,0.7)" strokeWidth="2" strokeLinejoin="round" />
      {display.map((v, i) => { const [x, y] = vertex(i, (v / 100) * RADIUS); return <circle key={i} cx={x} cy={y} r="3" fill="#06b6d4" />; })}
      {RADAR_LABELS.map((label, i) => {
        const [x, y] = vertex(i, RADIUS + LABEL_OFFSET);
        return <text key={label} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fill="#94a3b8" fontSize="10" style={{ fontFamily: "inherit" }}>{label}</text>;
      })}
    </svg>
  );
}

/* ─── Agent Icon ──────────────────────────────────────────── */

function AgentIcon({ id, size = 18 }: { id: string; size?: number }) {
  const props = { viewBox: "0 0 24 24", width: size, height: size, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (id) {
    case "gatekeeper":
      return <svg {...props}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>;
    case "diplomat":
      return <svg {...props}><path d="M18 8h1a4 4 0 0 1 0 8h-1" /><path d="M6 8H5a4 4 0 0 0 0 8h1" /><path d="M8 6v12" /><path d="M16 6v12" /></svg>;
    case "storyteller":
      return <svg {...props}><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z" /></svg>;
    case "dealmaker":
      return <svg {...props}><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></svg>;
    default:
      return null;
  }
}

/* ─── Draft types ─────────────────────────────────────────── */

interface DraftData {
  id: string;
  currentStep: number;
  draftName: string | null;
  title: string | null;
  description: string | null;
  tags: string[] | null;
  category: string | null;
  condition: string | null;
  photoUrl: string | null;
  targetPrice: string | null;
  floorPrice: string | null;
  sellingDeadline: string | null;
  strategyConfig: Record<string, unknown> | null;
}

/* ─── Main Wizard ─────────────────────────────────────────── */

const STEP_NAMES = ["photo", "details", "category", "pricing", "agent"] as const;

export function NewListingWizard({ userId, resumeDraftId }: { userId: string; resumeDraftId?: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { track } = useAmplitude();

  // Wizard state
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!resumeDraftId);
  const [showExitModal, setShowExitModal] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftCount, setDraftCount] = useState<number | null>(null);

  // Step 1: Photo
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // Step 2: Title & Description
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  // Step 3: Category, Condition, Tags
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [tagEditing, setTagEditing] = useState(false);
  const tagFieldRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState("electronics");
  const [condition, setCondition] = useState("good");

  // Step 4: Pricing
  const [targetPrice, setTargetPrice] = useState("");
  const [floorPrice, setFloorPrice] = useState("");
  const [sellingDeadline, setSellingDeadline] = useState("");

  // Step 5: Agent
  const [selectedAgent, setSelectedAgent] = useState<AgentPreset | null>(null);

  // Published state
  const [publishResult, setPublishResult] = useState<{
    publicId: string;
    shareUrl: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const currentStats = selectedAgent?.stats ?? DEFAULT_STATS;

  // Format helpers
  const formatWithCommas = (v: string) => {
    if (!v) return "";
    const n = parseInt(v, 10);
    return isNaN(n) ? v : n.toLocaleString();
  };
  const handlePriceChange = (raw: string, setter: (v: string) => void) => {
    setter(raw.replace(/[^0-9]/g, ""));
  };

  const today = new Date().toISOString().split("T")[0];

  /* ─── Resume draft ─────────────────────────────────────── */

  useEffect(() => {
    if (!resumeDraftId) return;
    (async () => {
      try {
        const data = await api.get<{ ok: boolean; draft: DraftData }>(`/api/drafts/${resumeDraftId}`);
        if (!data.ok || !data.draft) { setLoading(false); return; }
        const d = data.draft;
        setDraftId(d.id);
        setStep(d.currentStep || 1);
        if (d.title) setTitle(d.title);
        if (d.description) setDescription(d.description);
        if (d.tags) setTags(d.tags);
        if (d.category) setCategory(d.category);
        if (d.condition) setCondition(d.condition);
        if (d.photoUrl) { setPhotoUrl(d.photoUrl); setPhotoPreview(d.photoUrl); }
        if (d.targetPrice) setTargetPrice(String(Math.round(Number(d.targetPrice))));
        if (d.floorPrice) setFloorPrice(String(Math.round(Number(d.floorPrice))));
        if (d.sellingDeadline) setSellingDeadline(new Date(d.sellingDeadline).toISOString().split("T")[0]);
        if (d.draftName) setDraftName(d.draftName);
        if (d.strategyConfig?.preset) {
          const preset = AGENT_PRESETS.find((a) => a.id === d.strategyConfig!.preset);
          if (preset) setSelectedAgent(preset);
        }
      } catch { /* start fresh */ } finally { setLoading(false); }
    })();
  }, [resumeDraftId]);

  /* ─── Amplitude ─────────────────────────────────────────── */

  const wizardTracked = useRef(false);
  const lastTrackedStep = useRef<number | null>(null);
  useEffect(() => {
    if (loading) return;
    if (!wizardTracked.current) {
      track("Listing Wizard Started", { source: resumeDraftId ? "resume" : "direct" });
      wizardTracked.current = true;
    }
    if (lastTrackedStep.current !== step) {
      track("Listing Wizard Step Viewed", { step_index: step, step_name: STEP_NAMES[step - 1], draft_id: draftId });
      lastTrackedStep.current = step;
    }
  }, [step, loading]);

  /* ─── Photo handling ────────────────────────────────────── */

  function processFile(file: File) {
    if (!file.type.match(/^image\/(png|jpeg|webp)$/)) { setError("Only PNG, JPG or WebP files are accepted"); return; }
    if (file.size > 5 * 1024 * 1024) { setError("Photo must be under 5 MB"); return; }
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
    setPhotoUrl(null);
    setError(null);
  }

  function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
  }

  async function uploadPhoto(dId: string): Promise<string | null> {
    if (!photoFile) return photoUrl;
    if (photoUrl) return photoUrl;
    try {
      const compressed = await compressImage(photoFile);
      const supabase = createClient();
      const path = `${dId}/${Date.now()}.jpg`;
      const { error: uploadErr } = await supabase.storage.from("listing-photos").upload(path, compressed, { contentType: "image/jpeg", upsert: true });
      if (uploadErr) throw uploadErr;
      const { data } = supabase.storage.from("listing-photos").getPublicUrl(path);
      setPhotoUrl(data.publicUrl);
      return data.publicUrl;
    } catch (err: unknown) {
      setError(`Photo upload failed: ${err instanceof Error ? err.message : "Upload failed"}`);
      return null;
    }
  }

  /* ─── API helpers ───────────────────────────────────────── */

  async function ensureDraft(): Promise<string | null> {
    if (draftId) return draftId;
    try {
      const data = await api.post<{ ok: boolean; draft: { id: string } }>("/api/drafts", { userId });
      if (!data.ok) { setError("Failed to create draft"); return null; }
      setDraftId(data.draft.id);
      return data.draft.id;
    } catch { setError("Failed to create draft"); return null; }
  }

  async function patchDraft(id: string, patch: Record<string, unknown>) {
    try {
      const data = await api.patch<{ ok: boolean }>(`/api/drafts/${id}`, { ...patch, userId });
      if (!data.ok) { setError("Failed to save changes"); return false; }
      return true;
    } catch { setError("Failed to save changes"); return false; }
  }

  /* ─── Build current patch from all form data ───────────── */

  function buildFullPatch(url?: string | null): Record<string, unknown> {
    const patch: Record<string, unknown> = { currentStep: step };
    if (title.trim()) patch.title = title.trim();
    if (description.trim()) patch.description = description.trim();
    if (tags.length > 0) patch.tags = tags;
    patch.category = category;
    patch.condition = condition;
    if (url ?? photoUrl) patch.photoUrl = url ?? photoUrl;
    if (targetPrice.trim()) patch.targetPrice = targetPrice.trim();
    if (floorPrice.trim()) patch.floorPrice = floorPrice.trim();
    if (sellingDeadline) patch.sellingDeadline = new Date(sellingDeadline).toISOString();
    if (selectedAgent) patch.strategyConfig = { preset: selectedAgent.id, ...selectedAgent.stats };
    return patch;
  }

  /* ─── Exit modal ─────────────────────────────────────────── */

  async function handleExitClick() {
    // New listing → fetch count for auto-increment name
    if (!resumeDraftId && draftCount === null) {
      try {
        const data = await api.get<{ ok: boolean; drafts: { id: string }[] }>("/api/drafts");
        const count = data.ok ? data.drafts.length : 0;
        setDraftCount(count);
        if (!draftName) setDraftName(`Draft ${count + 1}`);
      } catch {
        setDraftCount(0);
        if (!draftName) setDraftName("Draft 1");
      }
    }
    setShowExitModal(true);
  }

  async function handleSaveDraft() {
    setSaving(true);
    setError(null);
    try {
      const id = await ensureDraft();
      if (!id) return;
      let url = photoUrl;
      if (photoFile && !photoUrl) url = await uploadPhoto(id);
      const patch = buildFullPatch(url);
      patch.draftName = draftName.trim() || `Draft ${(draftCount ?? 0) + 1}`;
      const ok = await patchDraft(id, patch);
      if (ok) { track("Listing Draft Saved", { draft_id: id, step, draft_name: patch.draftName }); router.push("/sell/dashboard"); }
    } finally { setSaving(false); }
  }

  function handleDiscard() {
    router.push("/sell/dashboard");
  }

  /* ─── Tag input ─────────────────────────────────────────── */

  function handleTagKeyDown(e: React.KeyboardEvent) {
    if (e.nativeEvent.isComposing) return;
    if ((e.key === "Enter" || e.key === ",") && tagInput.trim()) {
      e.preventDefault();
      const tag = tagInput.trim().replace(",", "");
      if (tag && !tags.includes(tag)) setTags([...tags, tag]);
      setTagInput("");
    }
    if (e.key === "Backspace" && !tagInput && tags.length > 0) setTags(tags.slice(0, -1));
  }

  /* ─── Step validation ───────────────────────────────────── */

  function canProceed(): boolean {
    switch (step) {
      case 1: return !!(photoFile || photoUrl);
      case 2: return !!title.trim();
      case 3: return true; // category/condition have defaults
      case 4: return !!targetPrice.trim() && !!sellingDeadline;
      case 5: return !!selectedAgent;
      default: return false;
    }
  }

  function validateStep(): string | null {
    switch (step) {
      case 1: if (!photoFile && !photoUrl) return "Please add a photo"; break;
      case 2: if (!title.trim()) return "Title is required"; break;
      case 4:
        if (!targetPrice.trim()) return "Asking price is required";
        if (!sellingDeadline) return "Selling deadline is required";
        break;
      case 5: if (!selectedAgent) return "Please select an agent"; break;
    }
    return null;
  }

  /* ─── Navigation ────────────────────────────────────────── */

  async function handleNext() {
    const err = validateStep();
    if (err) { setError(err); return; }

    setSaving(true);
    setError(null);

    try {
      const id = await ensureDraft();
      if (!id) return;

      // Upload photo on step 1
      if (step === 1 && photoFile && !photoUrl) {
        const url = await uploadPhoto(id);
        if (!url) return;
      }

      // Save current state
      const ok = await patchDraft(id, { ...buildFullPatch(), currentStep: step + 1 });
      if (ok) setStep(step + 1);
    } finally {
      setSaving(false);
    }
  }

  function handleBack() {
    setError(null);
    if (step === 1) {
      router.push("/sell/dashboard");
    } else {
      setStep(step - 1);
    }
  }

  /* ─── Publish ───────────────────────────────────────────── */

  async function handlePublish() {
    const err = validateStep();
    if (err) { setError(err); return; }

    setSaving(true);
    setError(null);

    try {
      let ok = await patchDraft(draftId!, {
        strategyConfig: { preset: selectedAgent!.id, ...selectedAgent!.stats },
      });
      if (!ok) return;

      const data = await api.post<{
        ok: boolean;
        publicId?: string;
        shareUrl?: string;
        errors?: { message: string; step: number }[];
        error?: string;
      }>(`/api/drafts/${draftId}/publish`, { userId }).catch(() => null);

      if (!data) { setError("Failed to publish"); return; }
      if (!data.ok) {
        if (data.errors) { setError(data.errors[0].message); setStep(data.errors[0].step); }
        else setError(data.error || "Failed to publish");
        return;
      }

      track("Listing Published", {
        draft_id: draftId, public_id: data.publicId, category, condition,
        has_photo: !!photoUrl, has_floor_price: !!floorPrice, agent_preset: selectedAgent!.id,
      });
      setPublishResult({ publicId: data.publicId!, shareUrl: data.shareUrl! });
    } finally { setSaving(false); }
  }

  /* ─── Loading ───────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "#0a0f1a" }}>
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-slate-600 border-t-cyan-500" />
          <p className="text-sm text-slate-400">Loading draft...</p>
        </div>
      </div>
    );
  }

  /* ─── Published Screen ──────────────────────────────────── */

  if (publishResult) {
    const formatPrice = (v: string) => {
      const n = parseFloat(v);
      return isNaN(n) ? "$0" : `$${n.toLocaleString()}`;
    };

    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center px-4" style={{ background: "#0a0f1a" }}>
        <div className="w-full max-w-lg text-center">
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

          <h2 className="text-2xl font-bold mb-2" style={{ color: "#f1f5f9" }}>Your listing is live!</h2>
          <p className="mx-auto mb-8 max-w-sm text-sm leading-relaxed" style={{ color: "#94a3b8" }}>
            Share the link below. Buyers will negotiate with your AI agent automatically.
          </p>

          {/* Item Summary */}
          <div className="flex items-center gap-4 rounded-xl text-left mb-8" style={{ padding: "18px 20px", background: "#111827", border: "1px solid #1e293b" }}>
            {photoPreview ? (
              <img src={photoPreview} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
            ) : (
              <div className="h-14 w-14 shrink-0 rounded-lg" style={{ background: "#1e293b" }} />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: "#f1f5f9" }}>{title || "Untitled"}</p>
              <p className="text-xl font-bold mt-0.5" style={{ color: "#f1f5f9" }}>{formatPrice(targetPrice)}</p>
              {selectedAgent && (
                <p className="flex items-center gap-1.5 text-xs mt-1" style={{ color: "#10b981" }}>
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: selectedAgent.accentColor }} />
                  Agent: {selectedAgent.name}
                </p>
              )}
            </div>
          </div>

          {/* Share Link */}
          <p className="mb-2.5 text-left text-xs font-bold tracking-widest" style={{ color: "#94a3b8" }}>YOUR HAGGLE LINK</p>
          <div className="flex items-center gap-3 rounded-xl mb-6" style={{ padding: "16px 18px", background: "#111827", border: "1px solid #1e293b" }}>
            <svg className="shrink-0" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <span className="flex-1 truncate text-left text-sm" style={{ color: "#f1f5f9" }}>{publishResult.shareUrl}</span>
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
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={() => router.push("/sell/dashboard")}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-none text-sm font-semibold text-white transition-colors"
            style={{ background: "#10b981", padding: "14px 24px" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#059669"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#10b981"; }}
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  /* ─── Questionnaire Layout ──────────────────────────────── */

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "#0a0f1a" }}>
      <style>{`
        @keyframes wizard-step-in {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes modal-overlay-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes modal-content-in {
          from { opacity: 0; transform: scale(0.95) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>

      {/* ── Exit Modal ── */}
      {showExitModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center px-4"
          style={{ animation: "modal-overlay-in 0.2s ease-out" }}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0"
            style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
            onClick={() => setShowExitModal(false)}
          />

          {/* Modal */}
          <div
            className="relative w-full max-w-sm rounded-2xl p-6"
            style={{
              background: "#111827",
              border: "1px solid #1e293b",
              boxShadow: "0 25px 50px rgba(0,0,0,0.5)",
              animation: "modal-content-in 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-lg font-semibold" style={{ color: "#f1f5f9" }}>
                Save as draft?
              </h3>
              <button
                type="button"
                onClick={() => setShowExitModal(false)}
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full transition-colors"
                style={{ color: "#64748b" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(148,163,184,0.1)"; e.currentTarget.style.color = "#f1f5f9"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#64748b"; }}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
              </button>
            </div>
            <p className="text-sm mb-5" style={{ color: "#64748b" }}>
              You can resume this listing anytime from your dashboard.
            </p>

            {/* Draft name input — only for new drafts */}
            {!resumeDraftId && (
              <>
                <label className="block text-xs font-medium mb-2" style={{ color: "#94a3b8" }}>
                  Draft name
                </label>
                <input
                  type="text"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="Draft 1"
                  autoFocus
                  className="mb-6 w-full rounded-xl border px-4 py-2.5 text-sm outline-none transition-colors"
                  style={{ background: "#0a0f1a", borderColor: "#1e293b", color: "#f1f5f9" }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "#06b6d4")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "#1e293b")}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveDraft(); }}
                />
              </>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleDiscard}
                className="flex-1 cursor-pointer rounded-xl border py-2.5 text-sm font-medium transition-colors"
                style={{ borderColor: "#1e293b", color: "#94a3b8", background: "transparent" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#334155"; e.currentTarget.style.color = "#f1f5f9"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1e293b"; e.currentTarget.style.color = "#94a3b8"; }}
              >
                Exit
              </button>
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={saving}
                className="flex-1 cursor-pointer rounded-xl border-none py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-40"
                style={{ background: "#06b6d4" }}
                onMouseEnter={(e) => { if (!saving) e.currentTarget.style.background = "#0891b2"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "#06b6d4"; }}
              >
                {saving ? "Saving..." : "Save Draft"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Progress bar — pinned to top edge ── */}
      <div className="absolute top-0 left-0 right-0 z-10 h-[3px]" style={{ background: "rgba(30,41,59,0.5)" }}>
        <div
          className="h-full rounded-r-full transition-all duration-700 ease-out"
          style={{
            width: `${(step / TOTAL_STEPS) * 100}%`,
            background: "linear-gradient(90deg, #06b6d4, #22d3ee)",
            boxShadow: "0 0 12px rgba(6,182,212,0.4)",
          }}
        />
      </div>

      {/* ── Close button — top right ── */}
      <div className="absolute top-4 right-5 z-10 sm:top-5 sm:right-8">
        <button
          type="button"
          onClick={handleExitClick}
          disabled={saving}
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border transition-all disabled:opacity-40"
          style={{ borderColor: "#1e293b", color: "#64748b", background: "rgba(10,15,26,0.8)", backdropFilter: "blur(8px)" }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#334155"; e.currentTarget.style.color = "#f1f5f9"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1e293b"; e.currentTarget.style.color = "#64748b"; }}
          title="Save & Exit"
        >
          {saving ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-cyan-500" />
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          )}
        </button>
      </div>

      {/* ── Scrollable content area — vertically centered ── */}
      <div className="flex-1 overflow-y-auto px-5 sm:px-8">
        <div className="flex min-h-full flex-col justify-center">
        <div
          key={step}
          className="mx-auto w-full max-w-lg py-10 sm:py-16"
          style={{
            animation: "wizard-step-in 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          {/* Step title & subtitle */}
          <div className="mb-10">
            <h1 className="text-2xl sm:text-3xl font-bold mb-3 tracking-tight" style={{ color: "#f1f5f9" }}>
              {STEP_TITLES[step - 1]}
            </h1>
            <p className="text-sm sm:text-base" style={{ color: "#525e6f" }}>
              {STEP_SUBTITLES[step - 1]}
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {/* ── STEP 1: Photo ── */}
          {step === 1 && (
            <div>
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
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  className="group relative aspect-square w-full cursor-pointer overflow-hidden rounded-2xl border-2 border-dashed transition-colors"
                  style={{ borderColor: dragging ? "#06b6d4" : "#334155" }}
                  onMouseEnter={(e) => { if (!dragging) e.currentTarget.style.borderColor = "#06b6d4"; }}
                  onMouseLeave={(e) => { if (!dragging) e.currentTarget.style.borderColor = "#334155"; }}
                >
                  <img src={photoPreview} alt="Preview" className="h-full w-full object-cover" />
                  <div className={`absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 transition-opacity ${dragging ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" x2="12" y1="3" y2="15" />
                    </svg>
                    <span className="text-sm font-medium text-white">{dragging ? "Drop to replace" : "Change photo"}</span>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  className="mx-auto flex aspect-square w-full max-w-lg cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed transition-colors"
                  style={{ borderColor: dragging ? "#06b6d4" : "#334155", color: dragging ? "#06b6d4" : "#94a3b8" }}
                  onMouseEnter={(e) => { if (!dragging) { e.currentTarget.style.borderColor = "#06b6d4"; } }}
                  onMouseLeave={(e) => { if (!dragging) { e.currentTarget.style.borderColor = "#334155"; e.currentTarget.style.color = "#94a3b8"; } }}
                >
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: dragging ? 0.8 : 0.4 }}>
                    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                    <circle cx="9" cy="9" r="2" />
                    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                  </svg>
                  <span className="text-sm">{dragging ? "Drop your photo here" : "Click or drag a photo here"}</span>
                  <span className="text-xs" style={{ color: "#475569" }}>PNG, JPG or WebP · Max 5 MB</span>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 2: Title & Description ── */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider" style={{ color: "#94a3b8" }}>
                  Title <span style={{ color: "#f97316" }}>*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => { setTitle(e.target.value); if (error) setError(null); }}
                  placeholder="e.g. MacBook Pro M3, 14 inch"
                  autoFocus
                  className="w-full rounded-xl border px-4 py-3 text-sm outline-none transition-colors"
                  style={{ background: "#0f172a", borderColor: "#1e293b", color: "#f1f5f9" }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "#06b6d4")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "#1e293b")}
                />
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider" style={{ color: "#94a3b8" }}>
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe key features, specs, included accessories, reason for selling..."
                  rows={4}
                  className="w-full resize-y rounded-xl border px-4 py-3 text-sm outline-none transition-colors"
                  style={{ background: "#0f172a", borderColor: "#1e293b", color: "#f1f5f9" }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "#06b6d4")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "#1e293b")}
                />
              </div>
            </div>
          )}

          {/* ── STEP 3: Category, Condition, Tags ── */}
          {step === 3 && (
            <div className="space-y-8">
              {/* Category */}
              <div>
                <label className="mb-3 block text-xs font-semibold uppercase tracking-wider" style={{ color: "#94a3b8" }}>
                  Category
                </label>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setCategory(c.value)}
                      className="cursor-pointer rounded-full border px-5 py-2.5 text-sm font-medium transition-all"
                      style={{
                        background: category === c.value ? "rgba(6,182,212,0.08)" : "transparent",
                        borderColor: category === c.value ? "#06b6d4" : "#1e293b",
                        color: category === c.value ? "#06b6d4" : "#94a3b8",
                      }}
                      onMouseEnter={(e) => { if (category !== c.value) { e.currentTarget.style.borderColor = "#334155"; e.currentTarget.style.color = "#f1f5f9"; } }}
                      onMouseLeave={(e) => { if (category !== c.value) { e.currentTarget.style.borderColor = "#1e293b"; e.currentTarget.style.color = "#94a3b8"; } }}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Condition */}
              <div>
                <label className="mb-3 block text-xs font-semibold uppercase tracking-wider" style={{ color: "#94a3b8" }}>
                  Condition
                </label>
                <div className="flex flex-wrap gap-2">
                  {CONDITIONS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setCondition(c.value)}
                      className="cursor-pointer rounded-full border px-5 py-2.5 text-sm font-medium transition-all"
                      style={{
                        background: condition === c.value ? "rgba(6,182,212,0.08)" : "transparent",
                        borderColor: condition === c.value ? "#06b6d4" : "#1e293b",
                        color: condition === c.value ? "#06b6d4" : "#94a3b8",
                      }}
                      onMouseEnter={(e) => { if (condition !== c.value) { e.currentTarget.style.borderColor = "#334155"; e.currentTarget.style.color = "#f1f5f9"; } }}
                      onMouseLeave={(e) => { if (condition !== c.value) { e.currentTarget.style.borderColor = "#1e293b"; e.currentTarget.style.color = "#94a3b8"; } }}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tags */}
              <div>
                <label className="mb-3 block text-xs font-semibold uppercase tracking-wider" style={{ color: "#94a3b8" }}>
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
                        if (tagInput.trim()) { const tag = tagInput.trim(); if (!tags.includes(tag)) setTags([...tags, tag]); }
                        setTagInput("");
                        setTagEditing(false);
                      }}
                      placeholder="tag name..."
                      className="h-9 w-28 rounded-full border px-4 text-sm outline-none"
                      style={{ background: "#0f172a", borderColor: "#06b6d4", color: "#f1f5f9" }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setTagEditing(true); setTimeout(() => tagFieldRef.current?.focus(), 0); }}
                      className="flex h-9 cursor-pointer items-center gap-1 rounded-full border border-dashed border-slate-700 px-4 text-sm text-slate-500 transition-colors hover:border-cyan-500 hover:text-cyan-400 hover:bg-cyan-500/5"
                    >
                      <span>+</span> <span>Add tag</span>
                    </button>
                  )}
                  {tags.map((tag, i) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setTags(tags.filter((_, idx) => idx !== i))}
                      className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800 px-4 text-sm text-slate-100 transition-colors hover:border-red-500/50 hover:text-red-300"
                    >
                      {tag}
                      <span className="text-base opacity-50">×</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 4: Pricing ── */}
          {step === 4 && (
            <div className="space-y-6">
              {/* Asking price */}
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider" style={{ color: "#94a3b8" }}>
                  Asking Price <span style={{ color: "#f97316" }}>*</span>
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm" style={{ color: "#64748b" }}>$</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formatWithCommas(targetPrice)}
                    onChange={(e) => handlePriceChange(e.target.value, setTargetPrice)}
                    placeholder="0"
                    autoFocus
                    className="w-full rounded-xl border py-3 pl-8 pr-4 text-sm outline-none transition-colors"
                    style={{ background: "#0f172a", borderColor: "#1e293b", color: "#f1f5f9" }}
                    onFocus={(e) => { e.target.style.borderColor = "#06b6d4"; }}
                    onBlur={(e) => { e.target.style.borderColor = "#1e293b"; }}
                  />
                </div>
                <p className="mt-1.5 text-xs" style={{ color: "#475569" }}>The starting price buyers will see</p>
              </div>

              {/* Floor price */}
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider" style={{ color: "#94a3b8" }}>
                  Minimum Acceptable Price{" "}
                  <span className="font-normal normal-case tracking-normal" style={{ color: "#475569" }}>(private)</span>
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm" style={{ color: "#64748b" }}>$</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formatWithCommas(floorPrice)}
                    onChange={(e) => handlePriceChange(e.target.value, setFloorPrice)}
                    placeholder="0"
                    className="w-full rounded-xl border py-3 pl-8 pr-4 text-sm outline-none transition-colors"
                    style={{ background: "#0f172a", borderColor: "#1e293b", color: "#f1f5f9" }}
                    onFocus={(e) => { e.target.style.borderColor = "#06b6d4"; }}
                    onBlur={(e) => { e.target.style.borderColor = "#1e293b"; }}
                  />
                </div>
                <p className="mt-1.5 text-xs" style={{ color: "#475569" }}>Your AI agent will never agree below this price</p>
              </div>

              {/* Selling deadline */}
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider" style={{ color: "#94a3b8" }}>
                  Selling Deadline <span style={{ color: "#f97316" }}>*</span>
                </label>
                <input
                  type="date"
                  min={today}
                  value={sellingDeadline}
                  onChange={(e) => setSellingDeadline(e.target.value)}
                  className="w-full cursor-pointer rounded-xl border px-4 py-3 text-sm outline-none transition-colors"
                  style={{ background: "#0f172a", borderColor: "#1e293b", color: "#f1f5f9", colorScheme: "dark" }}
                  onFocus={(e) => { e.target.style.borderColor = "#06b6d4"; }}
                  onBlur={(e) => { e.target.style.borderColor = "#1e293b"; }}
                />
                <p className="mt-1.5 text-xs" style={{ color: "#475569" }}>Your AI agent becomes more flexible as the deadline approaches</p>
              </div>
            </div>
          )}

          {/* ── STEP 5: Agent ── */}
          {step === 5 && (
            <div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
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
                        background: isSelected ? "rgba(6,182,212,0.05)" : "#111827",
                        borderColor: isSelected ? "#06b6d4" : "#1e293b",
                        boxShadow: isSelected ? "0 0 0 1px #06b6d4" : "none",
                      }}
                      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.borderColor = "#334155"; }}
                      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.borderColor = "#1e293b"; }}
                    >
                      <div className="flex items-start gap-3 mb-2.5">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `${agent.accentColor}18`, color: agent.accentColor }}>
                          <AgentIcon id={agent.id} />
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold" style={{ color: "#f1f5f9" }}>{agent.name}</p>
                          <p className="text-xs font-medium mt-0.5" style={{ color: "#06b6d4" }}>{agent.tagline}</p>
                        </div>
                      </div>
                      <p className="text-xs leading-relaxed" style={{ color: "#94a3b8" }}>{agent.description}</p>
                    </button>
                  );
                })}
              </div>

              {/* Agent profile panel */}
              {selectedAgent && (
                <div className="rounded-xl p-5" style={{ background: "#111827", border: "1px solid #1e293b" }}>
                  <div className="flex items-center gap-3 mb-5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `${selectedAgent.accentColor}18`, color: selectedAgent.accentColor }}>
                      <AgentIcon id={selectedAgent.id} size={16} />
                    </span>
                    <div>
                      <p className="text-sm font-semibold" style={{ color: "#f1f5f9" }}>{selectedAgent.name}</p>
                      <p className="text-xs mt-px" style={{ color: "#94a3b8" }}>{selectedAgent.tagline}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    {/* Stat bars */}
                    <div className="flex flex-col gap-3">
                      {STAT_META.map((stat) => {
                        const value = currentStats[stat.key];
                        return (
                          <div key={stat.key}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-medium" style={{ color: "#94a3b8" }}>{stat.label}</span>
                              <span className="text-xs font-semibold" style={{ color: "#f1f5f9" }}>{value}%</span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-sm" style={{ background: "#0d1321" }}>
                              <div className="h-full rounded-sm" style={{ width: `${value}%`, background: stat.gradient, transition: "width 0.6s cubic-bezier(0.22, 1, 0.36, 1)" }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Radar chart */}
                    <div className="flex items-center justify-center">
                      <RadarChart stats={currentStats} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        </div>
      </div>

      {/* ── Bottom bar: Back / Next ── */}
      <div className="shrink-0 px-4 pb-3 pt-2 sm:px-8 sm:pb-6 sm:pt-3" style={{ borderTop: "1px solid #1e293b" }}>
        <div className="mx-auto flex max-w-lg items-center justify-between gap-4">
          {/* Back (hidden on step 1) */}
          {step > 1 ? (
            <button
              type="button"
              onClick={handleBack}
              className="flex w-24 sm:w-28 cursor-pointer items-center justify-center gap-1 sm:gap-1.5 rounded-xl border py-2.5 sm:py-3 text-xs sm:text-sm font-semibold transition-colors"
              style={{ borderColor: "#1e293b", color: "#94a3b8" }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#334155"; e.currentTarget.style.color = "#f1f5f9"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1e293b"; e.currentTarget.style.color = "#94a3b8"; }}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m15 18-6-6 6-6" /></svg>
              Back
            </button>
          ) : (
            <div />
          )}

          {/* Next / Publish */}
          {step < TOTAL_STEPS ? (
            <button
              type="button"
              onClick={handleNext}
              disabled={saving || !canProceed()}
              className="flex w-24 sm:w-28 cursor-pointer items-center justify-center gap-1 sm:gap-1.5 rounded-xl border-none py-2.5 sm:py-3 text-xs sm:text-sm font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "#06b6d4" }}
              onMouseEnter={(e) => { if (!saving && canProceed()) e.currentTarget.style.background = "#0891b2"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#06b6d4"; }}
            >
              {saving ? "Saving..." : "Next"}
              {!saving && (
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m9 18 6-6-6-6" /></svg>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePublish}
              disabled={saving || !selectedAgent}
              className="flex w-24 sm:w-28 cursor-pointer items-center justify-center gap-2 rounded-xl border-none py-2.5 sm:py-3 text-xs sm:text-sm font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "#10b981" }}
              onMouseEnter={(e) => { if (!saving) e.currentTarget.style.background = "#059669"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#10b981"; }}
            >
              {saving ? "Publishing..." : "Submit"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

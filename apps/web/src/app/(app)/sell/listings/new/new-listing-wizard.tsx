"use client";

import {
  type AgentBuilderState,
  applyChatStrategyToState,
  createBuilderState,
  engineParamsFromPreset,
  isBuilderCustomized,
  LISTING_CATEGORIES,
  LISTING_CATEGORY_LABELS,
  type NegotiationAgentPresetId,
  resolveChecks,
  resolveEffectivePreset,
} from "@haggle/shared";
import { ChevronLeft, ChevronRight, Link2, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  NegotiationAgentBuilderChat,
  type NegotiationAgentBuilderMemory,
} from "@/app/l/[publicId]/negotiation-agent-builder-chat";
import { FulfillmentOfferEditor } from "@/components/shipping/fulfillment-offer-editor";
import { ListingParcelFields } from "@/components/shipping/listing-parcel-fields";
import {
  Alert,
  Button,
  Chip,
  CopyButton,
  Dropzone,
  IconButton,
  Input,
  Modal,
  Spinner,
  Textarea,
} from "@/components/ui";
import { api } from "@/lib/api-client";
import {
  DEFAULT_SELLER_OFFER,
  EMPTY_LISTING_PARCEL,
  isCompleteListingParcel,
  type ListingParcelInput,
  listingParcelFromInput,
  listingParcelToInput,
  parseListingParcel,
  parseSellerFulfillmentOffer,
  type SellerFulfillmentOffer,
} from "@/lib/fulfillment-options";
import { createNegotiationAgent } from "@/lib/negotiation-agents-api";
import { createClient } from "@/lib/supabase/client";
import { useAmplitude } from "@/providers/amplitude-provider";
import {
  AgentBuilder,
  agentStrategySnapshotFromState,
} from "../../agents/_components/AgentBuilder";

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

/* ─── Seller Agent Presets (4D weight system) ─────────────────
 *
 * Source of truth lives in @haggle/shared/agent-presets.
 * Step 5 uses NEGOTIATION_AGENT_PRESETS + PresetGrid + StrategyRadar.
 */

const RECOGNIZED_PRESET_IDS: NegotiationAgentPresetId[] = [
  "hunter",
  "closer",
  "verifier",
  "balancer",
];

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

/* Radar + Agent icon — replaced by StrategyRadar + emoji from @haggle/shared. */

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
  negotiationAgentSnapshot: Record<string, unknown> | null;
}

/* ─── Main Wizard ─────────────────────────────────────────── */

const STEP_NAMES = ["photo", "details", "category", "pricing", "agent"] as const;

export function NewListingWizard({
  userId,
  resumeDraftId,
}: {
  userId: string;
  resumeDraftId?: string;
}) {
  const router = useRouter();
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

  // Step 2: Title & Description
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  // Step 3: Category, Condition, Tags
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  /** False when the vision tagger was unavailable — tags then come from text inference only. */
  const [visionOk, setVisionOk] = useState(true);
  const [tagEditing, setTagEditing] = useState(false);
  const tagFieldRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState("electronics");

  /**
   * Whether the category+tags resolve any deterministic SAFETY gate. The negotiation
   * taxonomy is keyed by tags: without an item-type tag ("mattress", "iphone", "car-seat")
   * a listing only gets its category's generic checks, so the agent never asks the
   * deal-breaker questions. Surfacing this lets the seller fix it with one tag.
   */
  const hasSafetyChecks = useMemo(() => {
    const tagSet = [category, ...tags].filter(Boolean);
    return resolveChecks(tagSet).some((c) => c.enforcement === "hard");
  }, [category, tags]);
  const [condition, setCondition] = useState("good");

  // Step 4: Pricing
  const [targetPrice, setTargetPrice] = useState("");
  const [floorPrice, setFloorPrice] = useState("");
  const [sellingDeadline, setSellingDeadline] = useState("");
  const [fulfillmentOffer, setFulfillmentOffer] =
    useState<SellerFulfillmentOffer>(DEFAULT_SELLER_OFFER);
  const [parcel, setParcel] = useState<ListingParcelInput>(EMPTY_LISTING_PARCEL);

  // Step 5: Agent — all state lives in a single AgentBuilderState.
  const [agentValue, setAgentValue] = useState<AgentBuilderState | null>(null);
  const prevAgentRef = useRef<AgentBuilderState | null>(null);
  // Strategy chat memory captured from the advisor conversation.
  const [negotiationAgentBuilderMemory, setNegotiationAgentBuilderMemory] =
    useState<NegotiationAgentBuilderMemory | null>(null);

  // Published state
  const [publishResult, setPublishResult] = useState<{
    publicId: string;
    shareUrl: string;
  } | null>(null);
  const [storyDownloading, setStoryDownloading] = useState(false);

  // Seller-side display copy for headers/summary.
  const selectedCopy = agentValue ? resolveEffectivePreset(agentValue).copy.seller : null;

  // Track preset/custom changes (don't fire on every override slider drag).
  useEffect(() => {
    const prev = prevAgentRef.current;
    if (!agentValue) {
      prevAgentRef.current = null;
      return;
    }
    const changed =
      !prev ||
      prev.source.kind !== agentValue.source.kind ||
      prev.source.id !== agentValue.source.id;
    if (changed) {
      track("Seller Agent Selected", {
        agent_preset: agentValue.agent.presetId,
        draft_id: draftId,
        source: agentValue.source.kind,
        ...(agentValue.source.kind === "custom" ? { custom_agent_id: agentValue.source.id } : {}),
      });
    }
    prevAgentRef.current = agentValue;
  }, [agentValue, draftId, track]);

  // Format helpers
  const formatWithCommas = (v: string) => {
    if (!v) return "";
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? v : n.toLocaleString();
  };
  const handlePriceChange = (raw: string, setter: (v: string) => void) => {
    setter(raw.replace(/[^0-9]/g, ""));
  };

  const today = formatLocalDateInput(new Date());

  function getBrowserTimeZone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  }

  function formatLocalDateInput(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function localDateToDeadlineIso(localDate: string): string {
    const [year, month, day] = localDate.split("-").map(Number);
    return new Date(year, (month ?? 1) - 1, day ?? 1, 23, 59, 59, 999).toISOString();
  }

  function deadlineStrategyConfig(): Record<string, unknown> {
    return {
      sellerTimezone: getBrowserTimeZone(),
      sellingDeadlineLocalDate: sellingDeadline,
      sellingDeadlineLocalTime: "23:59:59.999",
      sellingDeadlineSource: "browser_timezone",
    };
  }

  /* ─── Resume draft ─────────────────────────────────────── */

  // biome-ignore lint/correctness/useExhaustiveDependencies: resume once when a draft id is present
  useEffect(() => {
    if (!resumeDraftId) return;
    (async () => {
      try {
        const data = await api.get<{ ok: boolean; draft: DraftData }>(
          `/api/drafts/${resumeDraftId}`,
        );
        if (!data.ok || !data.draft) {
          setLoading(false);
          return;
        }
        const d = data.draft;
        setDraftId(d.id);
        setStep(d.currentStep || 1);
        if (d.title) setTitle(d.title);
        if (d.description) setDescription(d.description);
        if (d.tags) setTags(d.tags);
        if (d.category) setCategory(d.category);
        if (d.condition) setCondition(d.condition);
        if (d.photoUrl) {
          setPhotoUrl(d.photoUrl);
          setPhotoPreview(d.photoUrl);
        }
        if (d.targetPrice) setTargetPrice(String(Math.round(Number(d.targetPrice))));
        if (d.floorPrice) setFloorPrice(String(Math.round(Number(d.floorPrice))));
        if (d.sellingDeadline) {
          const savedLocalDate =
            typeof d.negotiationAgentSnapshot?.sellingDeadlineLocalDate === "string"
              ? d.negotiationAgentSnapshot.sellingDeadlineLocalDate
              : null;
          setSellingDeadline(savedLocalDate ?? formatLocalDateInput(new Date(d.sellingDeadline)));
        }
        if (d.draftName) setDraftName(d.draftName);
        if (typeof d.negotiationAgentSnapshot?.preset === "string") {
          const candidate = d.negotiationAgentSnapshot.preset as NegotiationAgentPresetId;
          if (RECOGNIZED_PRESET_IDS.includes(candidate)) {
            setAgentValue(createBuilderState({ side: "seller", presetId: candidate }));
          }
        }
        // Restore the captured builder-chat memory (criteria, deal-breakers, style)
        // so resuming a draft and publishing WITHOUT re-running the chat does not wipe
        // it — patchDraft overwrites the whole snapshot, so an unrestored (null) memory
        // would erase everything the earlier session captured.
        const savedOffer = parseSellerFulfillmentOffer(
          d.negotiationAgentSnapshot?.sellerFulfillmentOffer,
        );
        if (savedOffer) setFulfillmentOffer(savedOffer);
        const savedParcel = parseListingParcel(d.negotiationAgentSnapshot?.parcel);
        if (savedParcel) setParcel(listingParcelToInput(savedParcel));
        const savedMemory = d.negotiationAgentSnapshot?.negotiationAgentBuilderMemory;
        if (savedMemory && typeof savedMemory === "object" && !Array.isArray(savedMemory)) {
          setNegotiationAgentBuilderMemory(savedMemory as NegotiationAgentBuilderMemory);
        }
      } catch {
        /* start fresh */
      } finally {
        setLoading(false);
      }
    })();
  }, [resumeDraftId]);

  /* ─── Amplitude ─────────────────────────────────────────── */

  const wizardTracked = useRef(false);
  const lastTrackedStep = useRef<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: step-tracking effect keyed on loading/step
  useEffect(() => {
    if (loading) return;
    if (!wizardTracked.current) {
      track("Listing Wizard Started", { source: resumeDraftId ? "resume" : "direct" });
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
  }, [step, loading]);

  /* ─── Photo handling ────────────────────────────────────── */

  function processFile(file: File) {
    if (!file.type.match(/^image\/(png|jpeg|webp)$/)) {
      setError("Only PNG, JPG or WebP files are accepted");
      return;
    }
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
      const path = `${dId}/${Date.now()}.jpg`;
      const { error: uploadErr } = await supabase.storage
        .from("listing-photos")
        .upload(path, compressed, { contentType: "image/jpeg", upsert: true });
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
      const data = await api.post<{ ok: boolean; draft: { id: string } }>("/api/drafts", {
        userId,
      });
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
      const data = await api.patch<{ ok: boolean }>(`/api/drafts/${id}`, { ...patch, userId });
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
    if (sellingDeadline) patch.sellingDeadline = localDateToDeadlineIso(sellingDeadline);
    const strategyBase: Record<string, unknown> = {};
    if (sellingDeadline) Object.assign(strategyBase, deadlineStrategyConfig());
    strategyBase.sellerFulfillmentOffer =
      parseSellerFulfillmentOffer(fulfillmentOffer) ?? DEFAULT_SELLER_OFFER;
    const listingParcel = listingParcelFromInput(parcel);
    if (listingParcel) strategyBase.parcel = listingParcel;
    if (agentValue) {
      // Single serializer — emits the full strategy (weights + every engine
      // knob + memory). Same function publish uses, so the two can't diverge.
      Object.assign(
        strategyBase,
        agentStrategySnapshotFromState(agentValue, negotiationAgentBuilderMemory),
      );
    }
    if (Object.keys(strategyBase).length > 0) patch.negotiationAgentSnapshot = strategyBase;
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
      if (ok) {
        track("Listing Draft Saved", { draft_id: id, step, draft_name: patch.draftName });
        router.push("/sell/dashboard");
      }
    } finally {
      setSaving(false);
    }
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
      case 1:
        return !!(photoFile || photoUrl);
      case 2:
        return !!title.trim();
      case 3:
        return true;
      case 4:
        return (
          !!targetPrice.trim() &&
          !!sellingDeadline &&
          (!fulfillmentOffer.options.some((option) => option.method === "carrier") ||
            isCompleteListingParcel(parcel))
        );
      case 5:
        return !!agentValue;
      default:
        return false;
    }
  }

  function validateStep(): string | null {
    switch (step) {
      case 1:
        if (!photoFile && !photoUrl) return "Please add a photo";
        break;
      case 2:
        if (!title.trim()) return "Title is required";
        break;
      case 3:
        break;
      case 4:
        if (!targetPrice.trim()) return "Asking price is required";
        if (!sellingDeadline) return "Selling deadline is required";
        if (
          fulfillmentOffer.options.some((option) => option.method === "carrier") &&
          !isCompleteListingParcel(parcel)
        ) {
          return "Parcel weight and box size are required when you offer carrier shipping";
        }
        break;
      case 5:
        if (!agentValue) return "Please select an agent";
        break;
    }
    return null;
  }

  /* ─── Navigation ────────────────────────────────────────── */

  async function handleNext() {
    const err = validateStep();
    if (err) {
      setError(err);
      return;
    }

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

      // On step 2: save title/description + photoUrl (state may not have been flushed on step 1), then auto-detect
      if (step === 2) {
        await patchDraft(id, {
          title: title.trim(),
          description: description.trim() || undefined,
          ...(photoUrl ? { photoUrl } : {}),
        });
        try {
          const detected = await api.post<{
            ok: boolean;
            tags: string[];
            /** False when the vision pass failed; tags are still enriched deterministically. */
            visionOk?: boolean;
          }>(`/api/drafts/${id}/auto-detect`, {});
          if (detected.ok) {
            if (Array.isArray(detected.tags)) setTags(detected.tags);
            setVisionOk(detected.visionOk !== false);
          }
        } catch {
          // Auto-detect must never block the flow — the seller can still tag manually,
          // and step 3 surfaces a hint when no safety checks matched.
          setVisionOk(false);
        }
        setStep(3);
        return;
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
    if (err) {
      setError(err);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // Same single serializer the wizard's step-save uses — guarantees publish
      // persists the COMPLETE tuned strategy (weights + every engine knob), so
      // the promoted "My Agents" record never loses chat/slider tuning.
      const ok = await patchDraft(draftId!, {
        negotiationAgentSnapshot: {
          ...(sellingDeadline ? deadlineStrategyConfig() : {}),
          ...agentStrategySnapshotFromState(agentValue!, negotiationAgentBuilderMemory),
        },
      });
      if (!ok) return;

      const data = await api
        .post<{
          ok: boolean;
          publicId?: string;
          shareUrl?: string;
          errors?: { message: string; step: number }[];
          error?: string;
        }>(`/api/drafts/${draftId}/publish`, { userId })
        .catch(() => null);

      if (!data) {
        setError("Failed to publish");
        return;
      }
      if (!data.ok) {
        if (data.errors) {
          setError(data.errors[0].message);
          setStep(data.errors[0].step);
        } else setError(data.error || "Failed to publish");
        return;
      }

      track("Listing Published", {
        draft_id: draftId,
        public_id: data.publicId,
        category,
        condition,
        has_photo: !!photoUrl,
        has_floor_price: !!floorPrice,
        agent_preset: agentValue!.agent.presetId,
      });

      // Side effect: persist the configured agent into the seller's library.
      // Failure here is non-fatal — the listing is already live. We only mint a
      // fresh agent when the wizard customized a preset; an existing custom
      // agent picked from the list is already in DB.
      if (agentValue!.source.kind === "preset" || isBuilderCustomized(agentValue!)) {
        const ep = resolveEffectivePreset(agentValue!);
        try {
          await createNegotiationAgent({
            name: `${ep.copy.seller.name} · ${title || data.publicId}`,
            role: "seller",
            config: {
              emoji: ep.emoji,
              basePresetId: agentValue!.agent.presetId,
              negotiationAgentPresetId: agentValue!.agent.presetId,
              weights: { ...ep.weights },
              builderChatMemory: negotiationAgentBuilderMemory ?? undefined,
              // Same engine-knob extractor as every other boundary (one source).
              ...(isBuilderCustomized(agentValue!)
                ? { engineParams: engineParamsFromPreset(ep) }
                : {}),
            },
          });
        } catch (saveErr) {
          console.warn("[new-listing-wizard] post-publish agent save failed:", saveErr);
        }
      }

      setPublishResult({ publicId: data.publicId!, shareUrl: data.shareUrl! });
    } finally {
      setSaving(false);
    }
  }

  /* ─── Loading ───────────────────────────────────────────── */

  if (loading) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ background: "var(--bg-primary)" }}
      >
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-line-strong border-t-action-primary" />
          <p className="text-sm text-ink-secondary">Loading draft...</p>
        </div>
      </div>
    );
  }

  /* ─── Published Screen ──────────────────────────────────── */

  if (publishResult) {
    const formatPrice = (v: string) => {
      const n = parseFloat(v);
      return Number.isNaN(n) ? "$0" : `$${n.toLocaleString()}`;
    };

    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-surface px-4 py-12">
        <div className="mx-auto w-full max-w-lg text-center">
          <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-xl border border-success/35 bg-success-soft text-success">
            <Sparkles className="size-8" strokeWidth={1.5} />
          </div>

          <h2 className="mb-2 font-bold text-2xl text-ink">Your listing is live!</h2>
          <p className="mx-auto mb-8 max-w-sm text-ink-secondary text-sm leading-relaxed">
            Share the link below. Buyers will negotiate with your AI agent automatically.
          </p>

          {/* Item Summary */}
          <div className="mb-8 flex items-center gap-4 rounded-xl border border-line bg-surface-raised p-5 text-left">
            {photoPreview ? (
              // biome-ignore lint/performance/noImgElement: local object-URL photo preview
              <img src={photoPreview} alt="" className="size-14 shrink-0 rounded-lg object-cover" />
            ) : (
              <div className="size-14 shrink-0 rounded-lg bg-surface-sunken" />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink text-sm">{title || "Untitled"}</p>
              <p className="mt-0.5 font-bold text-ink text-xl">{formatPrice(targetPrice)}</p>
              {agentValue && selectedCopy && (
                <p className="mt-1 flex items-center gap-1.5 text-success text-xs">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: resolveEffectivePreset(agentValue).accentColor }}
                  />
                  Agent: {selectedCopy.name}
                </p>
              )}
            </div>
          </div>

          {/* Share Link */}
          <p className="mb-2.5 text-left font-bold text-ink-secondary text-xs tracking-widest">
            YOUR HAGGLE LINK
          </p>
          <div className="mb-6 flex items-center gap-3 rounded-xl border border-line bg-surface-raised p-4">
            <Link2 className="size-4.5 shrink-0 text-ink-secondary" />
            <span className="flex-1 truncate text-left text-ink text-sm">
              {publishResult.shareUrl}
            </span>
            <CopyButton
              value={publishResult.shareUrl}
              onCopy={() =>
                track("Share Link Copied", {
                  public_id: publishResult.publicId,
                  source: "publish_screen",
                })
              }
            />
          </div>

          {/* Instagram Story Share */}
          <div className="mb-3 rounded-xl border border-line bg-surface-raised p-5 text-left">
            <p className="mb-0.5 font-semibold text-ink text-sm">Share to Instagram Story</p>
            <p className="mb-4 text-ink-muted text-xs">
              Buyers tap your link → AI handles the rest
            </p>
            <button
              type="button"
              disabled={storyDownloading}
              onClick={async () => {
                setStoryDownloading(true);
                const ogUrl = publishResult.shareUrl.replace("/l/", "/og/listing/");
                const fileName = `haggle-${publishResult.publicId}.png`;
                const fetchBlob = async (): Promise<Blob | null> => {
                  try {
                    const res = await fetch(ogUrl);
                    if (!res.ok) return null;
                    return await res.blob();
                  } catch {
                    return null;
                  }
                };
                const nav = navigator as Navigator & {
                  canShare?: (data: { files: File[] }) => boolean;
                  share?: (data: { files: File[]; title?: string }) => Promise<void>;
                };
                if (nav.canShare && nav.share) {
                  const blob = await fetchBlob();
                  if (blob) {
                    try {
                      const file = new File([blob], fileName, { type: "image/png" });
                      if (nav.canShare({ files: [file] })) {
                        await nav.share({ files: [file], title: "Haggle listing" });
                        setStoryDownloading(false);
                        return;
                      }
                    } catch (e) {
                      if ((e as Error).name === "AbortError") {
                        setStoryDownloading(false);
                        return;
                      }
                    }
                  }
                }
                window.open(ogUrl, "_blank", "noopener,noreferrer");
                setStoryDownloading(false);
              }}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-action-primary/25 bg-action-primary/10 px-4 py-2.5 font-semibold text-action-primary text-sm transition-colors hover:bg-action-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {storyDownloading ? "Preparing…" : "📥 Download story card"}
            </button>
            <ol className="mt-4 space-y-1 pl-4 text-ink-muted text-xs">
              <li>Save the card to your phone.</li>
              <li>Open Instagram → Create Story → upload the card.</li>
              <li>
                Tap the sticker icon → <strong className="text-ink-secondary">Link</strong> → paste
                your Haggle link (already copied above).
              </li>
            </ol>
            <p className="mt-3 text-ink-muted text-xs">
              The link sticker is what makes buyers tap through. Don't skip it.
            </p>
          </div>

          {/* Share on X */}
          <div className="mb-6 rounded-xl border border-line bg-surface-raised p-5 text-left">
            <p className="mb-0.5 font-semibold text-ink text-sm">Share on X</p>
            <p className="mb-4 text-ink-muted text-xs">Post your listing link directly to X</p>
            <button
              type="button"
              onClick={() => {
                const text = `🤝 Negotiating smarter with AI — check out my listing on Haggle`;
                const url = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(publishResult.shareUrl)}`;
                window.open(url, "_blank", "noopener,noreferrer");
              }}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-action-primary/25 bg-action-primary/10 px-4 py-2.5 font-semibold text-action-primary text-sm transition-colors hover:bg-action-primary/15"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                width="15"
                height="15"
                fill="currentColor"
              >
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              Post to X
            </button>
          </div>

          <button
            type="button"
            onClick={() => router.push("/sell/dashboard")}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-success px-6 py-3.5 font-semibold text-on-accent text-sm transition-opacity hover:opacity-90"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  /* ─── Questionnaire Layout ──────────────────────────────── */

  return (
    <div className="fixed inset-0 z-[60] flex flex-col" style={{ background: "var(--bg-primary)" }}>
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
      <Modal
        open={showExitModal}
        onClose={() => setShowExitModal(false)}
        title="Save as draft?"
        size="sm"
        footer={
          <div className="flex w-full gap-3">
            <Button variant="secondary" className="flex-1" onClick={handleDiscard}>
              Exit
            </Button>
            <Button className="flex-1" loading={saving} onClick={handleSaveDraft}>
              {saving ? "Saving..." : "Save Draft"}
            </Button>
          </div>
        }
      >
        <p className="mb-5 text-ink-muted text-sm">
          You can resume this listing anytime from your dashboard.
        </p>
        {/* Draft name input — only for new drafts */}
        {!resumeDraftId && (
          <div>
            <label htmlFor="wf-1" className="mb-2 block font-medium text-ink-secondary text-xs">
              Draft name
            </label>
            <Input
              id="wf-1"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Draft 1"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveDraft();
              }}
            />
          </div>
        )}
      </Modal>

      {/* ── Progress bar — pinned to top edge ── */}
      <div className="absolute top-0 right-0 left-0 z-10 h-[3px] bg-line/50">
        <div
          className="h-full rounded-r-full bg-action-primary transition-all duration-700 ease-out"
          style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
        />
      </div>

      {/* ── Close button — top right ── */}
      <div className="absolute top-4 right-5 z-10 sm:top-5 sm:right-8">
        <IconButton
          variant="outline"
          shape="circle"
          onClick={handleExitClick}
          disabled={saving}
          aria-label="Save & Exit"
          title="Save & Exit"
        >
          {saving ? <Spinner size="sm" /> : <X className="size-4.5" />}
        </IconButton>
      </div>

      {/* ── Scrollable content area — vertically centered ── */}
      <div className="flex-1 overflow-y-auto px-5 sm:px-8">
        <div
          className={`flex min-h-full flex-col ${step === 4 ? "justify-start" : "justify-center"}`}
        >
          <div
            key={step}
            className={`mx-auto w-full ${step === 5 ? "max-w-[1100px]" : "max-w-lg"} py-10 sm:py-16`}
            style={{
              animation: "wizard-step-in 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            {/* Step title & subtitle */}
            <div className="mb-10">
              <h1 className="text-2xl sm:text-3xl font-bold mb-3 tracking-tight text-ink">
                {STEP_TITLES[step - 1]}
              </h1>
              <p className="text-sm sm:text-base text-ink-muted">{STEP_SUBTITLES[step - 1]}</p>
            </div>

            {/* Error */}
            {error && (
              <Alert tone="error" className="mb-6">
                {error}
              </Alert>
            )}

            {/* ── STEP 1: Photo ── */}
            {step === 1 && (
              <Dropzone
                accept="image/png,image/jpeg,image/webp"
                className="mx-auto aspect-square w-full max-w-lg"
                preview={photoPreview ?? undefined}
                previewLabel="Change photo"
                buttonLabel=""
                label="Click or drag a photo here"
                hint="PNG, JPG or WebP · Max 5 MB"
                onFiles={(files) => {
                  const file = files[0];
                  if (file) processFile(file);
                }}
              />
            )}

            {/* ── STEP 2: Title & Description ── */}
            {step === 2 && (
              <div className="space-y-6">
                <div>
                  <label
                    htmlFor="wf-2"
                    className="mb-2 block font-semibold text-ink-secondary text-xs uppercase tracking-wider"
                  >
                    Title <span className="text-warning">*</span>
                  </label>
                  <Input
                    id="wf-2"
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="e.g. MacBook Pro M3, 14 inch"
                  />
                </div>

                <div>
                  <label
                    htmlFor="wf-3"
                    className="mb-2 block font-semibold text-ink-secondary text-xs uppercase tracking-wider"
                  >
                    Description
                  </label>
                  <Textarea
                    id="wf-3"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe key features, specs, included accessories, reason for selling..."
                    rows={4}
                  />
                </div>
              </div>
            )}

            {/* ── STEP 3: Category, Condition, Tags ── */}
            {step === 3 && (
              <div className="space-y-8">
                {/* Category */}
                <div>
                  <span className="mb-3 block text-xs font-semibold uppercase tracking-wider text-ink-secondary">
                    Category
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {CATEGORIES.map((c) => (
                      <Chip
                        key={c.value}
                        selected={category === c.value}
                        onClick={() => setCategory(c.value)}
                      >
                        {c.label}
                      </Chip>
                    ))}
                  </div>
                </div>

                {/* Condition */}
                <div>
                  <span className="mb-3 block text-xs font-semibold uppercase tracking-wider text-ink-secondary">
                    Condition
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {CONDITIONS.map((c) => (
                      <Chip
                        key={c.value}
                        selected={condition === c.value}
                        onClick={() => setCondition(c.value)}
                      >
                        {c.label}
                      </Chip>
                    ))}
                  </div>
                </div>

                {/* Tags */}
                <div>
                  <span className="mb-3 block text-xs font-semibold uppercase tracking-wider text-ink-secondary">
                    Tags{" "}
                    {visionOk && tags.length > 0 && (
                      <span className="ml-1 font-normal normal-case tracking-normal text-ink-muted">
                        (auto-suggested)
                      </span>
                    )}
                  </span>
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
                        className="h-9 w-28 rounded-full border border-action-primary bg-surface-raised px-4 text-ink text-sm outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setTagEditing(true);
                          setTimeout(() => tagFieldRef.current?.focus(), 0);
                        }}
                        className="flex h-9 cursor-pointer items-center gap-1 rounded-full border border-dashed border-line px-4 text-sm text-ink-muted transition-colors hover:border-action-primary hover:text-action-primary hover:bg-action-primary/5"
                      >
                        <span>+</span> <span>Add tag</span>
                      </button>
                    )}
                    {tags.map((tag, i) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => setTags(tags.filter((_, idx) => idx !== i))}
                        className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface-sunken px-4 text-sm text-ink transition-colors hover:border-error/50 hover:text-error"
                      >
                        {tag}
                        <span className="text-base opacity-50">×</span>
                      </button>
                    ))}
                  </div>

                  {/* The taxonomy is keyed by tags: with no item-type tag the agent never
                      asks this item's deal-breaker questions. Tell the seller instead of
                      silently shipping a listing with no safety checks. */}
                  {!hasSafetyChecks && (
                    <p className="mt-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-ink-secondary">
                      No item-specific checks matched yet.{" "}
                      {visionOk
                        ? "If this is a common item, add a tag naming what it is"
                        : "Auto-tagging was unavailable — add a tag naming what it is"}{" "}
                      (e.g. <span className="font-medium text-ink">mattress</span>,{" "}
                      <span className="font-medium text-ink">car-seat</span>,{" "}
                      <span className="font-medium text-ink">iphone</span>) so your agent asks the
                      right questions.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* ── STEP 4: Pricing ── */}
            {step === 4 && (
              <div className="space-y-6">
                {/* Asking price */}
                <div>
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-ink-secondary">
                    Asking Price <span className="text-warning">*</span>
                  </span>
                  <Input
                    inputMode="numeric"
                    value={formatWithCommas(targetPrice)}
                    onChange={(e) => handlePriceChange(e.target.value, setTargetPrice)}
                    placeholder="0"
                    startAdornment="$"
                  />
                  <p className="mt-1.5 text-ink-muted text-xs">
                    The starting price buyers will see
                  </p>
                </div>

                {/* Floor price */}
                <div>
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-ink-secondary">
                    Minimum Acceptable Price{" "}
                    <span className="font-normal normal-case tracking-normal text-ink-muted">
                      (private)
                    </span>
                  </span>
                  <Input
                    inputMode="numeric"
                    value={formatWithCommas(floorPrice)}
                    onChange={(e) => handlePriceChange(e.target.value, setFloorPrice)}
                    placeholder="0"
                    startAdornment="$"
                  />
                  <p className="mt-1.5 text-ink-muted text-xs">
                    Your AI agent will never agree below this price
                  </p>
                </div>

                {/* Selling deadline */}
                <div>
                  <label
                    htmlFor="wf-4"
                    className="mb-2 block font-semibold text-ink-secondary text-xs uppercase tracking-wider"
                  >
                    Selling Deadline <span className="text-warning">*</span>
                  </label>
                  <Input
                    id="wf-4"
                    type="date"
                    min={today}
                    value={sellingDeadline}
                    onChange={(e) => setSellingDeadline(e.target.value)}
                    className="cursor-pointer"
                  />
                  <p className="mt-1.5 text-xs text-ink-muted">
                    Your AI agent becomes more flexible as the deadline approaches
                  </p>
                </div>

                <div>
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-ink-secondary">
                    How can the buyer get it <span className="text-warning">*</span>
                  </span>
                  <p className="mb-3 text-xs text-ink-muted">
                    MVP ships with a carrier. Pickup, porch drop, and meetup will reconnect later. A
                    close box size is enough for a rate.
                  </p>
                  <FulfillmentOfferEditor
                    audience="seller"
                    value={fulfillmentOffer}
                    onChange={setFulfillmentOffer}
                  />
                  {fulfillmentOffer.options.some((option) => option.method === "carrier") && (
                    <div className="mt-5">
                      <ListingParcelFields value={parcel} onChange={setParcel} required />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── STEP 5: Agent ── */}
            {step === 5 && (
              // biome-ignore lint/a11y/useValidAriaRole: "role" is an AgentBuilder prop (buyer/seller), not an ARIA role
              <AgentBuilder
                role="seller"
                embedded
                value={agentValue}
                onChange={setAgentValue}
                chatSlot={
                  agentValue && (
                    // biome-ignore lint/a11y/useValidAriaRole: "role" is a NegotiationAgentBuilderChat prop (buyer/seller), not an ARIA role
                    <NegotiationAgentBuilderChat
                      agent={resolveEffectivePreset(agentValue)}
                      // Key the builder session by DRAFT (not preset) so quick-setup
                      // picks / criteria never leak between two of the seller's listings
                      // that happen to use the same preset. `agent.id` adds preset isolation.
                      listingPublicId={`listing-draft-${draftId ?? "new"}`}
                      listingTitle={title || "this listing"}
                      listingCategory={category || null}
                      listingPrice={targetPrice || null}
                      listingFloorPrice={floorPrice || null}
                      listingCondition={condition || null}
                      listingTags={tags}
                      listingDescription={description || null}
                      role="seller"
                      onNegotiationAgentBuilderMemoryUpdate={setNegotiationAgentBuilderMemory}
                      onStrategyUpdate={(s) =>
                        setAgentValue((prev) => (prev ? applyChatStrategyToState(prev, s) : prev))
                      }
                    />
                  )
                }
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Bottom bar: Back / Next ── */}
      <div className="relative z-20 shrink-0 border-line border-t bg-[var(--bg-primary)] px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-8 sm:pt-3 sm:pb-6">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-4">
          {/* Back (hidden on step 1) */}
          {step > 1 ? (
            <Button variant="secondary" className="w-24 sm:w-28" onClick={handleBack}>
              <ChevronLeft className="size-4" />
              Back
            </Button>
          ) : (
            <div />
          )}

          {/* Next / Publish */}
          {step < TOTAL_STEPS ? (
            <Button
              className="w-24 sm:w-28"
              loading={saving}
              disabled={!canProceed()}
              onClick={handleNext}
            >
              {saving ? (
                "Saving..."
              ) : (
                <>
                  Next
                  <ChevronRight className="size-4" />
                </>
              )}
            </Button>
          ) : (
            // Solid-success final CTA — Button has no solid-green variant.
            <button
              type="button"
              onClick={handlePublish}
              disabled={saving || !agentValue}
              className="flex w-24 cursor-pointer items-center justify-center gap-2 rounded-xl bg-success py-2.5 font-semibold text-on-accent text-xs transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:w-28 sm:py-3 sm:text-sm"
            >
              {saving ? "Publishing..." : "Submit"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

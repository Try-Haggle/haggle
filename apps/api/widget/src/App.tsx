import { useState, useEffect, useRef, useCallback } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import StepIndicator from "./components/StepIndicator";
import TagInput from "./components/TagInput";
import ChipSelector from "./components/ChipSelector";
import RadarChart from "./components/RadarChart";
import {
  AGENT_PRESETS,
  DEFAULT_STATS,
  STAT_META,
  type AgentStats,
} from "./agentPresets";

const STEPS = [{ label: "Item Details" }, { label: "Pricing" }, { label: "AI Agent" }];

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

export default function App() {
  // Form state
  const [draftId, setDraftId] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [category, setCategory] = useState("electronics");
  const [condition, setCondition] = useState<string | null>(null);

  // Step 2 state
  const [targetPrice, setTargetPrice] = useState("");
  const [floorPrice, setFloorPrice] = useState("");
  const [sellingDeadline, setSellingDeadline] = useState("");

  // Step 3 state
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [isStrategyCustomized, setIsStrategyCustomized] = useState(false);

  // Publish state
  const [publishResult, setPublishResult] = useState<{
    publicId: string;
    shareUrl: string;
  } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  // UI state
  const [currentStep, setCurrentStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Connect to ChatGPT host via MCP Apps bridge.
  // onAppCreated registers handlers BEFORE the connection handshake completes,
  // preventing race conditions where the host sends events before we listen.
  const { app, isConnected, error: connectionError } = useApp({
    appInfo: { name: "haggle-listing-widget", version: "0.1.0" },
    capabilities: {
      availableDisplayModes: ["inline", "fullscreen"],
    },
    onAppCreated: (createdApp) => {
      console.log("[haggle] App created, registering handlers");

      createdApp.onhostcontextchanged = (ctx) => {
        console.log("[haggle] Host context changed:", JSON.stringify(ctx));
        if (ctx.displayMode) {
          setIsFullscreen(ctx.displayMode === "fullscreen");
        }
      };

      createdApp.ontoolresult = (result) => {
        try {
          console.log("[haggle] Tool result received:", JSON.stringify(result).slice(0, 200));
          const data = result.structuredContent as Record<string, unknown>;
          if (!data?.draft_id) return;
          setDraftId(data.draft_id as string);

          const draft = data.draft as Record<string, unknown> | undefined;
          if (draft) {
            if (draft.title) setTitle(draft.title as string);
            if (draft.description) setDescription(draft.description as string);
            if (draft.tags) setTags(draft.tags as string[]);
            if (draft.category) setCategory(draft.category as string);
            if (draft.condition) setCondition(draft.condition as string);
            if (draft.targetPrice) setTargetPrice(draft.targetPrice as string);
            if (draft.floorPrice) setFloorPrice(draft.floorPrice as string);
            if (draft.sellingDeadline) setSellingDeadline((draft.sellingDeadline as string).slice(0, 10));
          }
        } catch (err) {
          console.error("[haggle] Error processing tool result:", err);
        }
      };

      createdApp.onteardown = async () => {
        console.log("[haggle] Host requested teardown");
        return {};
      };
    },
  });

  const isFormValid = !!photoFile && !!title.trim();

  // Log connection state for debugging widget disappearing issue.
  useEffect(() => {
    console.log("[haggle] Connection state:", { isConnected, hasApp: !!app, connectionError: connectionError?.message });
    if (connectionError) {
      console.error("[haggle] Connection error:", connectionError);
    }
  }, [app, isConnected, connectionError]);

  // Check initial display mode once the bridge is connected.
  // onAppCreated fires before connection, so getHostContext() isn't ready there.
  useEffect(() => {
    if (!app || !isConnected) return;
    const ctx = app.getHostContext();
    console.log("[haggle] Initial host context:", JSON.stringify(ctx));
    if (ctx?.displayMode === "fullscreen") {
      setIsFullscreen(true);
    }
  }, [app, isConnected]);

  // Request fullscreen mode from ChatGPT host (official pattern).
  const requestFullscreen = useCallback(() => {
    if (!app || !isConnected || isFullscreen) return;

    // If the host exposes availableDisplayModes, verify fullscreen is supported.
    // ChatGPT may not expose this field (protocol discrepancy), so skip check if absent.
    const ctx = app.getHostContext();
    if (
      ctx?.availableDisplayModes &&
      !ctx.availableDisplayModes.includes("fullscreen")
    ) {
      return;
    }

    app
      .requestDisplayMode({ mode: "fullscreen" })
      .then((result) => {
        // Always use the RESULT mode — host has final say
        setIsFullscreen(result.mode === "fullscreen");
      })
      .catch(() => {});
  }, [app, isConnected, isFullscreen]);

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleNextStep1 = async () => {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (!app || !draftId) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await app.callServerTool({
        name: "haggle_apply_patch",
        arguments: {
          draft_id: draftId,
          patch: {
            title: title.trim(),
            description: description.trim() || undefined,
            tags: tags.length > 0 ? tags : undefined,
            category,
            condition: condition || undefined,
          },
        },
      });
      setCurrentStep(2);
    } catch (err) {
      setError("Failed to save. Please try again.");
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNextStep2 = async () => {
    if (!targetPrice.trim()) {
      setError("Asking price is required");
      return;
    }
    if (!sellingDeadline) {
      setError("Selling deadline is required");
      return;
    }
    if (!app || !draftId) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await app.callServerTool({
        name: "haggle_apply_patch",
        arguments: {
          draft_id: draftId,
          patch: {
            targetPrice: targetPrice.trim(),
            floorPrice: floorPrice.trim() || undefined,
            sellingDeadline: new Date(sellingDeadline).toISOString(),
          },
        },
      });
      setCurrentStep(3);
    } catch (err) {
      setError("Failed to save. Please try again.");
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`widget${isFullscreen ? " widget--fullscreen" : ""}`}>
      {/* Debug: show connection error if any */}
      {connectionError && (
        <div style={{ background: "#7f1d1d", color: "#fca5a5", padding: "8px 12px", borderRadius: 8, fontSize: 12, marginBottom: 12 }}>
          Bridge error: {connectionError.message}
        </div>
      )}
      {/* Header — hidden in fullscreen (host provides its own) */}
      {!isFullscreen && (
        <div className="header">
          <span className="header__logo">Haggle</span>
          <button
            type="button"
            className="header__expand"
            onClick={requestFullscreen}
            aria-label="Expand to fullscreen"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" x2="14" y1="3" y2="10" />
              <line x1="3" x2="10" y1="21" y2="14" />
            </svg>
          </button>
        </div>
      )}

      {/* Step Indicator — rendered here for Step 1 & 2 (Step 3 renders its own inside wrapper) */}
      {currentStep !== 3 && (
        <StepIndicator currentStep={currentStep} steps={STEPS} />
      )}

      {currentStep === 1 ? (
        <div onPointerDownCapture={requestFullscreen}>
          {/* Section Heading */}
          <div className="section-heading">
            <svg
              className="section-heading__icon"
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" />
              <path d="M12 22V12" />
              <polyline points="3.29 7 12 12 20.71 7" />
              <path d="m7.5 4.27 9 5.15" />
            </svg>
            <h2 className="section-heading__text">What are you selling?</h2>
          </div>

          {/* Photo */}
          <div className="form-group">
            <label className="form-label">
              Photo <span className="required-star">*</span>
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg"
              className="photo-file-input"
              onChange={handlePhotoSelect}
            />
            {photoPreview ? (
              <div
                className="photo-preview"
                onClick={() => fileInputRef.current?.click()}
              >
                <img src={photoPreview} alt="Preview" className="photo-preview__img" />
                <div className="photo-preview__overlay">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" x2="12" y1="3" y2="15" />
                  </svg>
                </div>
              </div>
            ) : (
              <div
                className="photo-placeholder"
                onClick={() => fileInputRef.current?.click()}
              >
                <svg
                  className="photo-placeholder__icon"
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                  <circle cx="9" cy="9" r="2" />
                  <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                </svg>
                <span>Upload photo</span>
              </div>
            )}
          </div>

          {/* Title */}
          <div className="form-group">
            <label className="form-label">
              Title <span className="required-star">*</span>
            </label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g. MacBook Pro M3, 14 inch"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (error) setError(null);
              }}
            />
            {error && <p className="form-error">{error}</p>}
          </div>

          {/* Description */}
          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea
              className="form-input form-textarea"
              placeholder="Describe key features, specs, included accessories, reason for selling..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Tags */}
          <div className="form-group">
            <label className="form-label">Tags</label>
            <TagInput tags={tags} onChange={setTags} />
          </div>

          {/* Category */}
          <div className="form-group">
            <label className="form-label">Category</label>
            <select
              className="form-select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORIES.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>

          {/* Condition */}
          <div className="form-group">
            <label className="form-label">Condition</label>
            <ChipSelector
              options={CONDITIONS}
              selected={condition}
              onChange={setCondition}
            />
          </div>

          {/* Next Button */}
          <button
            type="button"
            className="btn-primary"
            onClick={handleNextStep1}
            disabled={!isFormValid || isSubmitting}
          >
            {isSubmitting ? "Saving..." : "Next: Set Pricing"}
            {!isSubmitting && <span>→</span>}
          </button>
        </div>
      ) : currentStep === 2 ? (
        <div onPointerDownCapture={requestFullscreen}>
          {/* Back button */}
          <button
            type="button"
            className="btn-back"
            onClick={() => { setCurrentStep(1); setError(null); }}
          >
            ← Back
          </button>
          {/* Section Heading */}
          <div className="section-heading">
            <svg
              className="section-heading__icon"
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" x2="12" y1="2" y2="22" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
            <h2 className="section-heading__text">Set your price</h2>
          </div>

          {/* Item Summary Card */}
          <div className="summary-card">
            {photoPreview ? (
              <img src={photoPreview} alt="" className="summary-card__photo" />
            ) : (
              <div className="summary-card__photo-placeholder" />
            )}
            <div className="summary-card__content">
              <p className="summary-card__title">{title || "Untitled"}</p>
              <p className="summary-card__meta">
                {CONDITIONS.find((c) => c.value === condition)?.label ?? "—"}
                {" · "}
                {CATEGORIES.find((c) => c.value === category)?.label ?? "—"}
              </p>
            </div>
          </div>

          {/* Asking Price */}
          <div className="form-group">
            <label className="form-label">
              Asking Price <span className="required-star">*</span>
            </label>
            <div className="price-input-wrapper">
              <span className="price-prefix">$</span>
              <input
                type="number"
                className="form-input price-input"
                placeholder="0"
                value={targetPrice}
                onChange={(e) => {
                  setTargetPrice(e.target.value);
                  if (error) setError(null);
                }}
                min="0"
              />
            </div>
            <p className="form-helper">The starting price buyers will see</p>
          </div>

          {/* Minimum Acceptable Price */}
          <div className="form-group">
            <label className="form-label">
              Minimum Acceptable Price{" "}
              <span className="form-label__hint">(private — only your AI agent knows)</span>
            </label>
            <div className="price-input-wrapper">
              <span className="price-prefix">$</span>
              <input
                type="number"
                className="form-input price-input"
                placeholder="0"
                value={floorPrice}
                onChange={(e) => setFloorPrice(e.target.value)}
                min="0"
              />
            </div>
            <p className="form-helper">Your AI will never agree below this price</p>
          </div>

          {/* Selling Deadline */}
          <div className="form-group">
            <label className="form-label">
              Selling Deadline <span className="required-star">*</span>
            </label>
            <input
              type="date"
              className="form-input"
              value={sellingDeadline}
              min={new Date().toISOString().slice(0, 10)}
              max="2099-12-31"
              onChange={(e) => {
                setSellingDeadline(e.target.value);
                if (error) setError(null);
              }}
            />
            <p className="form-helper">Your AI agent may be more flexible as the deadline approaches</p>
          </div>

          {error && <p className="form-error">{error}</p>}

          {/* Next Button */}
          <button
            type="button"
            className="btn-primary"
            onClick={handleNextStep2}
            disabled={!targetPrice.trim() || !sellingDeadline || isSubmitting}
          >
            {isSubmitting ? "Saving..." : "Next: Set Up AI Agent"}
            {!isSubmitting && <span>→</span>}
          </button>
        </div>
      ) : (
        /* ─── Step 3: AI Agent Setup ──────────────────────────── */
        (() => {
          const activePreset = AGENT_PRESETS.find((a) => a.id === selectedAgent);
          const currentStats: AgentStats = activePreset?.stats ?? DEFAULT_STATS;
          const formatPrice = (v: string) => {
            const n = parseFloat(v);
            return isNaN(n) ? "$0" : `$${n.toLocaleString()}`;
          };

          // ─── Listing Live Screen ───────────────────────────
          if (publishResult) {
            return (
              <div className="listing-live" onPointerDownCapture={requestFullscreen}>
                {/* Success Icon */}
                <div className="listing-live__icon">
                  <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
                    <path d="M20 3v4" /><path d="M22 5h-4" />
                    <path d="M4 17v2" /><path d="M5 18H3" />
                  </svg>
                </div>

                <h2 className="listing-live__title">Your listing is live!</h2>
                <p className="listing-live__subtitle">
                  Share the link below. When buyers click it, they'll negotiate with your AI agent automatically.
                </p>

                {/* Item Summary Card */}
                <div className="listing-live__summary">
                  {photoPreview ? (
                    <img src={photoPreview} alt="" className="listing-live__photo" />
                  ) : (
                    <div className="listing-live__photo-placeholder" />
                  )}
                  <div className="listing-live__info">
                    <p className="listing-live__item-title">{title || "Untitled"}</p>
                    <p className="listing-live__item-price">{formatPrice(targetPrice)}</p>
                    {activePreset && (
                      <p className="listing-live__item-agent">
                        <span className="listing-live__agent-dot" style={{ background: activePreset.accentColor }} />
                        Agent: {activePreset.name}
                      </p>
                    )}
                  </div>
                </div>

                {/* Share Link */}
                <div className="listing-live__section-label">YOUR HAGGLE LINK</div>
                <div className="listing-live__link-box">
                  <svg className="listing-live__link-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                  <span className="listing-live__link-url">{publishResult.shareUrl}</span>
                  <button
                    type="button"
                    className="listing-live__copy-btn"
                    onClick={() => {
                      navigator.clipboard.writeText(publishResult.shareUrl).then(() => {
                        setLinkCopied(true);
                        setTimeout(() => setLinkCopied(false), 2000);
                      });
                    }}
                  >
                    {linkCopied ? (
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

                {/* Dashboard Button (Coming Soon) */}
                <button type="button" className="btn-primary listing-live__dashboard-btn" disabled>
                  Go to Dashboard
                  <span className="listing-live__coming-soon">Coming Soon</span>
                </button>
              </div>
            );
          }

          return (
            <div className="step3-wrapper" onPointerDownCapture={requestFullscreen}>
              {/* Back + Step Indicator inside wrapper for proper max-width */}
              <button
                type="button"
                className="btn-back"
                onClick={() => { setCurrentStep(currentStep - 1); setError(null); }}
              >
                ← Back
              </button>
              <StepIndicator currentStep={currentStep} steps={STEPS} />

              {/* Section Heading — full width above the grid */}
              <div className="section-heading">
                <svg
                  className="section-heading__icon"
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect width="18" height="10" x="3" y="11" rx="2" />
                  <circle cx="12" cy="5" r="2" />
                  <path d="M12 7v4" />
                  <line x1="8" x2="8" y1="16" y2="16" />
                  <line x1="16" x2="16" y1="16" y2="16" />
                </svg>
                <h2 className="section-heading__text">Set Up Your Selling Agent</h2>
              </div>
              <p className="step3-description">
                Your AI will handle buyer negotiations automatically. Choose a style and customize its approach.
              </p>

              {/* Two-column row: cards + profile */}
              <div className="step3-layout">
              {/* ── LEFT COLUMN ─────────────────────────────── */}
              <div className="step3-left">
                {/* Agent Preset Cards (2×2 grid) */}
                <div className="agent-grid">
                  {AGENT_PRESETS.map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      className={`agent-card${selectedAgent === agent.id ? " agent-card--selected" : ""}`}
                      onClick={() => setSelectedAgent(agent.id)}
                    >
                      <div className="agent-card__header">
                        <span
                          className="agent-card__icon"
                          style={{ background: `${agent.accentColor}22`, color: agent.accentColor }}
                        >
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
                          <p className="agent-card__name">{agent.name}</p>
                          <p className="agent-card__tagline">{agent.tagline}</p>
                        </div>
                      </div>
                      <p className="agent-card__desc">{agent.description}</p>
                    </button>
                  ))}
                </div>

                {/* Chat Placeholder */}
                <div className="chat-placeholder">
                  <div className="chat-placeholder__header">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--accent-cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect width="18" height="10" x="3" y="11" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" />
                    </svg>
                    <span className="chat-placeholder__name">
                      {activePreset ? activePreset.name : "Selling Agent"}
                    </span>
                  </div>
                  <div className="chat-placeholder__body">
                    <p>
                      Hi! I'm your selling agent. I'll handle all price negotiations on your behalf — so you don't have to. Let me know how you'd like me to approach this.
                    </p>
                    <p className="chat-placeholder__hint">
                      You can customize my approach below, or just pick a style and I'll run with it.
                    </p>
                  </div>
                  <div className="chat-placeholder__banner">
                    Chat with your AI agent to fine-tune its negotiation strategy. Coming soon.
                  </div>
                </div>
              </div>

              {/* ── RIGHT COLUMN ────────────────────────────── */}
              <div className="step3-right">
                <div className="agent-profile">
                  {/* Profile Header */}
                  <div className="agent-profile__header">
                    <h3 className="agent-profile__title">AGENT PROFILE</h3>
                    <span className={`agent-profile__pill${selectedAgent ? "" : " agent-profile__pill--empty"}`}>
                      {!selectedAgent ? "No Agent" : isStrategyCustomized ? "Customized" : "Default"}
                    </span>
                  </div>

                  {/* Pricing Summary Card */}
                  <div className="pricing-card">
                    <p className="pricing-card__label">{title || "Untitled"}</p>
                    <p className="pricing-card__price">{formatPrice(targetPrice)}</p>
                    <p className="pricing-card__floor">Floor: {formatPrice(floorPrice)} (private)</p>
                  </div>

                  {/* Selected Agent Display */}
                  {activePreset ? (
                    <div className="agent-selected">
                      <span
                        className="agent-card__icon"
                        style={{ background: `${activePreset.accentColor}22`, color: activePreset.accentColor }}
                      >
                        {activePreset.id === "gatekeeper" && (
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                        )}
                        {activePreset.id === "diplomat" && (
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1" /><path d="M6 8H5a4 4 0 0 0 0 8h1" /><path d="M8 6v12" /><path d="M16 6v12" /></svg>
                        )}
                        {activePreset.id === "storyteller" && (
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z" /></svg>
                        )}
                        {activePreset.id === "dealmaker" && (
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></svg>
                        )}
                      </span>
                      <div>
                        <p className="agent-selected__name">{activePreset.name}</p>
                        <p className="agent-selected__tagline">{activePreset.tagline}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="agent-empty">
                      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4">
                        <rect width="18" height="10" x="3" y="11" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" />
                      </svg>
                      <p>Select an agent above</p>
                    </div>
                  )}

                  {/* Stat Bars */}
                  <div className="stat-bars">
                    {STAT_META.map((stat) => (
                      <div key={stat.key} className="stat-bar">
                        <div className="stat-bar__header">
                          <span className="stat-bar__label">{stat.label}</span>
                          <span className="stat-bar__value">{currentStats[stat.key]}%</span>
                        </div>
                        <div className="stat-bar__track">
                          <div
                            className="stat-bar__fill"
                            style={{
                              width: `${currentStats[stat.key]}%`,
                              background: stat.gradient,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Radar Chart */}
                  <div className="radar-section">
                    <h4 className="radar-section__title">STRATEGY MATRIX</h4>
                    <RadarChart stats={currentStats} />
                  </div>

                  {/* CTA Button */}
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!selectedAgent || isSubmitting}
                    onClick={async () => {
                      if (!app || !draftId || !selectedAgent) return;
                      setIsSubmitting(true);
                      setError(null);
                      try {
                        // 1. Save strategy config
                        await app.callServerTool({
                          name: "haggle_apply_patch",
                          arguments: {
                            draft_id: draftId,
                            patch: {
                              strategyConfig: {
                                preset: selectedAgent,
                                ...currentStats,
                              },
                            },
                          },
                        });

                        // 2. Validate
                        const validateResult = await app.callServerTool({
                          name: "haggle_validate_draft",
                          arguments: { draft_id: draftId },
                        });
                        const validateData = validateResult?.structuredContent as Record<string, unknown> | undefined;
                        // data-only tools return via content text, not structuredContent
                        let validateParsed: { ok?: boolean; errors?: Array<{ field: string; message: string; step: number }> } = {};
                        if (validateData?.ok !== undefined) {
                          validateParsed = validateData as typeof validateParsed;
                        } else {
                          // Parse from content text
                          const textContent = (validateResult as Record<string, unknown>)?.content;
                          if (Array.isArray(textContent) && textContent[0]?.text) {
                            validateParsed = JSON.parse(textContent[0].text as string);
                          }
                        }

                        if (validateParsed.ok === false && validateParsed.errors?.length) {
                          const firstError = validateParsed.errors[0];
                          setError(firstError.message);
                          setCurrentStep(firstError.step);
                          return;
                        }

                        // 3. Publish
                        const publishRes = await app.callServerTool({
                          name: "haggle_publish_listing",
                          arguments: { draft_id: draftId },
                        });
                        const pubData = publishRes?.structuredContent as Record<string, unknown> | undefined;
                        if (pubData?.share_url) {
                          setPublishResult({
                            publicId: pubData.public_id as string,
                            shareUrl: pubData.share_url as string,
                          });
                        }
                      } catch (err) {
                        setError("Failed to publish. Please try again.");
                        console.error(err);
                      } finally {
                        setIsSubmitting(false);
                      }
                    }}
                  >
                    {isSubmitting ? "Publishing..." : "Save & Get Share Link"}
                    {!isSubmitting && <span>→</span>}
                  </button>
                  {error && <p className="form-error" style={{ marginTop: 8 }}>{error}</p>}
                </div>
              </div>
              </div>
            </div>
          );
        })()
      )}
    </div>
  );
}

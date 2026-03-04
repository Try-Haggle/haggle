import { useState, useEffect, useRef, useCallback } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import StepIndicator from "./components/StepIndicator";
import TagInput from "./components/TagInput";
import ChipSelector from "./components/ChipSelector";

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

      {/* Back button — above step indicator on Step 2+ */}
      {currentStep > 1 && (
        <button
          type="button"
          className="btn-back"
          onClick={() => { setCurrentStep(currentStep - 1); setError(null); }}
        >
          ← Back
        </button>
      )}

      {/* Step Indicator */}
      <StepIndicator currentStep={currentStep} steps={STEPS} />

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
        <div>
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
        /* Step 3 Placeholder */
        <div className="placeholder">
          <p className="placeholder__title">AI Agent Setup</p>
          <p className="placeholder__text">
            AI Agent configuration will be available in Slice 3.
          </p>
        </div>
      )}
    </div>
  );
}

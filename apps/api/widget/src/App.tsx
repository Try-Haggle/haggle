import { useState, useEffect, useRef } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import StepIndicator from "./components/StepIndicator";
import TagInput from "./components/TagInput";
import ChipSelector from "./components/ChipSelector";

const STEPS = [{ label: "Item Details" }, { label: "Pricing" }];

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
  const { app } = useApp({
    appInfo: { name: "haggle-listing-widget", version: "0.1.0" },
    capabilities: {},
  });

  // Form state
  const [draftId, setDraftId] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [category, setCategory] = useState("electronics");
  const [condition, setCondition] = useState<string | null>(null);

  // UI state
  const [currentStep, setCurrentStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isFormValid = !!photoFile && !!title.trim();

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  // Receive draft data from haggle_start_draft tool result
  useEffect(() => {
    if (!app) return;

    app.ontoolresult = (result) => {
      const data = result.structuredContent as Record<string, unknown>;
      if (!data?.draft_id) return;

      setDraftId(data.draft_id as string);

      // Pre-fill form if draft already has data (e.g., from chat auto-fill)
      const draft = data.draft as Record<string, unknown> | undefined;
      if (draft) {
        if (draft.title) setTitle(draft.title as string);
        if (draft.description) setDescription(draft.description as string);
        if (draft.tags) setTags(draft.tags as string[]);
        if (draft.category) setCategory(draft.category as string);
        if (draft.condition) setCondition(draft.condition as string);
      }
    };
  }, [app]);

  const handleNext = async () => {
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

  return (
    <div className="widget">
      {/* Header */}
      <div className="header">
        <span className="header__logo">Haggle</span>
      </div>

      {/* Step Indicator */}
      <StepIndicator currentStep={currentStep} steps={STEPS} />

      {currentStep === 1 ? (
        <>
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
            onClick={handleNext}
            disabled={!isFormValid || isSubmitting}
          >
            {isSubmitting ? "Saving..." : "Next: Set Pricing"}
            {!isSubmitting && <span>→</span>}
          </button>
        </>
      ) : (
        /* Step 2 Placeholder */
        <div className="placeholder">
          <p className="placeholder__title">Set Pricing</p>
          <p className="placeholder__text">
            Pricing will be available in Slice 2.
          </p>
        </div>
      )}
    </div>
  );
}

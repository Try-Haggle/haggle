"use client";

import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

const CATEGORIES = [
  { value: "", label: "Select category" },
  { value: "electronics", label: "Electronics" },
  { value: "fashion", label: "Fashion" },
  { value: "home", label: "Home" },
  { value: "sports", label: "Sports" },
  { value: "vehicles", label: "Vehicles" },
  { value: "other", label: "Other" },
];

const CONDITIONS = [
  { value: "", label: "Select condition" },
  { value: "new", label: "New" },
  { value: "like_new", label: "Like New" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
  { value: "poor", label: "Poor" },
];

interface DraftForm {
  title: string;
  category: string;
  brand: string;
  model: string;
  condition: string;
  description: string;
  target_price: string;
  floor_price: string;
}

const EMPTY_FORM: DraftForm = {
  title: "",
  category: "",
  brand: "",
  model: "",
  condition: "",
  description: "",
  target_price: "",
  floor_price: "",
};

export default function ListingWidgetPage() {
  const [draftId, setDraftId] = useState<string | null>(null);
  const [form, setForm] = useState<DraftForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Extract draft_id from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("draft_id");
    if (!id) {
      setError("Missing draft_id parameter");
      setLoading(false);
      return;
    }
    setDraftId(id);
  }, []);

  // Fetch draft data
  useEffect(() => {
    if (!draftId) return;

    async function fetchDraft() {
      try {
        const res = await fetch(`${API_URL}/api/drafts/${draftId}`);
        const json = await res.json();
        if (!res.ok) {
          setError(json.error?.message || "Failed to load draft");
          return;
        }
        const d = json.data;
        setForm({
          title: d.title || "",
          category: d.category || "",
          brand: d.brand || "",
          model: d.model || "",
          condition: d.condition || "",
          description: d.description || "",
          target_price: d.target_price || "",
          floor_price: d.floor_price || "",
        });
      } catch {
        setError("Failed to connect to server");
      } finally {
        setLoading(false);
      }
    }

    fetchDraft();
  }, [draftId]);

  function handleChange(
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >,
  ) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setMessage(null);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!draftId) return;
    setSaving(true);
    setMessage(null);
    setError(null);

    // Build patch — only send non-empty fields
    const patch: Record<string, string> = {};
    for (const [key, value] of Object.entries(form)) {
      if (value) patch[key] = value;
    }

    try {
      const res = await fetch(`${API_URL}/api/drafts/${draftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error?.message || "Failed to save");
        return;
      }
      // Refresh form with server response
      const d = json.data;
      setForm({
        title: d.title || "",
        category: d.category || "",
        brand: d.brand || "",
        model: d.model || "",
        condition: d.condition || "",
        description: d.description || "",
        target_price: d.target_price || "",
        floor_price: d.floor_price || "",
      });
      setMessage("Saved!");
    } catch {
      setError("Failed to connect to server");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading draft...</p>
      </div>
    );
  }

  if (error && !draftId) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  const inputClass =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
  const labelClass = "block text-sm font-medium text-gray-700 mb-1";

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">
        Listing Details
      </h1>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {message && (
        <div className="mb-4 rounded-md bg-green-50 p-3 text-sm text-green-700">
          {message}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label htmlFor="title" className={labelClass}>
            Title
          </label>
          <input
            id="title"
            name="title"
            type="text"
            maxLength={200}
            value={form.title}
            onChange={handleChange}
            placeholder="e.g. iPhone 15 Pro 256GB"
            className={inputClass}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="category" className={labelClass}>
              Category
            </label>
            <select
              id="category"
              name="category"
              value={form.category}
              onChange={handleChange}
              className={inputClass}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="condition" className={labelClass}>
              Condition
            </label>
            <select
              id="condition"
              name="condition"
              value={form.condition}
              onChange={handleChange}
              className={inputClass}
            >
              {CONDITIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="brand" className={labelClass}>
              Brand
            </label>
            <input
              id="brand"
              name="brand"
              type="text"
              maxLength={100}
              value={form.brand}
              onChange={handleChange}
              placeholder="e.g. Apple"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="model" className={labelClass}>
              Model
            </label>
            <input
              id="model"
              name="model"
              type="text"
              maxLength={100}
              value={form.model}
              onChange={handleChange}
              placeholder="e.g. iPhone 15 Pro"
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label htmlFor="description" className={labelClass}>
            Description
          </label>
          <textarea
            id="description"
            name="description"
            maxLength={2000}
            rows={4}
            value={form.description}
            onChange={handleChange}
            placeholder="Describe your item..."
            className={inputClass}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="target_price" className={labelClass}>
              Target Price ($)
            </label>
            <input
              id="target_price"
              name="target_price"
              type="text"
              inputMode="decimal"
              value={form.target_price}
              onChange={handleChange}
              placeholder="0.00"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="floor_price" className={labelClass}>
              Floor Price ($)
            </label>
            <input
              id="floor_price"
              name="floor_price"
              type="text"
              inputMode="decimal"
              value={form.floor_price}
              onChange={handleChange}
              placeholder="0.00"
              className={inputClass}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Draft"}
        </button>
      </form>
    </div>
  );
}

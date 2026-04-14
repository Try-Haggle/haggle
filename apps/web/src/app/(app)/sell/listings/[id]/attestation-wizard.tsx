"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";

type WizardStep = 1 | 2 | 3 | 4 | 5;

interface PresignResponse {
  uploadUrl: string;
  storagePath: string;
  token: string;
  expiresIn: number;
}

function StepIndicator({ current, total }: { current: WizardStep; total: number }) {
  return (
    <div className="flex items-center gap-1 mb-6">
      {Array.from({ length: total }, (_, i) => i + 1).map((step) => (
        <div key={step} className="flex items-center gap-1">
          <div
            className={`h-2 w-2 rounded-full transition-colors ${
              step < current
                ? "bg-emerald-500"
                : step === current
                ? "bg-cyan-500"
                : "bg-slate-700"
            }`}
          />
          {step < total && <div className={`h-px w-4 ${step < current ? "bg-emerald-500/50" : "bg-slate-700"}`} />}
        </div>
      ))}
      <span className="ml-2 text-xs text-slate-500">{current} / {total}</span>
    </div>
  );
}

export function AttestationWizard({
  listingId,
  onComplete,
  onCancel,
}: {
  listingId: string;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<WizardStep>(1);
  const [imei, setImei] = useState("");
  const [batteryHealth, setBatteryHealth] = useState("");
  const [findMyOff, setFindMyOff] = useState(false);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedPaths, setUploadedPaths] = useState<string[]>([]);

  function validateStep(): string | null {
    if (step === 1) {
      if (!/^\d{15}$/.test(imei)) return "IMEI must be exactly 15 digits";
    }
    if (step === 2) {
      const pct = parseInt(batteryHealth);
      if (isNaN(pct) || pct < 0 || pct > 100) return "Battery health must be between 0 and 100";
    }
    if (step === 3) {
      if (!findMyOff) return "You must confirm Find My is disabled before selling";
    }
    if (step === 4) {
      if (photoFiles.length === 0) return "At least one photo is required";
    }
    return null;
  }

  async function handleUploadPhotos(): Promise<string[] | null> {
    setUploading(true);
    const paths: string[] = [];
    try {
      for (const file of photoFiles) {
        const presign = await api.post<PresignResponse>("/api/attestation/presigned-upload", {
          listingId,
          filename: file.name,
          contentType: file.type,
        });
        await fetch(presign.uploadUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
        });
        paths.push(presign.storagePath);
      }
      return paths;
    } catch {
      return null;
    } finally {
      setUploading(false);
    }
  }

  async function handleNext() {
    const validationError = validateStep();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);

    if (step === 4) {
      // Upload photos before proceeding to review
      const paths = await handleUploadPhotos();
      if (!paths) {
        setError("Failed to upload photos. Please try again.");
        return;
      }
      setUploadedPaths(paths);
    }

    setStep((prev) => (prev + 1) as WizardStep);
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/api/attestation/commit", {
        listingId,
        imei,
        batteryHealthPct: parseInt(batteryHealth),
        findMyOff,
        photoStoragePaths: uploadedPaths,
      });
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit attestation");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h2 className="text-base font-bold text-white">Complete Attestation</h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="p-5">
          <StepIndicator current={step} total={5} />

          {/* Step 1: IMEI */}
          {step === 1 && (
            <div>
              <h3 className="text-sm font-semibold text-white mb-1">Enter IMEI</h3>
              <p className="text-xs text-slate-400 mb-4">Find it in Settings → General → About, or dial *#06#</p>
              <input
                type="text"
                placeholder="15-digit IMEI"
                value={imei}
                onChange={(e) => setImei(e.target.value.replace(/\D/g, "").slice(0, 15))}
                maxLength={15}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none font-mono tracking-wider"
              />
              <p className="text-xs text-slate-600 mt-1">{imei.length} / 15 digits</p>
            </div>
          )}

          {/* Step 2: Battery health */}
          {step === 2 && (
            <div>
              <h3 className="text-sm font-semibold text-white mb-1">Battery Health</h3>
              <p className="text-xs text-slate-400 mb-4">Find it in Settings → Battery → Battery Health & Charging</p>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="100"
                  placeholder="e.g. 89"
                  value={batteryHealth}
                  onChange={(e) => setBatteryHealth(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 pr-8 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">%</span>
              </div>
            </div>
          )}

          {/* Step 3: Find My */}
          {step === 3 && (
            <div>
              <h3 className="text-sm font-semibold text-white mb-1">Disable Find My</h3>
              <p className="text-xs text-slate-400 mb-4">
                Go to Settings → [Your Name] → Find My → Find My iPhone and turn it off. The buyer cannot activate the device without this step.
              </p>
              <label className="flex items-start gap-3 cursor-pointer group">
                <div
                  className={`mt-0.5 h-5 w-5 shrink-0 rounded border-2 transition-colors flex items-center justify-center ${
                    findMyOff
                      ? "bg-cyan-500 border-cyan-500"
                      : "border-slate-600 group-hover:border-slate-500"
                  }`}
                  onClick={() => setFindMyOff((v) => !v)}
                >
                  {findMyOff && (
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </div>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={findMyOff}
                  onChange={(e) => setFindMyOff(e.target.checked)}
                />
                <span className="text-sm text-slate-300 leading-5">
                  I confirm that Find My iPhone is disabled on this device
                </span>
              </label>
            </div>
          )}

          {/* Step 4: Photos */}
          {step === 4 && (
            <div>
              <h3 className="text-sm font-semibold text-white mb-1">Upload Photos</h3>
              <p className="text-xs text-slate-400 mb-4">Take photos of the device: front, back, sides, and any damage</p>
              <label className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-700 hover:border-slate-600 bg-slate-800/50 py-8 cursor-pointer transition-colors">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                <span className="text-sm text-slate-400">
                  {photoFiles.length > 0 ? `${photoFiles.length} file(s) selected` : "Click to select photos"}
                </span>
                <span className="text-xs text-slate-600">JPEG, PNG, HEIC up to 20MB each</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  onChange={(e) => setPhotoFiles(Array.from(e.target.files ?? []))}
                />
              </label>
              {photoFiles.length > 0 && (
                <div className="mt-2 space-y-1">
                  {photoFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-slate-400">
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                      <span className="truncate">{f.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 5: Review */}
          {step === 5 && (
            <div>
              <h3 className="text-sm font-semibold text-white mb-4">Review & Submit</h3>
              <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-800/50 p-3 text-sm mb-4">
                <div className="flex justify-between">
                  <span className="text-slate-400">IMEI</span>
                  <span className="text-white font-mono">{imei}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Battery Health</span>
                  <span className="text-white">{batteryHealth}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Find My Disabled</span>
                  <span className={findMyOff ? "text-emerald-400" : "text-red-400"}>{findMyOff ? "Yes" : "No"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Photos</span>
                  <span className="text-white">{uploadedPaths.length} uploaded</span>
                </div>
              </div>
              <p className="text-xs text-slate-500">
                By submitting, you attest that this information is accurate. False attestations may result in account suspension.
              </p>
            </div>
          )}

          {error && (
            <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-5 py-4 border-t border-slate-800">
          {step > 1 && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStep((prev) => (prev - 1) as WizardStep);
              }}
              disabled={uploading || submitting}
              className="flex-1 rounded-xl border border-slate-700 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-40 transition-colors"
            >
              Back
            </button>
          )}
          {step < 5 ? (
            <button
              type="button"
              onClick={handleNext}
              disabled={uploading}
              className="flex-1 rounded-xl bg-cyan-500 py-2.5 text-sm font-semibold text-white hover:bg-cyan-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {uploading ? "Uploading..." : "Continue"}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="flex-1 rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "Submitting..." : "Submit Attestation"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

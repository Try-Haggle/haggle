"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { Alert, Button, Checkbox, Dropzone, Input, Modal, Stepper } from "@/components/ui";
import { api } from "@/lib/api-client";

type WizardStep = 1 | 2 | 3 | 4 | 5;

interface PresignResponse {
  uploadUrl: string;
  storagePath: string;
  token: string;
  expiresIn: number;
}

const STEP_LABELS = ["IMEI", "Battery Health", "Find My", "Photos", "Review"];

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
      const pct = parseInt(batteryHealth, 10);
      if (Number.isNaN(pct) || pct < 0 || pct > 100)
        return "Battery health must be between 0 and 100";
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
        batteryHealthPct: parseInt(batteryHealth, 10),
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
    <Modal
      open
      onClose={onCancel}
      title="Complete Attestation"
      size="md"
      footer={
        <div className="flex w-full gap-3">
          {step > 1 && (
            <Button
              variant="secondary"
              className="flex-1"
              disabled={uploading || submitting}
              onClick={() => {
                setError(null);
                setStep((prev) => (prev - 1) as WizardStep);
              }}
            >
              Back
            </Button>
          )}
          {step < 5 ? (
            <Button className="flex-1" loading={uploading} onClick={handleNext}>
              {uploading ? "Uploading..." : "Continue"}
            </Button>
          ) : (
            <Button className="flex-1" loading={submitting} onClick={handleSubmit}>
              {submitting ? "Submitting..." : "Submit Attestation"}
            </Button>
          )}
        </div>
      }
    >
      <Stepper steps={STEP_LABELS} current={step - 1} showLabels={false} className="mb-6" />

      {/* Step 1: IMEI */}
      {step === 1 && (
        <div>
          <h3 className="mb-1 font-semibold text-ink text-sm">Enter IMEI</h3>
          <p className="mb-4 text-ink-secondary text-xs">
            Find it in Settings → General → About, or dial *#06#
          </p>
          <Input
            placeholder="15-digit IMEI"
            value={imei}
            onChange={(e) => setImei(e.target.value.replace(/\D/g, "").slice(0, 15))}
            maxLength={15}
            className="font-mono tracking-wider"
          />
          <p className="mt-1 text-ink-muted text-xs">{imei.length} / 15 digits</p>
        </div>
      )}

      {/* Step 2: Battery health */}
      {step === 2 && (
        <div>
          <h3 className="mb-1 font-semibold text-ink text-sm">Battery Health</h3>
          <p className="mb-4 text-ink-secondary text-xs">
            Find it in Settings → Battery → Battery Health & Charging
          </p>
          <Input
            type="number"
            min="0"
            max="100"
            placeholder="e.g. 89"
            value={batteryHealth}
            onChange={(e) => setBatteryHealth(e.target.value)}
            endAdornment="%"
          />
        </div>
      )}

      {/* Step 3: Find My */}
      {step === 3 && (
        <div>
          <h3 className="mb-1 font-semibold text-ink text-sm">Disable Find My</h3>
          <p className="mb-4 text-ink-secondary text-xs">
            Go to Settings → [Your Name] → Find My → Find My iPhone and turn it off. The buyer
            cannot activate the device without this step.
          </p>
          <Checkbox
            checked={findMyOff}
            onChange={(e) => setFindMyOff(e.target.checked)}
            label="I confirm that Find My iPhone is disabled on this device"
          />
        </div>
      )}

      {/* Step 4: Photos */}
      {step === 4 && (
        <div>
          <h3 className="mb-1 font-semibold text-ink text-sm">Upload Photos</h3>
          <p className="mb-4 text-ink-secondary text-xs">
            Take photos of the device: front, back, sides, and any damage
          </p>
          <Dropzone
            accept="image/*"
            multiple
            onFiles={setPhotoFiles}
            buttonLabel="Select photos"
            label={
              photoFiles.length > 0
                ? `${photoFiles.length} file(s) selected`
                : "Click to select photos"
            }
            hint="JPEG, PNG, HEIC up to 20MB each"
          />
          {photoFiles.length > 0 && (
            <div className="mt-2 space-y-1">
              {photoFiles.map((f) => (
                <div
                  key={`${f.name}-${f.size}`}
                  className="flex items-center gap-2 text-ink-secondary text-xs"
                >
                  <Check className="size-3 shrink-0 text-success" />
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
          <h3 className="mb-4 font-semibold text-ink text-sm">Review & Submit</h3>
          <div className="mb-4 space-y-2 rounded-lg border border-line bg-surface-sunken/50 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-ink-secondary">IMEI</span>
              <span className="font-mono text-ink">{imei}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-secondary">Battery Health</span>
              <span className="text-ink">{batteryHealth}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-secondary">Find My Disabled</span>
              <span className={findMyOff ? "text-success" : "text-error"}>
                {findMyOff ? "Yes" : "No"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-secondary">Photos</span>
              <span className="text-ink">{uploadedPaths.length} uploaded</span>
            </div>
          </div>
          <p className="text-ink-muted text-xs">
            By submitting, you attest that this information is accurate. False attestations may
            result in account suspension.
          </p>
        </div>
      )}

      {error && (
        <Alert tone="error" className="mt-3">
          {error}
        </Alert>
      )}
    </Modal>
  );
}

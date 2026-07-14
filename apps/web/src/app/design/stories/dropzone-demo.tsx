"use client";

import { useState } from "react";
import { Dropzone } from "@/components/ui/dropzone";

export function DropzoneDemo() {
  const [names, setNames] = useState<string[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <Dropzone
        multiple
        accept="image/*"
        hint="PNG·JPG, 최대 5MB"
        onFiles={(files) => setNames(files.map((f) => f.name))}
      />
      {names.length > 0 && <p className="text-ink-muted text-xs">선택됨: {names.join(", ")}</p>}

      {/* Image-preview mode (single image upload). */}
      <Dropzone
        accept="image/*"
        className="aspect-square w-full max-w-xs"
        preview={preview ?? undefined}
        previewLabel="Change photo"
        buttonLabel=""
        label="Click or drag a photo"
        hint="Preview mode"
        onFiles={(files) => {
          const f = files[0];
          if (f) setPreview(URL.createObjectURL(f));
        }}
      />
    </div>
  );
}

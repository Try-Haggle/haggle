"use client";

import { useState } from "react";
import { Dropzone } from "@/components/ui/dropzone";

export function DropzoneDemo() {
  const [names, setNames] = useState<string[]>([]);
  return (
    <div className="space-y-2">
      <Dropzone
        multiple
        accept="image/*"
        hint="PNG·JPG, 최대 5MB"
        onFiles={(files) => setNames(files.map((f) => f.name))}
      />
      {names.length > 0 && <p className="text-ink-muted text-xs">선택됨: {names.join(", ")}</p>}
    </div>
  );
}

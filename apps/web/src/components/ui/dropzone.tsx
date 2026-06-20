"use client";

import { Upload } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export interface DropzoneProps {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  label?: ReactNode;
  hint?: ReactNode;
  className?: string;
}

export function Dropzone({ onFiles, accept, multiple, label, hint, className }: DropzoneProps) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const emit = (files: FileList | null) => {
    if (files && files.length > 0) onFiles(Array.from(files));
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop is an enhancement; the "파일 선택" button is the accessible control
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        emit(e.dataTransfer.files);
      }}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
        over ? "border-action-primary bg-action-primary/5" : "border-line",
        className,
      )}
    >
      <Upload className="size-6 text-ink-muted" />
      <div className="text-ink-secondary text-sm">{label ?? "파일을 끌어다 놓으세요"}</div>
      {hint && <div className="text-ink-muted text-xs">{hint}</div>}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="mt-1 rounded-lg border border-line px-3 py-1.5 text-ink-secondary text-sm transition hover:border-line-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60"
      >
        파일 선택
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(e) => emit(e.target.files)}
        className="hidden"
      />
    </div>
  );
}

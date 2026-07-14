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
  disabled?: boolean;
  buttonLabel?: string;
  /** Image URL — renders a filling preview with a hover/drag "change" overlay
   *  instead of the empty prompt. Give the Dropzone a size via `className`
   *  (e.g. `aspect-square w-full`) when using this. */
  preview?: string;
  /** Overlay action text shown over the preview on hover (default "Change"). */
  previewLabel?: string;
  id?: string;
  className?: string;
}

export function Dropzone({
  onFiles,
  accept,
  multiple,
  label,
  hint,
  disabled = false,
  buttonLabel = "파일 선택",
  preview,
  previewLabel = "Change",
  id,
  className,
}: DropzoneProps) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const emit = (files: FileList | null) => {
    if (files && files.length > 0) onFiles(Array.from(files));
  };

  return (
    <>
      {/* The whole zone is the file-select control (click + drag-drop). */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          if (disabled) return;
          e.preventDefault();
          setOver(false);
          emit(e.dataTransfer.files);
        }}
        className={cn(
          "group relative flex cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60 disabled:cursor-not-allowed disabled:opacity-50",
          over ? "border-action-primary bg-action-primary/5" : "border-line",
          !preview && "p-8",
          className,
        )}
      >
        {preview ? (
          <>
            {/* biome-ignore lint/performance/noImgElement: object-URL / remote image preview */}
            <img src={preview} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <span
              className={cn(
                "absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 text-white transition-opacity",
                over ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              )}
            >
              <Upload className="size-7" />
              <span className="font-medium text-sm">{over ? "Drop to replace" : previewLabel}</span>
            </span>
          </>
        ) : (
          <>
            <Upload className="size-6 text-ink-muted" />
            <span className="text-ink-secondary text-sm">{label ?? "파일을 끌어다 놓으세요"}</span>
            {hint && <span className="text-ink-muted text-xs">{hint}</span>}
            {buttonLabel && (
              <span className="mt-1 rounded-lg border border-line px-3 py-1.5 text-ink-secondary text-sm transition group-hover:border-line-strong group-hover:text-ink">
                {buttonLabel}
              </span>
            )}
          </>
        )}
      </button>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(e) => emit(e.target.files)}
        className="hidden"
      />
    </>
  );
}

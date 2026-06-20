"use client";

import { useState } from "react";
import { Slider } from "@/components/ui/slider";

export function SliderDemo({ step, disabled }: { step: number; disabled: boolean }) {
  const [value, setValue] = useState(40);
  return (
    <div className="space-y-2">
      <Slider
        value={value}
        onValueChange={setValue}
        step={step}
        disabled={disabled}
        aria-label="값"
      />
      <div className="text-center text-ink-muted text-sm tabular-nums">{value}</div>
    </div>
  );
}

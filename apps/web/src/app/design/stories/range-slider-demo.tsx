"use client";

import { useState } from "react";
import { RangeSlider } from "@/components/ui/slider";

export function RangeSliderDemo({ step, disabled }: { step: number; disabled: boolean }) {
  const [value, setValue] = useState<[number, number]>([25, 75]);
  return (
    <div className="space-y-2">
      <RangeSlider
        value={value}
        onValueChange={setValue}
        step={step}
        disabled={disabled}
        minLabel="최소"
        maxLabel="최대"
      />
      <div className="flex justify-between text-ink-muted text-sm tabular-nums">
        <span>{value[0]}</span>
        <span>{value[1]}</span>
      </div>
    </div>
  );
}

"use client";

import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/cn";

export interface SliderProps {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  name?: string;
  "aria-label"?: string;
  className?: string;
}

export function Slider({
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  name,
  className,
  ...rest
}: SliderProps) {
  return (
    <SliderPrimitive.Root
      min={min}
      max={max}
      step={step}
      value={[value]}
      disabled={disabled}
      name={name}
      onValueChange={(v) => onValueChange(v[0])}
      className={cn(
        "relative flex w-full touch-none select-none items-center data-[disabled]:opacity-50",
        className,
      )}
      {...rest}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow rounded-full bg-line">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-action-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={rest["aria-label"]}
        className="block size-4 rounded-full bg-action-primary shadow transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60"
      />
    </SliderPrimitive.Root>
  );
}

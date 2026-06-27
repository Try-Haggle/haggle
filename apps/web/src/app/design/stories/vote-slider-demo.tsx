"use client";

import { useState } from "react";
import { VoteSlider } from "@/components/ui/vote-slider";

export function VoteSliderDemo({ withAmount }: { withAmount: boolean }) {
  const [value, setValue] = useState(50);
  return <VoteSlider value={value} onChange={setValue} amount={withAmount ? 1000 : undefined} />;
}

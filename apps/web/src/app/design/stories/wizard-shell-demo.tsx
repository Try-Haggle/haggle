"use client";

import { useState } from "react";
import { WizardShell } from "@/components/ui/wizard-shell";

const STEPS = ["기본 정보", "사진", "가격", "검토"];

export function WizardShellDemo() {
  const [current, setCurrent] = useState(0);
  return (
    <WizardShell
      steps={STEPS}
      current={current}
      title={STEPS[current]}
      subtitle="단계별로 리스팅을 완성하세요."
      onBack={() => setCurrent((c) => Math.max(0, c - 1))}
      onNext={() => setCurrent((c) => Math.min(STEPS.length - 1, c + 1))}
      onSubmit={() => setCurrent(0)}
    >
      <div className="rounded-xl border border-line border-dashed p-8 text-center text-ink-muted text-sm">
        {STEPS[current]} 단계 내용
      </div>
    </WizardShell>
  );
}

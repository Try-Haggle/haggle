"use client";

import type { StageTrace } from "@/lib/demo-types";
import { StageCard } from "./stage-card";

interface PipelineViewerProps {
  stages: StageTrace[];
  label?: string;
}

export function PipelineViewer({ stages, label }: PipelineViewerProps) {
  if (stages.length === 0) return null;

  // Calculate totals
  const totalLatency = stages.reduce((sum, s) => sum + s.latency_ms, 0);
  const totalTokens = stages.reduce(
    (sum, s) => sum + (s.tokens ? s.tokens.prompt + s.tokens.completion : 0),
    0,
  );
  const llmCount = stages.filter((s) => s.is_llm).length;
  const codeCount = stages.length - llmCount;

  return (
    <div className="relative">
      {label && (
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider">{label}</h3>
          <div className="flex items-center gap-3 text-[10px] font-mono text-ink-muted">
            <span>{totalLatency}ms 총 소요</span>
            {totalTokens > 0 && <span>{totalTokens.toLocaleString()} 토큰</span>}
            <span className="text-info">{llmCount} LLM</span>
            <span className="text-success">{codeCount} 코드</span>
          </div>
        </div>
      )}

      {/* Vertical timeline line */}
      <div className="absolute left-4 top-10 bottom-4 w-px bg-line" />

      <div className="space-y-3 pl-8 relative">
        {stages.map((stage, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: stage names can repeat across a pipeline, index disambiguates
          <div key={`${stage.stage}-${i}`} className="relative">
            {/* Timeline dot */}
            <div
              className={`absolute -left-8 top-4 w-2.5 h-2.5 rounded-full border-2 ${
                stage.is_llm ? "border-info bg-info-soft" : "border-success bg-success-soft"
              }`}
            />
            <StageCard stage={stage} index={i} />
          </div>
        ))}
      </div>
    </div>
  );
}

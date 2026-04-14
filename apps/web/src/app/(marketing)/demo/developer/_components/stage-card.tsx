"use client";

import { useState } from "react";
import type { StageTrace } from "@/lib/demo-types";

/** Stage name mapping to Korean */
const STAGE_LABELS: Record<string, string> = {
  "0a_STRATEGY_GENERATION": "0a: 전략 생성",
  "0b_TERM_ANALYSIS": "0b: 조건 분석",
  "1_UNDERSTAND": "1: 의도 파악 (UNDERSTAND)",
  "2_CONTEXT": "2: 컨텍스트 조립 (CONTEXT)",
  "3_DECIDE": "3: 결정 (DECIDE)",
  "4_VALIDATE": "4: 검증 (VALIDATE)",
  "5_RESPOND": "5: 응답 생성 (RESPOND)",
  "6_PERSIST_TRANSITION": "6: 저장/전이 (PERSIST)",
};

function formatStageName(raw: string): string {
  return STAGE_LABELS[raw] ?? raw;
}

function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-t border-slate-700/50 mt-2 pt-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 hover:text-slate-300 transition-colors cursor-pointer w-full text-left"
      >
        <span className={`transition-transform duration-150 text-[9px] ${open ? "rotate-90" : ""}`}>
          &#9654;
        </span>
        {title}
      </button>
      {open && (
        <div className="mt-1.5" style={{ animation: "fadeInUp 0.15s ease-out" }}>
          {children}
        </div>
      )}
    </div>
  );
}

function CodeBlock({ content }: { content: unknown }) {
  const text =
    typeof content === "string"
      ? content
      : JSON.stringify(content, null, 2);

  return (
    <pre className="text-[11px] font-mono text-slate-400 bg-slate-900/80 rounded-lg p-3 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap break-words">
      {text}
    </pre>
  );
}

interface StageCardProps {
  stage: StageTrace;
  index: number;
}

export function StageCard({ stage, index }: StageCardProps) {
  const totalTokens = stage.tokens
    ? stage.tokens.prompt + stage.tokens.completion
    : 0;

  return (
    <div
      className="rounded-xl border border-slate-700/80 bg-slate-800/50 p-4"
      style={{ animation: `fadeInUp 0.3s ease-out ${index * 0.08}s both` }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          {stage.is_llm ? (
            <span className="inline-flex items-center rounded-md bg-purple-500/20 px-2 py-0.5 text-[10px] font-semibold text-purple-300 uppercase tracking-wider">
              LLM
            </span>
          ) : (
            <span className="inline-flex items-center rounded-md bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 uppercase tracking-wider">
              코드
            </span>
          )}
          <h4 className="text-sm font-semibold text-white">
            {formatStageName(stage.stage)}
          </h4>
        </div>
        <div className="flex items-center gap-3 text-[11px] font-mono text-slate-500">
          <span>{stage.latency_ms}ms</span>
          {stage.tokens && (
            <span>{totalTokens.toLocaleString()} 토큰</span>
          )}
        </div>
      </div>

      {/* LLM-specific sections */}
      {stage.is_llm && (
        <>
          {stage.system_prompt && (
            <CollapsibleSection title="시스템 프롬프트">
              <CodeBlock content={stage.system_prompt} />
            </CollapsibleSection>
          )}
          {stage.user_prompt && (
            <CollapsibleSection title="유저 프롬프트">
              <CodeBlock content={stage.user_prompt} />
            </CollapsibleSection>
          )}
          {stage.raw_response !== undefined && stage.raw_response !== null && (
            <CollapsibleSection title="LLM 원본 응답">
              <CodeBlock content={stage.raw_response} />
            </CollapsibleSection>
          )}
        </>
      )}

      {/* Code-specific sections */}
      {!stage.is_llm && (
        <>
          {stage.input !== undefined && stage.input !== null && (
            <CollapsibleSection title="입력 데이터">
              <CodeBlock content={stage.input} />
            </CollapsibleSection>
          )}
          {/* Stage 2 CONTEXT: separate Briefing + Advisories display */}
          {stage.stage === "2_CONTEXT" && stage.parsed && typeof stage.parsed === "object" ? (
            <>
              {(stage.parsed as Record<string, unknown>).briefing && (
                <CollapsibleSection title="Briefing (Facts)" defaultOpen>
                  <CodeBlock content={(stage.parsed as Record<string, unknown>).briefing} />
                </CollapsibleSection>
              )}
              {(stage.parsed as Record<string, unknown>).advisories && (
                <CollapsibleSection title="Advisories (May ignore)" defaultOpen>
                  <CodeBlock content={(stage.parsed as Record<string, unknown>).advisories} />
                </CollapsibleSection>
              )}
              {stage.output !== undefined && stage.output !== null && (
                <CollapsibleSection title="전체 출력 데이터">
                  <CodeBlock content={stage.output} />
                </CollapsibleSection>
              )}
            </>
          ) : (
            stage.output !== undefined && stage.output !== null && (
              <CollapsibleSection title="출력 데이터">
                <CodeBlock content={stage.output} />
              </CollapsibleSection>
            )
          )}
        </>
      )}

      {/* Parsed — always available */}
      {stage.parsed !== undefined && stage.parsed !== null && (
        <CollapsibleSection title="파싱된 결과" defaultOpen>
          <CodeBlock content={stage.parsed} />
        </CollapsibleSection>
      )}
    </div>
  );
}

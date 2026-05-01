"use client";

import { useEffect, useState } from "react";
import {
  getTagGardenIntelligence,
  type TagGardenIntelligenceSnapshot,
  type TagGardenSignalAction,
} from "@/lib/intelligence-demo-api";

const ACTION_LABELS: Record<TagGardenSignalAction, string> = {
  promote_candidate: "trend",
  merge_candidate: "merge",
  deprecate_tag: "deprecate",
  reject_noise: "noise",
  watch: "watch",
};

const ACTION_CLASSES: Record<TagGardenSignalAction, string> = {
  promote_candidate: "border-emerald-500/20 bg-emerald-500/10 text-emerald-100",
  merge_candidate: "border-cyan-500/20 bg-cyan-500/10 text-cyan-100",
  deprecate_tag: "border-amber-500/20 bg-amber-500/10 text-amber-100",
  reject_noise: "border-red-500/20 bg-red-500/10 text-red-100",
  watch: "border-slate-600 bg-slate-800 text-slate-200",
};

export function TagGardenIntelligencePanel() {
  const [snapshot, setSnapshot] = useState<TagGardenIntelligenceSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await getTagGardenIntelligence(8));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tag Garden intelligence를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <section className="mt-5 rounded-2xl border border-slate-700 bg-slate-900/60 p-4 shadow-xl shadow-slate-950/30 sm:p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-1 inline-flex rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-200">
            Tag Garden Intelligence
          </div>
          <h2 className="text-xl font-bold text-white">트렌드 · 병합 · 폐기 후보</h2>
          <p className="mt-1 text-sm text-slate-400">
            대화 신호와 태그 제안 큐를 읽어 Tag Garden 운영 후보를 계산합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition-colors hover:border-emerald-400/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "분석 중" : "새로 분석"}
        </button>
      </div>

      {snapshot && (
        <div className="mb-3 grid gap-2 text-xs sm:grid-cols-4">
          <SummaryItem label="trend" value={snapshot.summary.trendCandidates} />
          <SummaryItem label="merge" value={snapshot.summary.mergeCandidates} />
          <SummaryItem label="deprecate" value={snapshot.summary.deprecateCandidates} />
          <SummaryItem label="noise" value={snapshot.summary.noiseCandidates} />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-100">
          {error}
        </div>
      )}

      {!error && snapshot?.signals.length === 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4 text-sm text-slate-500">
          아직 운영 후보로 볼 만큼 반복된 태그 신호가 없습니다.
        </div>
      )}

      {snapshot && snapshot.signals.length > 0 && (
        <div className="grid gap-2 md:grid-cols-2">
          {snapshot.signals.map((signal) => (
            <div
              key={`${signal.action}-${signal.normalizedLabel}-${JSON.stringify(signal.evidence)}`}
              className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${ACTION_CLASSES[signal.action]}`}>
                  {ACTION_LABELS[signal.action]}
                </span>
                <span className="font-mono text-xs text-slate-500">{signal.normalizedLabel}</span>
                <span className="ml-auto font-mono text-xs text-emerald-200">
                  {(signal.strength * 100).toFixed(0)}%
                </span>
              </div>
              <p className="text-sm font-semibold text-white">{signal.label}</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">{signal.reason}</p>
              {signal.category && (
                <p className="mt-2 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500">
                  {signal.category}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SummaryItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-lg font-bold text-white">{value}</p>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
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
  promote_candidate: "border-success/20 bg-success-soft text-success",
  merge_candidate: "border-info/20 bg-info-soft text-info",
  deprecate_tag: "border-warning/20 bg-warning-soft text-warning",
  reject_noise: "border-error/20 bg-error-soft text-error",
  watch: "border-line bg-surface-sunken text-ink-secondary",
};

export function TagGardenIntelligencePanel() {
  const [snapshot, setSnapshot] = useState<TagGardenIntelligenceSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await getTagGardenIntelligence(8));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Tag Garden intelligence를 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className="mt-5 rounded-2xl border border-line bg-surface-raised p-4 shadow-xl shadow-black/30 sm:p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-1 inline-flex rounded-full border border-success/25 bg-success-soft px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-success">
            Tag Garden Intelligence
          </div>
          <h2 className="text-xl font-bold text-ink">트렌드 · 병합 · 폐기 후보</h2>
          <p className="mt-1 text-sm text-ink-secondary">
            대화 신호와 태그 제안 큐를 읽어 Tag Garden 운영 후보를 계산합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ink-secondary transition-colors hover:border-success/60 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
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
        <div className="rounded-lg border border-error/20 bg-error-soft p-3 text-sm text-error">
          {error}
        </div>
      )}

      {!error && snapshot?.signals.length === 0 && (
        <div className="rounded-lg border border-line bg-surface-sunken p-4 text-sm text-ink-muted">
          아직 운영 후보로 볼 만큼 반복된 태그 신호가 없습니다.
        </div>
      )}

      {snapshot && snapshot.signals.length > 0 && (
        <div className="grid gap-2 md:grid-cols-2">
          {snapshot.signals.map((signal) => (
            <div
              key={`${signal.action}-${signal.normalizedLabel}-${JSON.stringify(signal.evidence)}`}
              className="rounded-xl border border-line bg-surface-sunken p-3"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${ACTION_CLASSES[signal.action]}`}
                >
                  {ACTION_LABELS[signal.action]}
                </span>
                <span className="font-mono text-xs text-ink-muted">{signal.normalizedLabel}</span>
                <span className="ml-auto font-mono text-xs text-success">
                  {(signal.strength * 100).toFixed(0)}%
                </span>
              </div>
              <p className="text-sm font-semibold text-ink">{signal.label}</p>
              <p className="mt-1 text-xs leading-5 text-ink-secondary">{signal.reason}</p>
              {signal.category && (
                <p className="mt-2 text-[10px] font-medium uppercase tracking-[0.12em] text-ink-muted">
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
    <div className="rounded-lg border border-line bg-surface-sunken p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
        {label}
      </p>
      <p className="mt-1 font-mono text-lg font-bold text-ink">{value}</p>
    </div>
  );
}

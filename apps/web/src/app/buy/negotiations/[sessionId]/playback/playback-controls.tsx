"use client";

import { motion } from "framer-motion";
import type { PlaybackEngine, PlaybackSpeed } from "./use-playback-engine";

interface PlaybackControlsProps {
  engine: PlaybackEngine;
}

const SPEEDS: PlaybackSpeed[] = [1, 2];

export function PlaybackControls({ engine }: PlaybackControlsProps) {
  const isPlaying = engine.status === "PLAYING";
  const isComplete = engine.status === "COMPLETE";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Pause / Resume */}
      {!isComplete && (
        <button
          type="button"
          onClick={isPlaying ? engine.pause : engine.resume}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] sm:text-[12px] font-medium transition-colors hover:bg-slate-800"
          style={{ background: "rgba(15,23,42,0.6)", border: "1px solid #1e293b", color: "#e2e8f0" }}
          aria-label={isPlaying ? "Pause" : "Resume"}
        >
          {isPlaying ? (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20" /></svg>
          )}
          {isPlaying ? "Pause" : "Resume"}
        </button>
      )}

      {/* Skip */}
      {!isComplete && (
        <button
          type="button"
          onClick={engine.skip}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] sm:text-[12px] font-medium transition-colors hover:bg-slate-800"
          style={{ background: "rgba(15,23,42,0.6)", border: "1px solid #1e293b", color: "#e2e8f0" }}
          aria-label="Skip to result"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 4 15 12 5 20" /><rect x="17" y="4" width="3" height="16" rx="1"/></svg>
          Skip
        </button>
      )}

      {/* Replay */}
      {isComplete && (
        <button
          type="button"
          onClick={engine.replay}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] sm:text-[12px] font-medium transition-colors hover:bg-slate-800"
          style={{ background: "rgba(15,23,42,0.6)", border: "1px solid #1e293b", color: "#e2e8f0" }}
          aria-label="Replay"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>
          Replay
        </button>
      )}

      {/* Speed selector */}
      <div
        className="flex overflow-hidden rounded-lg"
        style={{ background: "rgba(15,23,42,0.6)", border: "1px solid #1e293b" }}
      >
        {SPEEDS.map((s) => {
          const active = engine.speed === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => engine.setSpeed(s)}
              className="relative cursor-pointer px-2.5 py-1.5 text-[11px] sm:text-[12px] font-semibold transition-colors"
              style={{ color: active ? "#0f172a" : "#94a3b8" }}
              aria-label={`Speed ${s}x`}
              aria-pressed={active}
            >
              {active && (
                <motion.span
                  layoutId="speed-pill"
                  className="absolute inset-0.5 rounded-md"
                  style={{ background: "#e2e8f0" }}
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              <span className="relative">{s}×</span>
            </button>
          );
        })}
      </div>

    </div>
  );
}

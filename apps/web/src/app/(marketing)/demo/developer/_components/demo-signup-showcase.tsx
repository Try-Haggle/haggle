"use client";

import { useState, useEffect, useRef } from "react";

/* ── Types ────────────────────────────── */

type ShowcaseStep =
  | "idle"
  | "typing_email"
  | "google_click"
  | "google_popup"
  | "done";

/* ── Component ────────────────────────── */

export function DemoSignupShowcase() {
  const [step, setStep] = useState<ShowcaseStep>("idle");
  const [typedEmail, setTypedEmail] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  const DEMO_EMAIL = "buyer@example.com";

  // Typing animation
  useEffect(() => {
    if (step !== "typing_email") return;

    let idx = 0;
    const interval = setInterval(() => {
      if (idx < DEMO_EMAIL.length) {
        setTypedEmail(DEMO_EMAIL.slice(0, idx + 1));
        idx++;
      } else {
        clearInterval(interval);
        // After typing completes, auto-click Google
        setTimeout(() => setStep("google_click"), 600);
      }
    }, 60);

    return () => clearInterval(interval);
  }, [step]);

  // Google popup simulation
  useEffect(() => {
    if (step !== "google_click") return;
    const timer = setTimeout(() => setStep("google_popup"), 400);
    return () => clearTimeout(timer);
  }, [step]);

  useEffect(() => {
    if (step !== "google_popup") return;
    const timer = setTimeout(() => setStep("done"), 1500);
    return () => clearTimeout(timer);
  }, [step]);

  // Stopwatch
  useEffect(() => {
    if (step === "typing_email" && !timerRef.current) {
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsed(Date.now() - startTimeRef.current);
      }, 50);
    }
    if (step === "done" && timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [step]);

  const startDemo = () => {
    setStep("typing_email");
    setTypedEmail("");
    setElapsed(0);
  };

  const resetDemo = () => {
    setStep("idle");
    setTypedEmail("");
    setElapsed(0);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const elapsedStr = (elapsed / 1000).toFixed(1);

  return (
    <div
      className="rounded-xl border border-slate-700 bg-slate-800/50 overflow-hidden"
      style={{ animation: "fadeInUp 0.4s ease-out" }}
    >
      {/* Header */}
      <div className="border-b border-slate-700 px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-500/15 border border-cyan-500/30">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-cyan-400">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" />
                <line x1="22" y1="11" x2="16" y2="11" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">가입 속도 데모</h3>
              <p className="text-[11px] text-slate-500">
                Google OAuth 원클릭 가입
              </p>
            </div>
          </div>
          {step !== "idle" && (
            <div className="text-right">
              <div className="font-mono text-lg font-bold tabular-nums">
                <span className={step === "done" ? "text-emerald-400" : "text-cyan-400"}>
                  {elapsedStr}s
                </span>
              </div>
              <p className="text-[10px] text-slate-500">소요 시간</p>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="px-5 py-5">
        {/* ── Idle ── */}
        {step === "idle" && (
          <div className="text-center space-y-4">
            <div className="space-y-2">
              <p className="text-sm text-slate-300">
                Haggle 가입이 얼마나 빠른지 직접 확인하세요.
              </p>
              <p className="text-xs text-slate-500">
                Google 계정 하나로 즉시 시작 &mdash; 별도 양식 없음, 이메일 인증 없음.
              </p>
            </div>
            <button
              onClick={startDemo}
              className="rounded-lg bg-cyan-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-cyan-600 transition-colors cursor-pointer"
            >
              데모 시작
            </button>
          </div>
        )}

        {/* ── Simulated Sign-Up Form ── */}
        {step !== "idle" && (
          <div className="space-y-5">
            {/* Mock sign-up form */}
            <div className="rounded-xl border border-slate-600 bg-slate-900/70 p-5 max-w-sm mx-auto">
              <div className="text-center mb-4">
                <h4 className="text-base font-bold text-white">Haggle</h4>
                <p className="text-xs text-slate-500 mt-0.5">Create your account</p>
              </div>

              {/* Google button - this is what gets "clicked" */}
              <button
                className={`flex w-full items-center justify-center gap-2.5 rounded-lg border px-4 py-2.5 text-sm font-medium transition-all ${
                  step === "google_click" || step === "google_popup"
                    ? "border-cyan-500 bg-cyan-500/10 text-white scale-[0.98]"
                    : "border-slate-600 bg-slate-800 text-slate-300"
                }`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                Continue with Google
                {(step === "google_click" || step === "google_popup") && (
                  <span className="ml-1 text-cyan-400 text-xs">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="inline animate-pulse">
                      <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                )}
              </button>

              {/* Divider */}
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-700" />
                </div>
                <div className="relative flex justify-center text-[10px]">
                  <span className="bg-slate-900/70 px-2 text-slate-600">or</span>
                </div>
              </div>

              {/* Email field (typing animation) */}
              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Email</label>
                  <div className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-mono">
                    <span className="text-slate-300">{typedEmail}</span>
                    {step === "typing_email" && (
                      <span className="animate-pulse text-cyan-400">|</span>
                    )}
                    {!typedEmail && <span className="text-slate-600">you@example.com</span>}
                  </div>
                </div>
                <div className="text-[10px] text-slate-600 text-center">
                  하지만 대부분의 사용자는 Google로 바로 가입합니다 ^
                </div>
              </div>
            </div>

            {/* Google popup simulation */}
            {step === "google_popup" && (
              <div
                className="rounded-lg border border-slate-600 bg-slate-900/80 p-4 max-w-xs mx-auto"
                style={{ animation: "fadeInUp 0.2s ease-out" }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <svg width="14" height="14" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                  </svg>
                  <span className="text-xs font-medium text-slate-300">Google 계정 선택</span>
                </div>
                <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-2.5 flex items-center gap-2.5 cursor-pointer">
                  <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold">B</div>
                  <div>
                    <div className="text-xs font-medium text-white">buyer@example.com</div>
                    <div className="text-[10px] text-slate-500">Buyer Demo</div>
                  </div>
                  <div className="ml-auto">
                    <div className="w-3 h-3 border-2 border-slate-600 border-t-cyan-400 rounded-full animate-spin" />
                  </div>
                </div>
              </div>
            )}

            {/* Done */}
            {step === "done" && (
              <div
                className="text-center space-y-3"
                style={{ animation: "fadeInUp 0.3s ease-out" }}
              >
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 border border-emerald-500/30">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-bold text-emerald-400">
                    가입 완료!
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Google 버튼 한 번으로 <span className="text-white font-medium">{elapsedStr}초</span> 만에 완료.
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    이메일 인증 없음 &middot; 비밀번호 설정 없음 &middot; 추가 양식 없음
                  </p>
                </div>

                {/* Comparison */}
                <div className="rounded-lg bg-slate-900/60 border border-slate-700 p-3 max-w-xs mx-auto">
                  <div className="text-[10px] text-slate-500 mb-2">가입 과정 비교</div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">eBay</span>
                      <div className="flex items-center gap-1.5">
                        <div className="h-1.5 rounded-full bg-red-500/60" style={{ width: "100px" }} />
                        <span className="text-slate-500 text-[10px]">~3분</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Mercari</span>
                      <div className="flex items-center gap-1.5">
                        <div className="h-1.5 rounded-full bg-amber-500/60" style={{ width: "70px" }} />
                        <span className="text-slate-500 text-[10px]">~2분</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-emerald-400 font-medium">Haggle</span>
                      <div className="flex items-center gap-1.5">
                        <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: "15px" }} />
                        <span className="text-emerald-400 text-[10px] font-medium">~3초</span>
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  onClick={resetDemo}
                  className="text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                >
                  다시 보기
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

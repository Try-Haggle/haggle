"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import * as amplitude from "@amplitude/analytics-browser";
import { Identify } from "@amplitude/analytics-browser";
import { createClient } from "@/lib/supabase/client";

const AmplitudeContext = createContext<{
  track: typeof amplitude.track;
  identify: typeof amplitude.identify;
  setUserId: typeof amplitude.setUserId;
  reset: typeof amplitude.reset;
} | null>(null);

export function AmplitudeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const initialized = useRef(false);
  const lastTrackedPath = useRef<string | null>(null);
  const authListenerSet = useRef(false);

  // SDK 초기화 (1회)
  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY;
    if (!apiKey || initialized.current) return;

    amplitude.init(apiKey, {
      defaultTracking: {
        sessions: true,
        pageViews: false, // Next.js SPA 라우팅이므로 수동 제어
        formInteractions: false,
        fileDownloads: false,
      },
      logLevel: amplitude.Types.LogLevel.Warn,
    });
    initialized.current = true;
  }, []);

  // Supabase Auth 연동 — userId 설정 + User Properties
  useEffect(() => {
    if (!initialized.current || authListenerSet.current) return;
    authListenerSet.current = true;

    const supabase = createClient();

    // 초기 로드 시 기존 세션 확인
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        amplitude.setUserId(session.user.id);
        const identify = new Identify();
        identify.setOnce("signup_method", session.user.app_metadata?.provider || "email");
        identify.setOnce("signup_date", session.user.created_at?.split("T")[0] ?? "");
        amplitude.identify(identify);
      }
    });

    // Auth state 변경 감지
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "SIGNED_IN" && session?.user) {
          amplitude.setUserId(session.user.id);
          const identify = new Identify();
          identify.setOnce("signup_method", session.user.app_metadata?.provider || "email");
          identify.setOnce("signup_date", session.user.created_at?.split("T")[0] ?? "");
          amplitude.identify(identify);

          // 신규 가입 감지: localStorage flag + created_at 10분 이내
          const raw = localStorage.getItem("haggle_auth_intent");
          const created = new Date(session.user.created_at).getTime();
          const isNewUser = Date.now() - created < 600_000; // 10분 이내 생성된 계정

          if (raw && isNewUser) {
            const intent = JSON.parse(raw) as { entry_point: string; timestamp: number };
            const alreadyTracked = localStorage.getItem("haggle_account_created") === session.user.id;
            // flag가 1시간 이내에 설정된 것만 유효 + 이미 발화한 유저가 아닌 경우
            if (Date.now() - intent.timestamp < 3_600_000 && !alreadyTracked) {
              amplitude.track("Account Created", {
                method: session.user.app_metadata?.provider === "google" ? "google" : "email",
                entry_point: intent.entry_point,
              });
              localStorage.setItem("haggle_account_created", session.user.id);
            }
            localStorage.removeItem("haggle_auth_intent");
          } else if (raw) {
            // 기존 유저 재로그인 — flag만 정리
            localStorage.removeItem("haggle_auth_intent");
          }
        }

        if (event === "SIGNED_OUT") {
          amplitude.reset();
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // 라우트 전환 시 Page Viewed 이벤트
  useEffect(() => {
    if (!initialized.current) return;
    if (lastTrackedPath.current === pathname) return;
    lastTrackedPath.current = pathname;
    amplitude.track("Page Viewed", {
      page_path: pathname,
      page_title: typeof document !== "undefined" ? document.title : "",
    });
  }, [pathname]);

  return (
    <AmplitudeContext.Provider
      value={{
        track: amplitude.track.bind(amplitude),
        identify: amplitude.identify.bind(amplitude),
        setUserId: amplitude.setUserId.bind(amplitude),
        reset: amplitude.reset.bind(amplitude),
      }}
    >
      {children}
    </AmplitudeContext.Provider>
  );
}

export function useAmplitude() {
  const ctx = useContext(AmplitudeContext);
  if (!ctx) {
    // Provider 밖에서 호출 시 no-op 반환 (SSR 안전)
    return {
      track: (() => ({ promise: Promise.resolve() })) as unknown as typeof amplitude.track,
      identify: (() => ({ promise: Promise.resolve() })) as unknown as typeof amplitude.identify,
      setUserId: (() => {}) as unknown as typeof amplitude.setUserId,
      reset: (() => ({ promise: Promise.resolve() })) as unknown as typeof amplitude.reset,
    };
  }
  return ctx;
}

"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

type Mode = "selling" | "buying";

interface NavProps {
  userEmail: string;
  userName?: string | null;
  userAvatarUrl?: string | null;
}

export function Nav({ userEmail, userName, userAvatarUrl }: NavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("selling");
  const [menuOpen, setMenuOpen] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Reset error state when avatar URL changes
  useEffect(() => {
    setAvatarError(false);
  }, [userAvatarUrl]);

  // Persist mode in localStorage
  useEffect(() => {
    const saved = localStorage.getItem("haggle_mode") as Mode | null;
    if (saved === "selling" || saved === "buying") setMode(saved);
  }, []);

  const handleModeSwitch = (next: Mode) => {
    setMode(next);
    localStorage.setItem("haggle_mode", next);
    if (next === "selling") {
      router.push("/dashboard");
    }
    // buying mode dashboard → future slice
  };

  // Close menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/claim");
  };

  return (
    <nav className="fixed top-0 inset-x-0 z-50 h-14 border-b border-slate-800 bg-bg-primary/80 backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-4 sm:px-6">
        {/* Left: Logo */}
        <Link
          href="/dashboard"
          className="text-lg font-bold text-white hover:text-cyan-400 transition-colors"
        >
          Haggle
        </Link>

        {/* Right: User menu */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 text-sm text-slate-300 hover:text-white transition-colors cursor-pointer"
          >
            {userAvatarUrl && !avatarError ? (
              <img
                src={userAvatarUrl}
                alt=""
                className="h-6 w-6 rounded-full object-cover"
                referrerPolicy="no-referrer"
                onError={() => setAvatarError(true)}
              />
            ) : (
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-medium text-emerald-400">
                {(userName || userEmail).charAt(0).toUpperCase()}
              </div>
            )}
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {menuOpen && (
            <div className="absolute right-0 mt-2 w-56 rounded-xl border border-slate-800 bg-bg-card py-1 shadow-xl">
              <div className="px-4 py-2.5 border-b border-slate-800">
                <p className="text-xs text-slate-500">Signed in as</p>
                <p className="text-sm text-slate-300 truncate">{userEmail}</p>
              </div>
              {/* Mode toggle */}
              <div className="px-3 py-2.5 border-b border-slate-800">
                <p className="text-xs text-slate-500 mb-2">Mode</p>
                <div className="flex rounded-full bg-slate-800 p-0.5">
                  <button
                    onClick={() => handleModeSwitch("selling")}
                    className={`flex-1 rounded-full py-1 text-xs font-medium transition-all cursor-pointer ${
                      mode === "selling"
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Selling
                  </button>
                  <button
                    onClick={() => handleModeSwitch("buying")}
                    className={`flex-1 rounded-full py-1 text-xs font-medium transition-all cursor-pointer ${
                      mode === "buying"
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Buying
                  </button>
                </div>
              </div>
              <Link
                href="/settings"
                onClick={() => setMenuOpen(false)}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                Settings
              </Link>
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}

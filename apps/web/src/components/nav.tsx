"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

type Mode = "selling" | "buying";

export function Nav({ userEmail }: { userEmail: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("selling");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
    <nav className="fixed top-0 inset-x-0 z-50 h-14 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md">
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
            className="flex items-center gap-2 text-sm text-zinc-300 hover:text-white transition-colors cursor-pointer"
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/20 text-xs font-medium text-cyan-400">
              {userEmail.charAt(0).toUpperCase()}
            </div>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {menuOpen && (
            <div className="absolute right-0 mt-2 w-56 rounded-xl border border-zinc-800 bg-zinc-900 py-1 shadow-xl">
              <div className="px-4 py-2.5 border-b border-zinc-800">
                <p className="text-xs text-zinc-500">Signed in as</p>
                <p className="text-sm text-zinc-300 truncate">{userEmail}</p>
              </div>
              {/* Mode toggle */}
              <div className="px-3 py-2.5 border-b border-zinc-800">
                <p className="text-xs text-zinc-500 mb-2">Mode</p>
                <div className="flex rounded-full bg-zinc-800 p-0.5">
                  <button
                    onClick={() => handleModeSwitch("selling")}
                    className={`flex-1 rounded-full py-1 text-xs font-medium transition-all cursor-pointer ${
                      mode === "selling"
                        ? "bg-white text-zinc-900 shadow-sm"
                        : "text-zinc-400 hover:text-white"
                    }`}
                  >
                    Selling
                  </button>
                  <button
                    onClick={() => handleModeSwitch("buying")}
                    className={`flex-1 rounded-full py-1 text-xs font-medium transition-all cursor-pointer ${
                      mode === "buying"
                        ? "bg-white text-zinc-900 shadow-sm"
                        : "text-zinc-400 hover:text-white"
                    }`}
                  >
                    Buying
                  </button>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
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

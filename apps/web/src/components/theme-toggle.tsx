"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/use-theme";

/**
 * Light/Dark pill toggle. Mirrors the design-system `.theme-toggle`.
 * Mount it in nav bars during Phase 2 migration.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${isDark ? "light" : "dark"} theme`}
      className={`inline-flex items-center gap-2 rounded-full border border-line px-3.5 py-2 text-xs text-ink transition-colors hover:border-line-strong ${className}`}
    >
      {isDark ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
      <span>{isDark ? "Dark" : "Light"}</span>
    </button>
  );
}

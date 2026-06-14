"use client";

import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "haggle-theme";

function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/**
 * Reads/writes the active theme on <html data-theme> and persists it.
 * The pre-paint bootstrap in layout.tsx restores the saved value, so this
 * hook just keeps React state in sync and exposes setters.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("light");

  // Sync with whatever the bootstrap script applied (avoids hydration drift).
  useEffect(() => {
    setThemeState(currentTheme());
  }, []);

  const setTheme = useCallback((next: Theme) => {
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore storage failures (private mode, etc.)
    }
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(currentTheme() === "dark" ? "light" : "dark");
  }, [setTheme]);

  return { theme, setTheme, toggleTheme };
}

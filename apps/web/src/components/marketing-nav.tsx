"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const NAV_LINKS = [
  { label: "Calculator", href: "/calculator" },
  { label: "Demo", href: "/demo" },
  { label: "Playground", href: "/playground" },
];

export function MarketingNav() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="fixed top-0 inset-x-0 z-50 h-16 border-b border-slate-800 bg-bg-primary/80 backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-4 sm:px-6">
        {/* Logo */}
        <Link href="/" className="text-lg font-bold text-white hover:text-cyan-400 transition-colors">
          Haggle
        </Link>

        {/* Desktop links */}
        <div className="hidden sm:flex items-center gap-1">
          {NAV_LINKS.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className="px-3 py-1 text-sm font-medium text-slate-300 hover:text-white transition-colors"
              >
                <span className={`inline-block pb-1 border-b-2 ${isActive ? "border-cyan-400 text-white" : "border-transparent"}`}>
                  {link.label}
                </span>
              </Link>
            );
          })}
          <Link
            href="/claim"
            className="ml-4 rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-cyan-500 transition-colors"
          >
            Sign In
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="sm:hidden text-slate-300 hover:text-white"
        >
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
            {mobileOpen ? (
              <path d="M18 6L6 18M6 6l12 12" />
            ) : (
              <path d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="sm:hidden border-t border-slate-800 bg-bg-primary/95 backdrop-blur-md px-4 py-3">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className="block py-2.5 text-sm text-slate-300 hover:text-white"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/claim"
            onClick={() => setMobileOpen(false)}
            className="mt-2 block rounded-lg bg-cyan-600 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-cyan-500"
          >
            Sign In
          </Link>
        </div>
      )}
    </nav>
  );
}

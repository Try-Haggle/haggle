"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";

const NAV_LINKS = [
  { label: "Calculator", href: "/calculator" },
  { label: "Demo", href: "/demo" },
  { label: "Developer", href: "/demo/developer" },
];

export function MarketingNav() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="fixed inset-x-0 top-0 z-50 h-16 border-line border-b bg-surface/80 backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-4 sm:px-6">
        {/* Left: Logo + neutral Browse link */}
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="font-bold text-ink text-lg transition-colors hover:text-action-primary"
          >
            Haggle
          </Link>
          <Link
            href="/browse"
            className={`hidden font-medium text-sm transition-colors sm:inline ${
              pathname.startsWith("/browse")
                ? "text-action-primary"
                : "text-ink-secondary hover:text-ink"
            }`}
          >
            Browse
          </Link>
        </div>

        {/* Desktop links — marketing pages */}
        <div className="hidden items-center gap-1 sm:flex">
          {NAV_LINKS.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className="px-3 py-1 font-medium text-ink-secondary text-sm transition-colors hover:text-ink"
              >
                <span
                  className={`inline-block border-b-2 pb-1 ${isActive ? "border-action-primary text-ink" : "border-transparent"}`}
                >
                  {link.label}
                </span>
              </Link>
            );
          })}
          <Link href="/claim" className={buttonVariants({ size: "sm", className: "ml-4" })}>
            Sign In
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button
          type="button"
          onClick={() => setMobileOpen(!mobileOpen)}
          className="text-ink-secondary hover:text-ink sm:hidden"
        >
          <svg
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            {mobileOpen ? <path d="M18 6L6 18M6 6l12 12" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="border-line border-t bg-surface/95 px-4 py-3 backdrop-blur-md sm:hidden">
          <Link
            href="/browse"
            onClick={() => setMobileOpen(false)}
            className="block py-2.5 text-ink-secondary text-sm hover:text-ink"
          >
            Browse
          </Link>
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className="block py-2.5 text-ink-secondary text-sm hover:text-ink"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/claim"
            onClick={() => setMobileOpen(false)}
            className={buttonVariants({ className: "mt-2 w-full" })}
          >
            Sign In
          </Link>
        </div>
      )}
    </nav>
  );
}

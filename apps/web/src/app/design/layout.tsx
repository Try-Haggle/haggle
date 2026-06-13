import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { DesignSidebarNav } from "./design-sidebar-nav";
import { stories } from "./stories/registry";

export const metadata: Metadata = {
  title: "Design System",
  robots: { index: false, follow: false },
};

export default function DesignLayout({ children }: { children: ReactNode }) {
  // Visible on local (VERCEL_ENV undefined) + staging (preview); hidden in production.
  if (process.env.VERCEL_ENV === "production") {
    notFound();
  }

  const items = [
    { href: "/design", label: "Overview" },
    ...stories.map((s) => ({ href: `/design/${s.slug}`, label: s.name })),
  ];

  return (
    <div className="min-h-screen bg-surface text-ink">
      <div className="mx-auto flex max-w-6xl gap-8 px-6">
        <aside className="sticky top-0 hidden h-screen w-52 shrink-0 flex-col gap-6 border-line-subtle border-r py-8 pr-4 md:flex">
          <span className="px-3 font-display text-xl text-ink">Haggle UI</span>
          <DesignSidebarNav items={items} />
          <div className="mt-auto px-3">
            <ThemeToggle />
          </div>
        </aside>
        <main className="min-w-0 flex-1 py-8">{children}</main>
      </div>
    </div>
  );
}

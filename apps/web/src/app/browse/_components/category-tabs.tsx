"use client";

import Link from "next/link";
import { LISTING_CATEGORIES, LISTING_CATEGORY_LABELS } from "@haggle/shared";

type Category = (typeof LISTING_CATEGORIES)[number];

export function CategoryTabs({
  activeCategory,
}: {
  activeCategory: Category | null;
}) {
  const tabs: { value: Category | null; label: string }[] = [
    { value: null, label: "All" },
    ...LISTING_CATEGORIES.map((value) => ({
      value,
      label: LISTING_CATEGORY_LABELS[value],
    })),
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map((tab) => {
        const isActive = tab.value === activeCategory;
        const href = tab.value ? `/browse?category=${tab.value}` : "/browse";
        return (
          <Link
            key={tab.value ?? "all"}
            href={href}
            scroll={false}
            className="rounded-full border px-4 py-2 text-sm font-medium transition-colors"
            style={{
              background: isActive ? "rgba(6,182,212,0.08)" : "transparent",
              borderColor: isActive ? "#06b6d4" : "#1e293b",
              color: isActive ? "#06b6d4" : "#94a3b8",
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}

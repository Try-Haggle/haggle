"use client";

import { useState } from "react";
import { FAQ_ITEMS } from "@/lib/data/faq";

export function Faq() {
  // Open first item by default (matches original HTML)
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  const toggle = (i: number) => setOpenIdx((curr) => (curr === i ? null : i));

  return (
    <section id="faq" className="relative scroll-mt-20">
      {/* Header */}
      <div className="bg-transparent py-12 pb-6 max-lg:py-10 max-lg:pb-4">
        <div className="mx-auto max-w-7xl px-10 max-md:px-6">
          <div className="mx-auto max-w-275 text-center">
            <span className="mb-4 inline-block font-mono text-[11px] font-medium tracking-[0.14em] text-gold-500 uppercase">
              FAQ
            </span>
            <h2 className="m-0 font-serif text-[clamp(32px,3.6vw,46px)] leading-[1.1] font-medium tracking-[-0.022em] text-navy-500">
              Got{" "}
              <em
                className="bg-clip-text pr-[0.04em] font-serif font-medium tracking-[-0.015em] text-transparent italic"
                style={{ backgroundImage: "var(--gradient-text-gold)" }}
              >
                questions?
              </em>{" "}
              We&apos;ve got you.
            </h2>
          </div>
        </div>
      </div>

      {/* Accordion (gold-tinted) */}
      <div className="bg-[color-mix(in_oklab,var(--color-gold-50)_20%,var(--color-surface-base))] py-8 pt-8 pb-12 max-lg:py-6 max-lg:pb-10">
        <div className="mx-auto max-w-7xl px-10 max-md:px-6">
          <div className="mx-auto max-w-275">
            {FAQ_ITEMS.map((item, i) => {
              const isOpen = openIdx === i;
              return (
                <div
                  key={i}
                  className={`border-t border-neutral-100 ${i === FAQ_ITEMS.length - 1 ? "border-b" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => toggle(i)}
                    aria-expanded={isOpen}
                    className={`group flex w-full cursor-pointer items-center justify-between gap-6 border-0 bg-transparent py-5 pr-2 pl-0 text-left font-sans text-[18px] font-semibold tracking-[-0.01em] transition-colors max-md:gap-4 max-md:py-4 max-md:text-[15px] ${
                      isOpen
                        ? "text-navy-500"
                        : "text-navy-500 hover:text-gold-500"
                    }`}
                  >
                    <span>{item.question}</span>
                    <span
                      aria-hidden="true"
                      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors ${
                        isOpen
                          ? "border-navy-500 bg-navy-500"
                          : "border-neutral-200 bg-surface-raised group-hover:border-navy-500"
                      }`}
                    >
                      <svg
                        viewBox="0 0 16 16"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        className={`h-3.5 w-3.5 transition-transform duration-300 ${
                          isOpen
                            ? "rotate-180 text-surface-raised"
                            : "text-navy-500"
                        }`}
                      >
                        <path
                          d="M4 6l4 4 4-4"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  </button>
                  <div
                    className="grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                    style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
                  >
                    <div className="overflow-hidden">
                      <div className="ml-0 max-w-200 border-l-2 border-gold-300 px-4 pt-1 pr-2 pb-6 text-[15.5px] leading-[1.6] tracking-[-0.003em] text-neutral-700 max-md:px-3 max-md:pb-5 max-md:text-[14px] max-md:leading-[1.55] [&>p+p]:mt-3.5 [&>p]:m-0">
                        {item.answer}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

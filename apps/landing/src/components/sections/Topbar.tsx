import { APP_URL } from "@/lib/env";

const NAV_LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#why-haggle", label: "Why Haggle" },
  { href: "#faq", label: "FAQ" },
];

export function Topbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-neutral-100 bg-[color-mix(in_oklab,var(--color-surface-base)_80%,transparent)] backdrop-blur-md backdrop-saturate-140">
      <div className="mx-auto flex h-17 max-w-7xl items-center justify-between px-10 max-md:px-5">
        <div className="flex items-center gap-9 max-md:gap-0">
          <a
            href="#"
            className="-ml-0.5 inline-flex items-center font-serif text-[28px] leading-none font-medium tracking-[-0.01em] text-navy-500"
          >
            Haggle
          </a>
          <nav className="flex items-center gap-7 max-md:hidden">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="relative py-1.5 text-[13px] tracking-[0.01em] text-neutral-600 transition-colors hover:text-navy-500"
              >
                {link.label}
              </a>
            ))}
          </nav>
        </div>
        <div className="flex items-center">
          <a
            href={`${APP_URL}/login`}
            className="group inline-flex h-9 items-center gap-1.5 rounded-full bg-navy-500 px-4 text-[13px] leading-none font-semibold text-white transition-colors hover:bg-navy-600"
          >
            <span className="leading-none">Sign in</span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="block shrink-0 transition-transform duration-200 group-hover:translate-x-0.5"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </a>
        </div>
      </div>
    </header>
  );
}

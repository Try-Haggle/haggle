import Link from "next/link";
import { MarketingNav } from "@/components/marketing-nav";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MarketingNav />
      <div className="pt-16">{children}</div>
      <footer className="border-t border-line py-8 mt-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-ink-muted">
            &copy; {new Date().getFullYear()} Haggle. Delaware LLC.
          </p>
          <div className="flex items-center gap-6 text-sm text-ink-muted">
            <a href="https://tryhaggle.ai" className="hover:text-ink-secondary transition-colors">
              tryhaggle.ai
            </a>
            <Link href="/terms" className="hover:text-ink-secondary transition-colors">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-ink-secondary transition-colors">
              Privacy
            </Link>
          </div>
        </div>
      </footer>
    </>
  );
}

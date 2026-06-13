import type { ReactNode } from "react";

function Section({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
}) {
  return (
    <section className="border-line-subtle border-t py-10 first:border-t-0 first:pt-0">
      <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-action-primary">
        {eyebrow}
      </p>
      <h2 className="mb-6 font-display text-3xl text-ink">{title}</h2>
      {children}
    </section>
  );
}

function Swatch({ label, swatchClass }: { label: string; swatchClass: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line-subtle">
      <div className={`h-16 ${swatchClass}`} />
      <div className="bg-surface-raised px-2 py-1.5 font-mono text-[10px] text-ink-muted">
        {label}
      </div>
    </div>
  );
}

export default function DesignOverviewPage() {
  return (
    <div>
      <header className="mb-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-action-primary">
          Design System · Living
        </p>
        <h1 className="font-display text-4xl text-ink">Overview</h1>
        <p className="mt-2 max-w-prose text-sm text-ink-secondary">
          색·그라디언트·타이포 기준입니다. 왼쪽에서 컴포넌트를 선택하면 인터랙티브 플레이그라운드로
          이동해 variant를 직접 조작할 수 있어요.
        </p>
      </header>

      <Section eyebrow="§ Tokens" title="Semantic colors">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Swatch label="surface" swatchClass="bg-surface" />
          <Swatch label="surface-raised" swatchClass="bg-surface-raised" />
          <Swatch label="surface-sunken" swatchClass="bg-surface-sunken" />
          <Swatch label="ink" swatchClass="bg-ink" />
          <Swatch label="action-primary" swatchClass="bg-action-primary" />
          <Swatch label="action-secondary" swatchClass="bg-action-secondary" />
          <Swatch label="success" swatchClass="bg-success" />
          <Swatch label="error" swatchClass="bg-error" />
        </div>
      </Section>

      <Section eyebrow="§ Gradients" title="Gradients">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="bg-hero flex h-24 items-end rounded-xl border border-line-subtle p-3 font-mono text-[10px] text-ink-muted">
            bg-hero
          </div>
          <div className="bg-section flex h-24 items-end rounded-xl border border-line-subtle p-3 font-mono text-[10px] text-ink-muted">
            bg-section
          </div>
          <div className="bg-premium flex h-24 items-end rounded-xl p-3 font-mono text-[10px] text-on-accent/80">
            bg-premium
          </div>
          <div className="bg-cta-primary flex h-24 items-end rounded-xl p-3 font-mono text-[10px] text-on-accent/90">
            bg-cta-primary
          </div>
        </div>
        <p className="mt-5 font-display text-3xl text-ink italic">
          <span className="text-gradient">좋은 협상</span>은 준비에서 시작됩니다.
        </p>
      </Section>

      <Section eyebrow="§ Type" title="Typography">
        <div className="space-y-4 text-ink">
          <p className="text-display">Display</p>
          <p className="text-h1">H1 · Your best offer starts here</p>
          <p className="text-h2">H2 · How Haggle works</p>
          <p className="text-h3">H3 · Salary negotiation</p>
          <p className="text-body text-ink-secondary">
            Body · Walk in prepared. Haggle analyzes your offer and builds a case that works.
          </p>
          <p className="text-body-sm text-ink-secondary">
            Body Small · We use your past offers and similar cases to build a strategy.
          </p>
          <p className="text-label text-ink-muted">Label · Current offer · Win rate</p>
          <p className="text-data">Data · $88,000 · +22.2% · 72% win rate</p>
        </div>
      </Section>
    </div>
  );
}

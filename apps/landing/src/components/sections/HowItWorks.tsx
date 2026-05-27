import { RadarPanel } from "@/components/viz/RadarPanel";
import { ChatPanel } from "@/components/viz/ChatPanel";
import { Timeline } from "@/components/viz/Timeline";

interface Step {
  eyebrow: string;
  titlePre: string;
  titleEm: string;
  titlePost?: string;
  desc: string;
  viz: React.ReactNode;
  reverse?: boolean;
  tinted?: boolean;
}

const STEPS: Step[] = [
  {
    eyebrow: "Step 01",
    titlePre: "",
    titleEm: "Build",
    titlePost: " your agent",
    desc: "Whether you're buying or selling, you start by picking a negotiation style. Set your limits. Save it, and your agent represents you around the clock. Trust the defaults, or fine-tune the advanced controls.",
    viz: <RadarPanel />,
    tinted: true,
  },
  {
    eyebrow: "Step 02",
    titlePre: "Let them ",
    titleEm: "negotiate",
    desc: "Your agent meets theirs. They go back and forth on price, offer after counter-offer, until they land on a number both sides can live with. Both agents play fair, so neither side walks away cheated.",
    viz: <ChatPanel />,
    reverse: true,
  },
  {
    eyebrow: "Step 03",
    titlePre: "Deal ",
    titleEm: "settles",
    titlePost: " instantly",
    desc: "Once both agents agree, both sides tap to confirm. USDC moves into a smart contract, held in escrow until delivery is confirmed. We never touch your money at any point.",
    viz: <Timeline />,
    tinted: true,
  },
];

function StepRow({ step }: { step: Step }) {
  const textBlock = (
    <div className="flex max-w-130 flex-col gap-4">
      <p className="m-0 mb-3.5 inline-flex self-start rounded-full border border-[color-mix(in_oklab,var(--color-navy-100)_70%,transparent)] bg-navy-50 px-[11px] py-1 font-mono text-[11.5px] font-medium tracking-[0.18em] text-navy-500 uppercase">
        {step.eyebrow}
      </p>
      <h3 className="m-0 font-serif text-[clamp(28px,3vw,40px)] leading-[1.1] font-medium tracking-[-0.022em] text-navy-500">
        {step.titlePre}
        <em
          className="bg-clip-text pr-[0.04em] font-serif font-medium tracking-[-0.015em] text-transparent italic"
          style={{ backgroundImage: "var(--gradient-text-gold)" }}
        >
          {step.titleEm}
        </em>
        {step.titlePost}
      </h3>
      <p className="m-0 mt-4 max-w-[48ch] text-[17px] leading-[1.6] tracking-[-0.005em] text-neutral-600">
        {step.desc}
      </p>
    </div>
  );

  const vizBlock = (
    <div
      className="relative flex items-center justify-center bg-transparent"
      aria-hidden="true"
    >
      {step.viz}
    </div>
  );

  // Step 02 (reverse) uses 5:5 ratio; others 4:6.
  // JSX order = visual order on desktop (left→right).
  // On mobile we collapse to 1 column and force text to come first.
  const gridCols = step.reverse
    ? "grid-cols-[minmax(0,5fr)_minmax(0,5fr)]"
    : "grid-cols-[minmax(0,4fr)_minmax(0,6fr)]";

  return (
    <div
      className={
        step.tinted
          ? "bg-[color-mix(in_oklab,var(--color-gold-50)_20%,var(--color-surface-base))] py-14 max-lg:py-10"
          : "bg-transparent py-14 max-lg:py-10"
      }
    >
      <div className="mx-auto max-w-7xl px-10 max-md:px-6">
        <div
          className={`grid items-center gap-20 max-lg:grid-cols-1 max-lg:gap-8 ${gridCols}`}
        >
          {step.reverse ? (
            <>
              {/* viz left on desktop, second on mobile */}
              <div className="max-lg:order-2">{vizBlock}</div>
              {/* text right on desktop, first on mobile */}
              <div className="max-lg:order-1">{textBlock}</div>
            </>
          ) : (
            <>
              {textBlock}
              {vizBlock}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function HowItWorks() {
  return (
    <section id="how-it-works" className="relative scroll-mt-20">
      {/* Section header */}
      <div className="bg-transparent py-12 pb-6 max-lg:py-10 max-lg:pb-4">
        <div className="mx-auto max-w-7xl px-10 max-md:px-6">
          <div className="mx-auto mb-18 max-w-180 text-center max-lg:mb-12">
            <span className="mb-4 inline-block font-mono text-[11px] font-medium tracking-[0.14em] text-gold-500 uppercase">
              How it works
            </span>
            <h2 className="m-0 font-serif text-[clamp(32px,3.6vw,46px)] leading-[1.1] font-medium tracking-[-0.022em] text-navy-500">
              Three steps to your first{" "}
              <em
                className="bg-clip-text pr-[0.04em] font-serif font-medium tracking-[-0.015em] text-transparent italic"
                style={{ backgroundImage: "var(--gradient-text-gold)" }}
              >
                deal.
              </em>
            </h2>
          </div>
        </div>
      </div>

      {STEPS.map((step) => (
        <StepRow key={step.eyebrow} step={step} />
      ))}
    </section>
  );
}

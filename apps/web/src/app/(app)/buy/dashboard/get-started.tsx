"use client";

import { Check, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { AgentIcon, BrowseIcon, DeliveryIcon } from "@/components/icons/brand";
import { AddressDialog } from "@/components/shipping/address-dialog";
import { buttonVariants } from "@/components/ui/button";
import { Card, cardLinkClass } from "@/components/ui/card";
import { ProgressRing } from "@/components/ui/progress-ring";
import { textLinkVariants } from "@/components/ui/text-link";
import { BUYER_GET_STARTED_DISMISSED_KEY } from "@/lib/buyer-onboarding";
import { cn } from "@/lib/cn";
import { createClient } from "@/lib/supabase/client";

export interface GetStartedProgress {
  browsed: boolean;
  hasAgent: boolean;
  hasAddress: boolean;
}

interface Step {
  key: keyof GetStartedProgress;
  title: string;
  description: string;
  cta: string;
  href: string;
  /** Opens the address dialog instead of navigating. */
  dialog?: boolean;
  /** Once done: a quieter way back, not a second "do this" button. */
  doneCta: string;
  doneHref: string;
  // Brand icon (components/icons/brand).
  icon: ReactNode;
}

const STALE_AFTER_MS = 3000;
const UNKNOWN_RETRY_MS = 5000;

const STEPS: Step[] = [
  {
    key: "browsed",
    title: "Find something you want",
    description: "Browse what people are selling. Open any listing to start a deal.",
    cta: "Browse marketplace",
    href: "/browse",
    doneCta: "Browse again",
    doneHref: "/browse",
    // The mark carries a grid behind the lens, so it needs a larger box to
    // read at the same weight as a 48px line icon.
    icon: <BrowseIcon className="-ml-1.5 size-16" />,
  },
  {
    key: "hasAgent",
    title: "Set up your agent",
    description: "Pick how it negotiates, and it haggles the price for you.",
    cta: "Create agent",
    href: "/buy/agents/new",
    doneCta: "View agents",
    doneHref: "/buy/agents",
    icon: <AgentIcon className="size-16" />,
  },
  {
    key: "hasAddress",
    title: "Add a delivery address",
    description: "Saved once, so a deal can ship as soon as it closes.",
    cta: "Add address",
    href: "/settings#delivery-address",
    dialog: true,
    doneCta: "Manage address",
    doneHref: "/settings#delivery-address",
    icon: <DeliveryIcon className="size-16" />,
  },
];

/**
 * The three things a new buyer can do, as equal cards — no step numbers and
 * no "next" highlight, because they can be done in any order.
 *
 * Completion is read from real data (the buyer's own agents, saved
 * addresses, viewed listings and negotiations), so it cannot drift from what
 * the person has done. The two flags that have no other source live in
 * user_metadata: the first marketplace visit and "Dismiss"
 * (lib/buyer-onboarding.ts).
 * It stays when all three are done (the cards become quick links) and only
 * goes away when dismissed.
 */
export function GetStarted({
  progress,
  initiallyDismissed,
  progressKnown,
  renderedAt,
  defaultRecipientName,
}: {
  /** Prefills the address dialog's recipient name. */
  defaultRecipientName: string | null;
  progress: GetStartedProgress;
  initiallyDismissed: boolean;
  /** False when the server could not read progress (API down / rate limited). */
  progressKnown: boolean;
  /** Server render time (ms). */
  renderedAt: number;
}) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(initiallyDismissed);
  const [addressOpen, setAddressOpen] = useState(false);
  // Steps finished on this page (the address dialog). Shown as done right
  // away instead of waiting for the server refresh to come back.
  const [doneHere, setDoneHere] = useState<Partial<GetStartedProgress>>({});
  const isDone = (key: keyof GetStartedProgress) => progress[key] || Boolean(doneHere[key]);

  // Back/forward restores this page from the router cache, so after visiting
  // the marketplace or creating an agent and pressing Back, the card would
  // still show the old progress. If what we are showing was rendered more
  // than a moment ago, ask the server again. A fresh load is newer than that,
  // so it does not refetch.
  useEffect(() => {
    if (Date.now() - renderedAt > STALE_AFTER_MS) router.refresh();
  }, [renderedAt, router]);

  // Progress could not be read: try once more shortly instead of guessing.
  useEffect(() => {
    if (progressKnown) return;
    const id = window.setTimeout(() => router.refresh(), UNKNOWN_RETRY_MS);
    return () => window.clearTimeout(id);
  }, [progressKnown, router]);
  const doneCount = STEPS.filter((step) => isDone(step.key)).length;

  // Stays after 3/3: finished cards double as quick links (Browse again,
  // View agents, Manage address). Only Dismiss removes it.
  if (!progressKnown || dismissed) return null;

  async function dismiss() {
    setDismissed(true);
    const supabase = createClient();
    // Best effort: if this fails the card simply comes back next visit.
    await supabase.auth.updateUser({
      data: { [BUYER_GET_STARTED_DISMISSED_KEY]: new Date().toISOString() },
    });
  }

  return (
    <section aria-labelledby="get-started-title" className="mb-10">
      <div className="mb-4 flex items-center gap-3">
        <h2 id="get-started-title" className="text-ink text-section">
          Get started
        </h2>
        <ProgressRing value={doneCount} max={STEPS.length} label="Get started progress" />
        <button
          type="button"
          onClick={dismiss}
          className={textLinkVariants({ variant: "subtle", className: "ml-auto text-base" })}
        >
          Dismiss
        </button>
      </div>
      <ul className="grid gap-4 md:grid-cols-3">
        {STEPS.map((step) => {
          const done = isDone(step.key);
          return (
            <Card
              as="li"
              key={step.key}
              padding="none"
              // Clicking anywhere on the card follows its link, done or not.
              interactive
              className={cn(
                "group/card flex flex-col gap-4 p-6",
                // Done reads as a success, not as disabled: full contrast, a
                // green edge and badge, and a secondary button back.
                // A 2px emerald edge (ring, so the card does not shift by a pixel).
                done && "border-success-500 ring-1 ring-success-500",
              )}
            >
              <div className="relative flex h-16 w-fit items-center" aria-hidden="true">
                {step.icon}
                {done && (
                  <span className="-right-1.5 absolute bottom-0 flex size-6 items-center justify-center rounded-full bg-success-500 text-white ring-2 ring-surface-overlay">
                    <Check className="size-3.5" strokeWidth={3.5} />
                  </span>
                )}
              </div>
              <div className="space-y-2">
                <h3 className="font-bold text-ink text-xl tracking-tight">{step.title}</h3>
                <p className="text-base text-ink-secondary leading-relaxed">{step.description}</p>
              </div>
              <div className="mt-auto pt-1">
                {done ? (
                  // Same slot and size as the CTA, demoted to secondary: the
                  // badge on the icon already says it is done.
                  <Link
                    href={step.doneHref}
                    className={cn(buttonVariants({ variant: "secondary" }), cardLinkClass)}
                  >
                    {step.doneCta}
                    <ChevronRight
                      className="-mr-1 size-5 transition-transform duration-200 ease-standard group-hover/card:translate-x-0.5 motion-reduce:transition-none"
                      strokeWidth={2.25}
                      aria-hidden="true"
                    />
                  </Link>
                ) : step.dialog ? (
                  <button
                    type="button"
                    onClick={() => setAddressOpen(true)}
                    className={cn(buttonVariants(), cardLinkClass)}
                  >
                    {step.cta}
                    <ChevronRight
                      className="-mr-1 size-5 transition-transform duration-200 ease-standard group-hover/card:translate-x-0.5 motion-reduce:transition-none"
                      strokeWidth={2.25}
                      aria-hidden="true"
                    />
                  </button>
                ) : (
                  <Link href={step.href} className={cn(buttonVariants(), cardLinkClass)}>
                    {step.cta}
                    <ChevronRight
                      className="-mr-1 size-5 transition-transform duration-200 ease-standard group-hover/card:translate-x-0.5 motion-reduce:transition-none"
                      strokeWidth={2.25}
                      aria-hidden="true"
                    />
                  </Link>
                )}
              </div>
            </Card>
          );
        })}
      </ul>
      <AddressDialog
        open={addressOpen}
        onClose={() => setAddressOpen(false)}
        onSaved={() => {
          setDoneHere((current) => ({ ...current, hasAddress: true }));
          router.refresh();
        }}
        defaultName={defaultRecipientName}
      />
    </section>
  );
}

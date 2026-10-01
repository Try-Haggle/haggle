"use client";

import { useRouter } from "next/navigation";
import { buttonVariants } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  buildDemoCheckoutPayload,
  DEMO_CHECKOUT_PATH,
  DEMO_CHECKOUT_STORAGE_KEY,
} from "@/lib/demo-checkout";

/** Staging/local demo handoff: real agreement → simulated checkout. Parent gates on env. */
export function DemoCheckoutButton(props: {
  agreedPriceUsd: number;
  listingPriceUsd: number;
  item: string;
  rounds: number;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      className={cn(buttonVariants({ variant: "secondary" }), "w-full sm:w-auto")}
      onClick={() => {
        sessionStorage.setItem(
          DEMO_CHECKOUT_STORAGE_KEY,
          JSON.stringify(buildDemoCheckoutPayload(props)),
        );
        router.push(DEMO_CHECKOUT_PATH);
      }}
    >
      Continue with demo payment
    </button>
  );
}

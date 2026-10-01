import { notFound } from "next/navigation";
import { isDemoCheckoutEnabled } from "@/lib/demo-checkout";
import { DemoCheckoutClient } from "./demo-checkout-client";

/** Simulated checkout is a staging/local demo surface; 404 on production. */
export default function DemoCheckoutPage() {
  if (!isDemoCheckoutEnabled()) notFound();
  return <DemoCheckoutClient />;
}

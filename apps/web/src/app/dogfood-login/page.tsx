import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isDogfoodAuthWebSurfaceEnabled } from "@/lib/dogfood-auth-gate";
import { DogfoodLoginClient } from "./dogfood-login-client";

export const metadata: Metadata = {
  title: "Dogfood Login",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Staging/local-only persona picker for R2 buyer≠seller dogfood.
 * Production build/host → 404 (SoT §4).
 */
export default function DogfoodLoginPage() {
  if (!isDogfoodAuthWebSurfaceEnabled()) {
    notFound();
  }

  return <DogfoodLoginClient />;
}

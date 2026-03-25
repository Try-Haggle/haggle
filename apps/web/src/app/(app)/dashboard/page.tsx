"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Legacy /dashboard redirect.
 * Reads the user's mode preference from localStorage and redirects accordingly.
 * Also handles ?claim= param forwarding for the seller claim flow.
 */
export default function DashboardRedirect() {
  const router = useRouter();

  useEffect(() => {
    const mode = localStorage.getItem("haggle_mode");
    const params = new URLSearchParams(window.location.search);
    const claim = params.get("claim");

    if (claim) {
      // Claim flow always goes to seller dashboard
      router.replace(`/sell/dashboard?claim=${claim}`);
      return;
    }

    if (mode === "buying") {
      router.replace("/buy/dashboard");
    } else {
      router.replace("/sell/dashboard");
    }
  }, [router]);

  return null;
}

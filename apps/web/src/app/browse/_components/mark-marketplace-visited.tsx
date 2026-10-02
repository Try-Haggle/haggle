"use client";

import { useEffect } from "react";
import { BROWSED_MARKETPLACE_KEY } from "@/lib/buyer-onboarding";
import { createClient } from "@/lib/supabase/client";

/**
 * Records the first marketplace visit so the dashboard's "Find something you
 * want" step reads as done — however the buyer got here (the card, the nav
 * tab, a link). Renders nothing; writes once, then never again.
 */
export function MarkMarketplaceVisited() {
  useEffect(() => {
    void createClient().auth.updateUser({
      data: { [BROWSED_MARKETPLACE_KEY]: new Date().toISOString() },
    });
  }, []);
  return null;
}

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { createConfig, http, WagmiProvider } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { DisputeDetail } from "../../src/app/(app)/disputes/[id]/dispute-detail";
import ReviewerCasePage from "../../src/app/(app)/reviewer/cases/[id]/page";
import ReviewerDashboardPage from "../../src/app/(app)/reviewer/page";
import "../../src/app/globals.css";
const view = new URLSearchParams(location.search).get("view");
const root = document.getElementById("root");
const walletConfig = createConfig({
  chains: [baseSepolia],
  transports: { [baseSepolia.id]: http() },
});
const queryClient = new QueryClient();
if (root)
  createRoot(root).render(
    view === "reviewer" ? (
      <ReviewerCasePage />
    ) : view === "dashboard" ? (
      <ReviewerDashboardPage />
    ) : (
      <WagmiProvider config={walletConfig}>
        <QueryClientProvider client={queryClient}>
          <DisputeDetail
            userId="buyer"
            amountMinor={50000}
            dispute={{
              id: "d1",
              order_id: "o1",
              status: "UNDER_REVIEW",
              reason_code: "ITEM_NOT_AS_DESCRIBED",
              opened_by: "buyer",
              opened_at: "2026-09-26T00:00:00Z",
              evidence: [],
              metadata: { tier: 1, ai_resolution_assessor: { status: "COMPLETED" } },
            }}
          />
        </QueryClientProvider>
      </WagmiProvider>
    ),
  );

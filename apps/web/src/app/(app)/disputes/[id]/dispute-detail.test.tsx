import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DisputeDetail } from "./dispute-detail";
import type { Dispute } from "./page";

vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("./_components/advisor-chat", () => ({ AdvisorChat: () => null }));
vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x0000000000000000000000000000000000000001", isConnected: true }),
  useChainId: () => 84532,
  usePublicClient: () => ({
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success" }),
  }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
  useWriteContract: () => ({ writeContractAsync: vi.fn().mockResolvedValue("0xhash") }),
}));

import { api } from "@/lib/api-client";

const base: Dispute = {
  id: "d1",
  order_id: "o1",
  reason_code: "OTHER",
  status: "UNDER_REVIEW",
  opened_by: "buyer",
  evidence: [],
  opened_at: "2026-09-26T00:00:00Z",
  metadata: { tier: 1, ai_resolution_assessor: { status: "COMPLETED" } },
};
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  vi.mocked(api.get).mockResolvedValue({ deposit: null });
});
describe("dispute review tiers", () => {
  it("requests T2 and renders the actual escalation response", async () => {
    vi.mocked(api.post).mockResolvedValue({
      dispute: {
        ...base,
        metadata: {
          tier: 2,
          review_phase: "AWAITING_BONDS",
          panel_review_evaluation: {
            ready: false,
            voted_count: 0,
            assigned_count: 3,
            expected_reviewer_count: 5,
          },
        },
      },
      deposit: null,
    });
    render(<DisputeDetail dispute={base} userId="b1" amountMinor={50000} />);
    fireEvent.change(screen.getByLabelText("Reason for further review (optional)"), {
      target: { value: "Evidence was overlooked" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request Tier 2 review" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/disputes/d1/escalate", {
        escalated_by: "buyer",
        expected_tier: 1,
        reason: "Evidence was overlooked",
      }),
    );
    expect(await screen.findByText(/0 \/ 5 votes submitted/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Request Tier 3 review" })).not.toBeInTheDocument();
  });
  it("offers T3 only after a completed T2 panel", async () => {
    render(
      <DisputeDetail
        dispute={{
          ...base,
          metadata: {
            tier: 2,
            review_phase: "ACTIVE",
            panel_review_evaluation: {
              ready: true,
              tier: 2,
              outcome: "partial_refund",
              voted_count: 5,
              assigned_count: 5,
              expected_reviewer_count: 5,
            },
          },
        }}
        userId="b1"
        amountMinor={50000}
      />,
    );
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Request Tier 3 review" })).toBeEnabled();
    expect(screen.getByText(/Tier 3 review costs \$30.00/)).toBeVisible();
  });
  it("stops at the final tier", async () => {
    render(
      <DisputeDetail
        dispute={{
          ...base,
          metadata: { tier: 3, panel_review_evaluation: { ready: true, tier: 3 } },
        }}
        userId="b1"
      />,
    );
    await act(async () => {});
    expect(screen.getByText("This is the final review tier.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Request Tier/ })).not.toBeInTheDocument();
  });
  it("shows a failed request while preserving the current case", async () => {
    vi.mocked(api.post).mockRejectedValue(new Error("Review changed. Refresh and try again."));
    render(<DisputeDetail dispute={base} userId="b1" />);
    fireEvent.click(screen.getByRole("button", { name: "Request Tier 2 review" }));
    expect(await screen.findByText("Review changed. Refresh and try again.")).toBeVisible();
    expect(screen.getByText("d1")).toBeVisible();
  });
  it("does not escalate a resolved or stale assessment", async () => {
    render(
      <DisputeDetail
        dispute={{ ...base, metadata: { ...base.metadata, ai_assessment_stale: true } }}
        userId="b1"
      />,
    );
    await act(async () => {});
    expect(screen.queryByRole("button", { name: /Request Tier/ })).not.toBeInTheDocument();
  });
});

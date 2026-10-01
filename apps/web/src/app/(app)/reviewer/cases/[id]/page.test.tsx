import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import ReviewerCasePage, { type ReviewerCase } from "./page";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "d1" }) }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));

import { api } from "@/lib/api-client";

const data: ReviewerCase = {
  assignment_id: "a1",
  assignment_tier: 3,
  current_tier: 3,
  voting_open: true,
  dispute: { id: "d1", reason_code: "OTHER", status: "UNDER_REVIEW", tier: 3 },
  order: { item_title: "Camera", amount_minor: 50000 },
  evidence: [
    {
      id: "e1",
      submitted_by: "buyer",
      type: "text",
      text: "Lens was broken",
      uri: null,
      created_at: "2026-09-26",
    },
  ],
  previous_tier_decision: null,
  my_vote: null,
  my_reasoning: null,
  voting_deadline: null,
  panel: { ready: false, assigned_count: 7, voted_count: 2, expected_reviewer_count: 7 },
};
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue(data);
});
it("uses the real nested response and sends the tier-bound vote", async () => {
  render(<ReviewerCasePage />);
  expect(await screen.findByText("Lens was broken")).toBeVisible();
  expect(screen.getByText(/Tier 3: 2 \/ 7 votes/)).toBeVisible();
  fireEvent.change(screen.getByLabelText("Reasoning (optional)"), {
    target: { value: "Photos confirm damage" },
  });
  vi.mocked(api.post).mockResolvedValue({});
  vi.mocked(api.get).mockResolvedValue({
    ...data,
    my_vote: 50,
    my_reasoning: "Photos confirm damage",
  });
  fireEvent.click(screen.getByRole("button", { name: "Submit vote" }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith("/reviewer/assignments/d1/vote", {
      vote: 50,
      reasoning: "Photos confirm damage",
      expected_tier: 3,
    }),
  );
  expect(await screen.findByText(/Your vote: 50\/100/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Submit vote" })).not.toBeInTheDocument();
});
it("keeps a previous-tier juror read-only after escalation", async () => {
  vi.mocked(api.get).mockResolvedValue({
    ...data,
    assignment_tier: 2,
    voting_open: false,
    my_vote: 75,
  });
  render(<ReviewerCasePage />);
  expect(await screen.findByText(/Your Tier 2 review is complete/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Submit vote" })).not.toBeInTheDocument();
});

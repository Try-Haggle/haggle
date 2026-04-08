import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PromotionRulesTable } from "../PromotionRulesTable";
import type { PromotionRule } from "@/lib/admin-api";

function makeRule(overrides: Partial<PromotionRule> = {}): PromotionRule {
  return {
    category: "default",
    candidateMinUse: 3,
    emergingMinUse: 10,
    candidateMinAgeDays: 1,
    emergingMinAgeDays: 7,
    suggestionAutoPromoteCount: 5,
    enabled: true,
    ...overrides,
  };
}

describe("<PromotionRulesTable />", () => {
  it("renders rules, inline edit triggers update, Run Now posts and refetches last run", async () => {
    const rule = makeRule();
    const fetchRules = vi.fn().mockResolvedValue({ rules: [rule] });
    const updateRule = vi.fn().mockResolvedValue({
      rule: { ...rule, candidateMinUse: 9 },
    });
    const runJob = vi.fn().mockResolvedValue({ report: {} });
    const fetchLastRun = vi
      .fn()
      .mockResolvedValueOnce({ lastRun: null })
      .mockResolvedValueOnce({
        lastRun: { createdAt: "2026-04-08T10:00:00Z" },
      });

    render(
      <PromotionRulesTable
        fetchRules={fetchRules}
        updateRule={updateRule}
        runJob={runJob}
        fetchLastRun={fetchLastRun}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("rule-row-default")).toBeInTheDocument(),
    );

    // Start edit
    fireEvent.click(screen.getByTestId("rule-edit-default"));
    const input = screen.getByTestId(
      "rule-input-default-candidateMinUse",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.click(screen.getByTestId("rule-save-default"));

    await waitFor(() =>
      expect(updateRule).toHaveBeenCalledWith(
        "default",
        expect.objectContaining({ candidateMinUse: 9 }),
      ),
    );

    // Delete should be disabled for "default"
    expect(screen.getByTestId("rule-delete-default")).toBeDisabled();

    // Run job + refetch last run
    fireEvent.click(screen.getByTestId("run-tag-promote"));
    await waitFor(() => expect(runJob).toHaveBeenCalled());
    // lastRun refetched (called twice: initial mount + after run)
    await waitFor(() => expect(fetchLastRun).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByTestId("last-run-at")).toBeInTheDocument(),
    );
  });
});

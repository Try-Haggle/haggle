import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/admin-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/admin-api")>("@/lib/admin-api");
  return {
    ...actual,
    adminApi: {
      inbox: {
        summary: vi.fn(),
        list: vi.fn().mockResolvedValue({ items: [] }),
        detail: vi.fn(),
      },
      promotionRules: {
        list: vi.fn(),
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
      },
      jobs: { lastTagPromote: vi.fn() },
    },
  };
});

import { InboxTabs } from "../InboxTabs";

describe("<InboxTabs />", () => {
  it("switches active tab on click", () => {
    render(<InboxTabs />);

    const tagTab = screen.getByTestId("tab-tag");
    const disputeTab = screen.getByTestId("tab-dispute");
    const paymentTab = screen.getByTestId("tab-payment");

    // Default: tag active
    expect(tagTab).toHaveAttribute("aria-selected", "true");
    expect(disputeTab).toHaveAttribute("aria-selected", "false");

    fireEvent.click(disputeTab);
    expect(disputeTab).toHaveAttribute("aria-selected", "true");
    expect(tagTab).toHaveAttribute("aria-selected", "false");

    fireEvent.click(paymentTab);
    expect(paymentTab).toHaveAttribute("aria-selected", "true");
    expect(disputeTab).toHaveAttribute("aria-selected", "false");
  });
});

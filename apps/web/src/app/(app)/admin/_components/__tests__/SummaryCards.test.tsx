import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/admin-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/admin-api")>("@/lib/admin-api");
  return {
    ...actual,
    adminApi: {
      inbox: {
        summary: vi.fn().mockResolvedValue({
          tags: { pending: 3, autoPromoteReady: 1 },
          disputes: { open: 5, underReview: 0, waiting: 0 },
          payments: { failed: 2 },
          computedAt: new Date().toISOString(),
        }),
        list: vi.fn(),
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

import { SummaryCards } from "../SummaryCards";

describe("<SummaryCards />", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders 4 summary cards with fetched counts", async () => {
    render(<SummaryCards />);

    // All 4 cards present
    expect(screen.getByTestId("card-total")).toBeInTheDocument();
    expect(screen.getByTestId("card-tags")).toBeInTheDocument();
    expect(screen.getByTestId("card-disputes")).toBeInTheDocument();
    expect(screen.getByTestId("card-payments")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("card-tags")).toHaveTextContent("3");
    });
    expect(screen.getByTestId("card-disputes")).toHaveTextContent("5");
    expect(screen.getByTestId("card-payments")).toHaveTextContent("2");
    // total = 3 + 5 + 2 = 10
    expect(screen.getByTestId("card-total")).toHaveTextContent("10");
  });
});

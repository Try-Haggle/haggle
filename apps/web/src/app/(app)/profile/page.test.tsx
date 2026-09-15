import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: mocks.getUser,
      signOut: vi.fn().mockResolvedValue({}),
    },
  }),
}));

vi.mock("@/hooks/use-credit-balance", () => ({
  useCreditBalance: () => ({
    source: "api" as const,
    balance: 12,
    unlimited: false,
    accountId: "acct_test",
    loading: false,
    error: null,
    reload: async () => {},
  }),
}));

import ProfilePage from "./page";

describe("ProfilePage credits chip", () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          email: "buyer@example.com",
          user_metadata: { full_name: "Buyer Example" },
        },
      },
    });
  });

  it("shows Haggle credits beside Signed in as", async () => {
    render(<ProfilePage />);

    expect(screen.getByText("Signed in as")).toBeInTheDocument();
    expect(screen.getByTestId("credit-balance-chip")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Buyer Example")).toBeInTheDocument();
    });
    expect(screen.getByText("buyer@example.com")).toBeInTheDocument();
  });
});

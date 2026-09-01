import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ListingDetail } from "./page";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
  track: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/providers/amplitude-provider", () => ({
  useAmplitude: () => ({ track: mocks.track }),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...original, api: { get: mocks.get, delete: mocks.delete } };
});

import { DetailContent } from "./detail-content";

function listing(overrides: Partial<ListingDetail> = {}): ListingDetail {
  return {
    id: "draft-1",
    title: "iPhone 15 Pro",
    description: null,
    category: "phone",
    condition: "excellent",
    photoUrl: null,
    targetPrice: "880",
    floorPrice: null,
    tags: null,
    status: "published",
    negotiationAgentSnapshot: null,
    sellingDeadline: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    publicId: "HN3VkK50",
    ...overrides,
  };
}

describe("seller listing delete", () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.get.mockReset();
    mocks.delete.mockReset();
    mocks.track.mockReset();
    mocks.get.mockResolvedValue({ sessions: [] });
    vi.stubGlobal("confirm", vi.fn());
    vi.stubGlobal("alert", vi.fn());
  });

  it("asks once, then deletes and returns to the dashboard", async () => {
    vi.mocked(window.confirm).mockReturnValue(true);
    mocks.delete.mockResolvedValue({ ok: true });

    render(<DetailContent listing={listing()} sellerId="seller-1" />);
    await userEvent.click(screen.getByRole("button", { name: "Delete listing" }));

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.delete).toHaveBeenCalledWith("/api/listings/draft-1");
    expect(mocks.push).toHaveBeenCalledWith("/sell/dashboard");
  });

  it("does nothing when the seller cancels the confirm", async () => {
    vi.mocked(window.confirm).mockReturnValue(false);

    render(<DetailContent listing={listing()} sellerId="seller-1" />);
    await userEvent.click(screen.getByRole("button", { name: "Delete listing" }));

    expect(mocks.delete).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("hides delete after the listing is already withdrawn", async () => {
    render(<DetailContent listing={listing({ status: "expired" })} sellerId="seller-1" />);
    await waitFor(() => {
      expect(screen.queryByText("Checking verification status...")).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Delete listing" })).not.toBeInTheDocument();
  });
});

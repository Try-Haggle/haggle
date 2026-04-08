import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const tagApprove = vi.fn();
const tagReject = vi.fn();
const tagMerge = vi.fn();

vi.mock("@/lib/admin-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/admin-api")>("@/lib/admin-api");
  return {
    ...actual,
    adminApi: {
      actions: {
        tagApprove: (...args: unknown[]) => tagApprove(...args),
        tagReject: (...args: unknown[]) => tagReject(...args),
        tagMerge: (...args: unknown[]) => tagMerge(...args),
        disputeEscalate: vi.fn(),
        disputeResolve: vi.fn(),
        paymentMarkReview: vi.fn(),
      },
    },
  };
});

import { ActionButtons } from "../ActionButtons";
import type { AdminInboxDetail } from "@/lib/admin-api";

const tagDetail: AdminInboxDetail = {
  type: "tag",
  item: {
    id: "sug-1",
    label: "vintage",
    normalizedLabel: "vintage",
    occurrenceCount: 5,
    firstSeenListingId: null,
    createdAt: new Date("2026-01-01").toISOString(),
    autoPromoteEligible: true,
  },
  raw: {},
};

describe("<ActionButtons />", () => {
  beforeEach(() => {
    tagApprove.mockReset();
    tagReject.mockReset();
    tagMerge.mockReset();
  });

  it("tag-approve success calls onDone with the suggestion id", async () => {
    tagApprove.mockResolvedValueOnce({ result: {} });
    const onDone = vi.fn();

    render(<ActionButtons detail={tagDetail} onDone={onDone} />);
    fireEvent.click(screen.getByTestId("action-tag-approve"));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith("sug-1"));
    expect(tagApprove).toHaveBeenCalledWith({ suggestionId: "sug-1" });
    expect(screen.queryByTestId("action-error")).not.toBeInTheDocument();
  });

  it("tag-approve failure shows error and does NOT call onDone", async () => {
    tagApprove.mockRejectedValueOnce(new Error("server exploded"));
    const onDone = vi.fn();

    render(<ActionButtons detail={tagDetail} onDone={onDone} />);
    fireEvent.click(screen.getByTestId("action-tag-approve"));

    await waitFor(() =>
      expect(screen.getByTestId("action-error")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("action-error")).toHaveTextContent(
      "server exploded",
    );
    expect(onDone).not.toHaveBeenCalled();
  });
});

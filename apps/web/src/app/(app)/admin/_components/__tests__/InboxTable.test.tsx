import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InboxTable, type ColumnDef } from "../InboxTable";
import type {
  InboxListResponse,
  InboxType,
  TagInboxItem,
} from "@/lib/admin-api";

function makeTagItems(n: number, prefix = "a"): TagInboxItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i}`,
    label: `Tag ${i}`,
    normalizedLabel: `tag-${i}`,
    occurrenceCount: i + 1,
    firstSeenListingId: null,
    createdAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    autoPromoteEligible: false,
  }));
}

const tagColumns: ColumnDef<TagInboxItem>[] = [
  { key: "id", label: "Id", render: (r) => <span>{r.id}</span> },
  { key: "label", label: "Label", render: (r) => <span>{r.label}</span> },
  {
    key: "count",
    label: "Count",
    render: (r) => <span>{r.occurrenceCount}</span>,
  },
];

describe("<InboxTable />", () => {
  it("renders rows via column renderers and fires onSelect", async () => {
    const items = makeTagItems(2);
    const fetchList = vi
      .fn<
        (
          t: InboxType,
          p: { limit: number; offset: number },
        ) => Promise<InboxListResponse<TagInboxItem>>
      >()
      .mockResolvedValue({ items });
    const onSelect = vi.fn();

    render(
      <InboxTable
        type="tag"
        columns={tagColumns}
        fetchList={fetchList}
        onSelect={onSelect}
        pageSize={2}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("inbox-row-a-0")).toBeInTheDocument(),
    );
    expect(screen.getByText("Tag 0")).toBeInTheDocument();
    expect(screen.getByText("Tag 1")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("inbox-row-a-0"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]![0]!.id).toBe("a-0");
  });

  it("paginates next/prev updates offset", async () => {
    const fetchList = vi
      .fn<
        (
          t: InboxType,
          p: { limit: number; offset: number },
        ) => Promise<InboxListResponse<TagInboxItem>>
      >()
      .mockImplementation(async (_t, p) => ({
        items: p.offset === 0 ? makeTagItems(2, "p0") : makeTagItems(1, "p1"),
      }));

    render(
      <InboxTable
        type="tag"
        columns={tagColumns}
        fetchList={fetchList}
        pageSize={2}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("inbox-row-p0-0")).toBeInTheDocument(),
    );
    expect(fetchList).toHaveBeenCalledWith("tag", { limit: 2, offset: 0 });

    fireEvent.click(screen.getByText("Next"));

    await waitFor(() =>
      expect(screen.getByTestId("inbox-row-p1-0")).toBeInTheDocument(),
    );
    expect(fetchList).toHaveBeenCalledWith("tag", { limit: 2, offset: 2 });

    fireEvent.click(screen.getByText("Prev"));

    await waitFor(() =>
      expect(screen.getByTestId("inbox-row-p0-0")).toBeInTheDocument(),
    );
  });

  it("shows retry button on error and re-fetches when clicked", async () => {
    let call = 0;
    const fetchList = vi
      .fn<
        (
          t: InboxType,
          p: { limit: number; offset: number },
        ) => Promise<InboxListResponse<TagInboxItem>>
      >()
      .mockImplementation(async () => {
        call += 1;
        if (call === 1) throw new Error("boom");
        return { items: makeTagItems(1, "ok") };
      });

    render(
      <InboxTable
        type="tag"
        columns={tagColumns}
        fetchList={fetchList}
        pageSize={2}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("inbox-retry")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("inbox-retry"));

    await waitFor(() =>
      expect(screen.getByTestId("inbox-row-ok-0")).toBeInTheDocument(),
    );
  });
});

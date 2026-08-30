/**
 * Listing details panel.
 *
 * It renders the listing page's own components against the same payload, so
 * these tests check that the whole listing reaches the panel — not a thinner
 * summary that drifts from the page.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubjectListing } from "@/lib/messaging-api";
import { SubjectPanel } from "./subject-panel";

const subject = vi.fn();
vi.mock("@/lib/messaging-api", () => ({
  messagingApi: { subject: (...args: unknown[]) => subject(...args) },
}));

const SELLER_ID = "11111111-1111-4111-8111-111111111111";
const BUYER_ID = "22222222-2222-4222-8222-222222222222";

function listing(overrides: Partial<SubjectListing> = {}): SubjectListing {
  return {
    id: "listing-1",
    publicId: "dByKO_6u",
    publishedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    title: "2019 Honda Civic EX",
    description: "Second owner, service records included.",
    category: "vehicles",
    condition: "good",
    photoUrl: null,
    targetPrice: "9000.00",
    tags: ["sedan", "low mileage"],
    sellerAgentPreset: "verifier",
    sellingDeadline: null,
    sellerRequiredCriteria: [{ checkId: "title_clean", ask: "Is the title clean?" }],
    specs: [{ checkId: "mileage", label: "Mileage", value: "48,000 mi" }],
    ...overrides,
  };
}

function renderPanel(props: Partial<React.ComponentProps<typeof SubjectPanel>> = {}) {
  return render(
    <SubjectPanel
      conversationId="conversation-1"
      currentUserId={props.currentUserId ?? BUYER_ID}
      open={props.open ?? true}
      onClose={vi.fn()}
      variant="panel"
      outcome={props.outcome ?? null}
    />,
  );
}

/**
 * Resolve on a later task, the way a network call does.
 *
 * An immediately-resolved mock hid a real bug: the fetch effect listed its own
 * state in its dependencies, so it cancelled its in-flight request as soon as
 * it set "loading" — and the panel span forever in the browser while the test
 * passed on microtask timing.
 */
function afterATick<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), 10));
}

beforeEach(() => {
  vi.clearAllMocks();
  subject.mockImplementation(() =>
    afterATick({
      subject: { type: "negotiation_session", id: "session-1" },
      listing: listing(),
      sellerId: SELLER_ID,
    }),
  );
});

describe("SubjectPanel", () => {
  it("fetches nothing until it is opened", () => {
    renderPanel({ open: false });

    expect(subject).not.toHaveBeenCalled();
  });

  it("shows a spinner first and then the listing, without cancelling itself", async () => {
    renderPanel();

    expect(screen.getByRole("status", { name: /loading/i })).toBeInTheDocument();
    expect(await screen.findByText("2019 Honda Civic EX")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /loading/i })).toBeNull();
  });

  it("shows the listing the way the listing page does", async () => {
    renderPanel();

    expect(await screen.findByText("2019 Honda Civic EX")).toBeInTheDocument();
    // Price, condition/category/tag chips, published specs, seller's note.
    expect(screen.getByText("Asking price")).toBeInTheDocument();
    expect(screen.getByText("vehicles")).toBeInTheDocument();
    expect(screen.getByText("sedan")).toBeInTheDocument();
    expect(screen.getByText("48,000 mi")).toBeInTheDocument();
    expect(screen.getByText(/service records included/)).toBeInTheDocument();
  });

  it("names the seller's agent and what they require", async () => {
    renderPanel();

    await screen.findByText("2019 Honda Civic EX");
    expect(screen.getByText(/Is the title clean\?/)).toBeInTheDocument();
    // Buyer framing on the agent card.
    expect(screen.getByText(/You're up against/)).toBeInTheDocument();
    expect(screen.getByText("The seller's AI negotiator")).toBeInTheDocument();
  });

  it("links out to the full listing", async () => {
    renderPanel();

    const link = await screen.findByRole("link", { name: /View full listing/ });
    expect(link).toHaveAttribute("href", "/l/dByKO_6u");
  });

  it("says so when the listing is gone instead of rendering an empty panel", async () => {
    subject.mockImplementation(() => afterATick({ subject: null, listing: null, sellerId: null }));
    renderPanel();

    expect(await screen.findByText(/no longer available/)).toBeInTheDocument();
  });

  it("reports a failed load", async () => {
    subject.mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error("offline")), 10)),
    );
    renderPanel();

    expect(await screen.findByText(/Couldn't load the listing/)).toBeInTheDocument();
  });

  it("frames the agent as the seller's own when the seller is looking", async () => {
    renderPanel({ currentUserId: SELLER_ID });

    await screen.findByText("2019 Honda Civic EX");
    // Owner framing: the card speaks about who represents them, not an opponent.
    expect(screen.getByText("Your negotiator")).toBeInTheDocument();
    expect(screen.queryByText(/You're up against/)).toBeNull();
  });
});

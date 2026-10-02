import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoHeader } from "../demo/try/_components/demo-header";
import { SavingsCard } from "../demo/try/_components/savings-card";
import { Calculator } from "./calculator";

vi.mock("@/components/waitlist-form", () => ({ WaitlistForm: () => null }));

function selectCategory(label: string) {
  const select = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
  const option = Array.from(select.options).find((o) => o.textContent === label);
  fireEvent.change(select, { target: { value: option?.value } });
}

describe("calculator eBay comparison (verified category)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows the Demo badge, assumptions and conditions beside every claim", () => {
    render(<Calculator />);
    for (const id of [
      "ebay-disclaimer-table",
      "ebay-disclaimer-charts",
      "ebay-disclaimer-banner",
      "ebay-disclaimer-zone",
    ]) {
      const el = screen.getAllByTestId(id)[0];
      expect(el.textContent).toContain("Demo · assumption-based comparison");
      expect(el.textContent).toContain("excludes shipping, handling and sales tax");
      expect(el.textContent).toContain("higher or lower");
      expect(el.textContent).toContain("Illustrative Haggle fee assumption");
    }
    const terms = screen.getByTestId("ebay-disclaimer-table-terms").textContent ?? "";
    for (const part of [
      "single item",
      "no Store subscription",
      "US-registered",
      "2026-10-02",
      "ebay-us-nostore-2026-10-02-v1",
      "selling-fees",
      "total sale amount",
    ]) {
      expect(terms).toContain(part);
    }
  });

  it("keeps the notice outside the horizontally scrolling table", () => {
    render(<Calculator />);
    const notice = screen.getByTestId("ebay-disclaimer-table");
    expect(notice.closest(".overflow-x-auto")).toBeNull();
  });

  it("shares only the calculator link, never amounts", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<Calculator />);
    fireEvent.click(screen.getByText("Share calculator link"));
    const text = decodeURIComponent(String(open.mock.calls[0][0]));
    expect(text).toContain("Demo");
    expect(text).not.toMatch(/I keep|\$\d+ more|eBay:/);
  });

  it("uses lower/higher/no-difference wording from the sign of the fee difference", () => {
    render(<Calculator />);
    expect(screen.getByText(/lower fees than eBay est\.$/)).toBeTruthy(); // $500: eBay fee 68.40 vs Haggle 7.50
    fireEvent.change(screen.getByPlaceholderText("Sale price"), { target: { value: "5" } });
    // $5: eBay 0.98 vs Haggle 0.075 -> still lower; wording only ever derives from the sign
    expect(screen.getByText(/lower fees than eBay est\.$/)).toBeTruthy();
  });
});

describe("calculator eBay comparison (excluded categories)", () => {
  it.each([
    "Sneakers & Streetwear",
    "General / Other",
    "Fashion & Apparel",
    "Collectibles & Trading Cards",
  ])("hides eBay numbers, banner and share for %s", (label) => {
    render(<Calculator />);
    selectCategory(label);
    expect(screen.getByTestId("ebay-not-compared")).toBeTruthy();
    expect(screen.queryByText("eBay")).toBeNull();
    expect(screen.queryByTestId("ebay-disclaimer-banner")).toBeNull();
    expect(screen.queryByText("Share calculator link")).toBeNull();
    expect(screen.queryByTestId("ebay-disclaimer-zone")).toBeNull();
    expect(document.body.textContent).not.toMatch(/\$63|more\b.*eBay/);
  });
});

describe("demo surfaces", () => {
  it("demo header does not claim a live Swappa market price", () => {
    render(<DemoHeader phase="OPENING" round={0} />);
    expect(screen.queryByText(/Swappa/)).toBeNull();
    expect(screen.getByText(/illustrative price/)).toBeTruthy();
  });

  it("savings card labels Haggle 1.5% as illustrative and shows terms", () => {
    render(<SavingsCard finalPrice={800} accepted onRestart={() => {}} />);
    expect(screen.getByText(/Illustrative: keep at 1.5% fee/)).toBeTruthy();
    expect(screen.getByTestId("savings-ebay-notice-terms").textContent).toContain("2026-10-02");
    expect(screen.queryByText("You keep on Haggle")).toBeNull();
  });
});

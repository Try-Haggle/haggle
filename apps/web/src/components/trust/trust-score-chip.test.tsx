import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TrustScoreChip } from "./trust-score-chip";

describe("TrustScoreChip", () => {
  it("renders nothing without a summary", () => {
    const { container } = render(<TrustScoreChip trust={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a rounded score and deal count", () => {
    render(
      <TrustScoreChip trust={{ score: 81.25, status: "MATURE", completedTransactions: 12 }} />,
    );
    expect(screen.getByText("Trust 81 · 12 deals")).toBeInTheDocument();
  });

  it("labels an unscored seller as New", () => {
    render(<TrustScoreChip trust={{ score: null, status: "NEW", completedTransactions: 0 }} />);
    expect(screen.getByText("Trust New")).toBeInTheDocument();
  });
});

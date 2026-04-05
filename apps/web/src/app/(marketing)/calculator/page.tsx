import type { Metadata } from "next";
import { Calculator } from "./calculator";

export const metadata: Metadata = {
  title: "eBay Fee Calculator 2026 — Compare Marketplace Fees",
  description:
    "Compare eBay, Poshmark, Mercari, StockX, and Depop fees side by side. See how much more you keep with Haggle's 1.5% flat fee.",
};

export default function CalculatorPage() {
  return <Calculator />;
}

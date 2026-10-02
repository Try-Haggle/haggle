import type { Metadata } from "next";
import { Calculator } from "./calculator";

export const metadata: Metadata = {
  title: "eBay Fee Calculator 2026 — Compare Marketplace Fees",
  description:
    "Compare eBay, Poshmark, Mercari, StockX, and Depop fees side by side. Demo comparison using assumptions (item price only); an illustrative 1.5% Haggle fee is not a transaction quote.",
};

export default function CalculatorPage() {
  return <Calculator />;
}

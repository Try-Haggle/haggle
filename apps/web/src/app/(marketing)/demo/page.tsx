import type { Metadata } from "next";
import { Demo } from "./demo";

export const metadata: Metadata = {
  title: "AI Negotiation Demo — Watch AI Negotiate in Real Time",
  description:
    "See Haggle's AI negotiate the best price for MacBook, iPhone, PS5 and more. Interactive demo — no signup required.",
};

export default function DemoPage() {
  return <Demo />;
}

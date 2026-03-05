import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Haggle — AI-Powered Negotiation Marketplace",
  description:
    "The Stripe of Negotiations. Buy and sell with AI-assisted price negotiation.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

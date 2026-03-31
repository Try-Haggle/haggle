import type { Metadata } from "next";
import { AmplitudeProvider } from "@/providers/amplitude-provider";
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
      <body className="bg-bg-primary text-slate-100 antialiased" suppressHydrationWarning>
        <AmplitudeProvider>{children}</AmplitudeProvider>
      </body>
    </html>
  );
}

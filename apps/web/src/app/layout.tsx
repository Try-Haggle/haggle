import type { Metadata } from "next";
import { AmplitudeProvider } from "@/providers/amplitude-provider";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://tryhaggle.ai"),
  title: {
    default: "Haggle — AI Negotiation Protocol",
    template: "%s | Haggle",
  },
  description:
    "AI negotiates for you. 1.5% total fee. Non-custodial smart contract payments. The Stripe of Negotiations.",
  openGraph: {
    type: "website",
    siteName: "Haggle",
  },
  twitter: {
    card: "summary_large_image",
  },
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

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://tryhaggle.ai"),
  title: {
    default: "Haggle — Buy. Sell. Let your agent haggle.",
    template: "%s | Haggle",
  },
  description:
    "A marketplace where your AI agent negotiates for you. Build your own agent, and let it handle the rest.",
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
      <body className="antialiased">{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import { AmplitudeProvider } from "@/providers/amplitude-provider";
import { Toaster } from "sonner";
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
        <Toaster
          position="bottom-center"
          duration={5000}
          expand={true}
          richColors
          toastOptions={{
            style: { background: "#1e293b", color: "#f1f5f9", border: "1px solid #334155" },
          }}
        />
      </body>
    </html>
  );
}

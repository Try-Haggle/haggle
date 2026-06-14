import type { Metadata } from "next";
import { IBM_Plex_Mono, Lora, Plus_Jakarta_Sans } from "next/font/google";
import { Toaster } from "sonner";
import { AmplitudeProvider } from "@/providers/amplitude-provider";
import "./globals.css";

const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-jakarta",
  display: "swap",
});

const display = Lora({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-lora",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

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

// Runs before paint to restore a saved theme (avoids dark→light flash).
// Default is Dark; Light only if explicitly chosen and persisted.
const themeScript = `(function(){try{var t=localStorage.getItem('haggle-theme');if(t==='dark'||t==='light'){document.documentElement.dataset.theme=t;}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${sans.variable} ${display.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/** biome-ignore lint/security/noDangerouslySetInnerHtml: inline no-FOUC theme bootstrap */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="bg-surface font-sans text-ink antialiased" suppressHydrationWarning>
        <AmplitudeProvider>{children}</AmplitudeProvider>
        <Toaster
          position="bottom-center"
          duration={5000}
          expand
          toastOptions={{
            style: {
              background: "var(--bg-raised)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-default)",
            },
          }}
        />
      </body>
    </html>
  );
}

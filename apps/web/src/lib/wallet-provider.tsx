"use client";

import { getDefaultConfig, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  metaMaskWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import type { Locale } from "@/lib/i18n";
import { HAGGLE_WALLET_CHAIN } from "@/lib/wallet-network";

const queryClient = new QueryClient();

const config = getDefaultConfig({
  appName: "Haggle",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "haggle-mvp",
  chains: [HAGGLE_WALLET_CHAIN],
  ssr: true,
  wallets: [
    {
      groupName: "Recommended",
      wallets: [coinbaseWallet, metaMaskWallet, rainbowWallet, walletConnectWallet],
    },
  ],
});

export function WalletProvider({
  children,
  locale = "en",
}: {
  children: ReactNode;
  locale?: Locale;
}) {
  return (
    <WagmiProvider config={config} reconnectOnMount>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider locale={locale === "ko" ? "ko-KR" : "en-US"}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

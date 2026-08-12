import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.join(process.cwd(), "src/app/(app)/orders/[id]/page.tsx"), "utf8");
const providerSource = readFileSync(
  path.join(process.cwd(), "src/lib/wallet-provider.tsx"),
  "utf8",
);

describe("order detail wallet provider contract", () => {
  it("runs the component that owns wagmi hooks below WalletProvider", () => {
    const contentStart = source.indexOf("function OrderDetailContent() {");
    const pageStart = source.indexOf("export default function OrderDetailPage() {");

    expect(contentStart).toBeGreaterThan(-1);
    expect(pageStart).toBeGreaterThan(contentStart);

    const contentSource = source.slice(contentStart, pageStart);
    expect(contentSource).toContain("useAccount()");
    expect(contentSource).toContain("useChainId()");
    expect(contentSource).toContain("useSwitchChain()");
    expect(contentSource).toContain("useWriteContract()");
    const pageSource = source.slice(pageStart);
    expect(pageSource).toContain("<WalletProvider>");
    expect(pageSource).toContain("<OrderDetailContent />");
    expect(pageSource).toContain("</WalletProvider>");
    expect(providerSource).toContain("reconnectOnMount");
  });

  it("lets the buyer execute the final release without replacing the seller payout wallet", () => {
    expect(source).toMatch(
      /!activeDispute\s*&&\s*isBuyer\s*&&\s*settlement\.phase === "FULLY_RELEASED"/,
    );
    expect(source).not.toContain("{ seller_wallet_address: walletAddress }");
    expect(source).not.toContain(
      "getAddress(request.contract_call.params.sellerWallet) !== getAddress(walletAddress)",
    );
  });
});

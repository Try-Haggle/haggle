import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentStep } from "./payment-step";

const walletState = vi.hoisted(() => ({
  address: undefined as `0x${string}` | undefined,
  isConnected: false,
}));
const writeContractAsync = vi.hoisted(() => vi.fn());
const waitForTransactionReceipt = vi.hoisted(() => vi.fn());
const apiPost = vi.hoisted(() => vi.fn());

vi.mock("@rainbow-me/rainbowkit", () => {
  function ConnectButton() {
    return <button type="button">Connect Wallet</button>;
  }
  ConnectButton.Custom = ({
    children,
  }: {
    children: (props: { openAccountModal: () => void }) => React.ReactNode;
  }) => children({ openAccountModal: vi.fn() });
  return { ConnectButton };
});

vi.mock("wagmi", () => ({
  useAccount: () => walletState,
  useBalance: () => ({ data: null }),
  useChainId: () => 84532,
  usePublicClient: () => ({ waitForTransactionReceipt }),
  useSwitchChain: () => ({ switchChain: vi.fn(), isPending: false }),
  useWriteContract: () => ({ writeContractAsync, isPending: false }),
}));

vi.mock("@/lib/api-client", () => ({
  api: { post: apiPost },
}));

const props = {
  settlementApprovalId: "approval-test",
  amountMinor: 1000,
  currency: "USD",
  requiresShipping: true,
  physicalShippingReadiness: {
    ready: true,
    live_label_max_minor: 5000,
    missing: [],
  },
};

describe("PaymentStep navigation and wallet reuse", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    walletState.address = undefined;
    walletState.isConnected = false;
    writeContractAsync.mockReset();
    waitForTransactionReceipt.mockReset();
    apiPost.mockReset();
  });

  afterEach(() => cleanup());

  it("keeps checkout choices when the buyer goes back or reopens checkout", async () => {
    const user = userEvent.setup();
    const firstRender = render(<PaymentStep {...props} />);

    const integrationCard = screen.getByText("Integration test").closest("button");
    const cryptoCard = screen.getByText(/Direct/).closest("button");
    expect(integrationCard).not.toBeNull();
    expect(cryptoCard).not.toBeNull();

    await user.click(integrationCard!);
    await user.click(cryptoCard!);
    expect(screen.getByRole("button", { name: "Connect Wallet" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back to payment options" }));
    expect(screen.getByText("Integration test").closest("button")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText(/Direct/).closest("button")).toHaveAttribute("aria-pressed", "true");

    await waitFor(() =>
      expect(window.sessionStorage.getItem("haggle:checkout-draft:approval-test")).toContain(
        "integration_manual",
      ),
    );
    firstRender.unmount();
    render(<PaymentStep {...props} />);

    await waitFor(() =>
      expect(screen.getByText("Integration test").closest("button")).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(screen.getByText(/Direct/).closest("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a connected wallet without asking the buyer to connect again", async () => {
    walletState.address = "0x0000000000000000000000000000000000000001";
    walletState.isConnected = true;
    const user = userEvent.setup();
    render(<PaymentStep {...props} />);

    await user.click(screen.getByText("Integration test").closest("button")!);
    await user.click(screen.getByText(/Direct/).closest("button")!);

    expect(screen.getByText("Wallet connected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect Wallet" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
  });

  it("lets the buyer return from deposit to approval without approving twice", async () => {
    walletState.address = "0x0000000000000000000000000000000000000001";
    walletState.isConnected = true;
    writeContractAsync.mockResolvedValue("0xabc");
    waitForTransactionReceipt.mockResolvedValue({ status: "success" });
    apiPost.mockImplementation(async (path: string) => {
      if (path === "/payments/prepare") {
        return { intent: { id: "payment-1" }, order: { id: "order-1" } };
      }
      if (path === "/payments/payment-1/quote") {
        const amount = { currency: "USDC", amount_minor: 10_000_000, decimals: 6 };
        return {
          quote_confirmation: {
            rail: "x402",
            amount,
            buyer_total: amount,
            seller_receives: amount,
            amount_confirmation: {
              order_amount: amount,
              buyer_pays: amount,
              settlement_amount: amount,
              seller_receives: amount,
              buyer_fee: { currency: "USDC", amount_minor: 0, decimals: 6 },
              seller_fee: { currency: "USDC", amount_minor: 0, decimals: 6 },
            },
            fees: {
              buyer_fee_total: { currency: "USDC", amount_minor: 0 },
              seller_fee_total: { currency: "USDC", amount_minor: 0 },
              items: [],
            },
          },
        };
      }
      if (path === "/payments/payment-1/x402/conditional-settlement-request") {
        return {
          mode: "buyer_contract_call",
          contract: {
            address: "0x47228b3B82E3baEF46722aC9475eBfd49Da22a7B",
            network: "base-sepolia",
            asset: "USDC",
            asset_address: "0x579807433033757E895437EEfa9Ae25F387c3fCa",
          },
          contract_call: {
            function_name: "createAndFund",
            params: {
              orderId: `0x${"01".repeat(32)}`,
              paymentIntentId: `0x${"02".repeat(32)}`,
              approvalPolicyHash: `0x${"03".repeat(32)}`,
              agreementHash: `0x${"04".repeat(32)}`,
              listingHash: `0x${"05".repeat(32)}`,
              grantNonce: `0x${"06".repeat(32)}`,
              buyer: walletState.address,
              seller: "0x0000000000000000000000000000000000000002",
              asset: "0x579807433033757E895437EEfa9Ae25F387c3fCa",
              grossAmount: "10000000",
              expiresAt: "9999999999",
              signerNonce: "1",
            },
            signature: "0x1234",
          },
        };
      }
      throw new Error(`Unexpected API request: ${path}`);
    });

    const user = userEvent.setup();
    render(<PaymentStep {...props} />);

    await user.click(screen.getByText("Integration test").closest("button")!);
    await user.click(screen.getByText(/Direct/).closest("button")!);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Get hUSDC Quote" }));
    await user.click(await screen.findByRole("button", { name: "Approve hUSDC" }));

    expect(
      await screen.findByRole("button", { name: "Deposit 10.00 USDC securely" }),
    ).toBeInTheDocument();
    expect(writeContractAsync).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Back to approval" }));
    expect(screen.getByRole("button", { name: "Continue to secure deposit" })).toBeInTheDocument();
    expect(screen.getByText("hUSDC approved")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continue to secure deposit" }));
    expect(screen.getByRole("button", { name: "Deposit 10.00 USDC securely" })).toBeInTheDocument();
    expect(writeContractAsync).toHaveBeenCalledTimes(1);
  });
});

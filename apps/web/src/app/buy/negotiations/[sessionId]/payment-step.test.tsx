import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentStep } from "./payment-step";

const walletState = vi.hoisted(() => ({
  address: undefined as `0x${string}` | undefined,
  isConnected: false,
}));

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
  usePublicClient: () => null,
  useSwitchChain: () => ({ switchChain: vi.fn(), isPending: false }),
  useWriteContract: () => ({ writeContractAsync: vi.fn(), isPending: false }),
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
});

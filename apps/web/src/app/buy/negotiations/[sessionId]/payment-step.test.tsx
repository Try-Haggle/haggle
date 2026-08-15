import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentStep } from "./payment-step";

const walletState = vi.hoisted(() => ({
  address: undefined as `0x${string}` | undefined,
  isConnected: false,
  chainId: 84532,
}));
const sendCallsSyncAsync = vi.hoisted(() => vi.fn());
const switchChain = vi.hoisted(() => vi.fn());
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
  useChainId: () => walletState.chainId,
  useSendCallsSync: () => ({ sendCallsSyncAsync, isPending: false }),
  useSwitchChain: () => ({ switchChain, isPending: false }),
}));

vi.mock("@/lib/api-client", () => ({
  api: { post: apiPost },
}));

vi.mock("@/lib/conditional-settlement-confirmation", () => ({
  confirmConditionalSettlementFunding: vi.fn().mockResolvedValue({
    conditional_settlement: { status: "FUNDING_CONFIRMED" },
  }),
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

const WALLET_A = "0x0000000000000000000000000000000000000001" as const;
const WALLET_B = "0x0000000000000000000000000000000000000003" as const;

function confirmedQuote() {
  const amount = { currency: "USDC", amount_minor: 10_000_000, decimals: 6 };
  return {
    rail: "x402" as const,
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
  };
}

function settlementRequest(buyer: `0x${string}`) {
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
        buyer,
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

function mockHappyPathApi() {
  apiPost.mockImplementation(async (requestPath: string, body?: Record<string, unknown>) => {
    if (requestPath === "/payments/prepare") {
      return { intent: { id: "payment-1" }, order: { id: "order-1" } };
    }
    if (requestPath === "/payments/payment-1/quote") {
      return { quote_confirmation: confirmedQuote() };
    }
    if (requestPath === "/payments/payment-1/x402/conditional-settlement-request") {
      return settlementRequest(body?.buyer_wallet_address as `0x${string}`);
    }
    if (requestPath === "/payments/payment-1/x402/conditional-settlement-funding") {
      return { conditional_settlement: { status: "FUNDING_SUBMITTED" } };
    }
    throw new Error(`Unexpected API request: ${requestPath}`);
  });
}

async function reachQuoteStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText("Integration test").closest("button")!);
  await user.click(screen.getByText(/Direct/).closest("button")!);
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.click(await screen.findByRole("button", { name: "Get hUSDC Quote" }));
  return screen.findByRole("button", { name: "Pay 10.00 USDC securely" });
}

describe("PaymentStep navigation and wallet reuse", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    walletState.address = undefined;
    walletState.isConnected = false;
    walletState.chainId = 84532;
    sendCallsSyncAsync.mockReset();
    switchChain.mockReset();
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
    walletState.address = WALLET_A;
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

  it("blocks the wrong network and offers the exact Base Sepolia switch", async () => {
    walletState.address = WALLET_A;
    walletState.isConnected = true;
    walletState.chainId = 1;
    const user = userEvent.setup();
    render(<PaymentStep {...props} />);

    await user.click(screen.getByText("Integration test").closest("button")!);
    await user.click(screen.getByText(/Direct/).closest("button")!);

    expect(screen.getByText("Switch to Base Sepolia")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Switch network" }));
    expect(switchChain).toHaveBeenCalledWith({ chainId: 84532 });
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("returns a prepared payment to wallet connection after disconnect and resumes it", async () => {
    walletState.address = WALLET_A;
    walletState.isConnected = true;
    apiPost.mockResolvedValueOnce({ intent: { id: "payment-1" }, order: { id: "order-1" } });
    const user = userEvent.setup();
    const view = render(<PaymentStep {...props} />);

    await user.click(screen.getByText("Integration test").closest("button")!);
    await user.click(screen.getByText(/Direct/).closest("button")!);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("button", { name: "Get hUSDC Quote" })).toBeInTheDocument();

    walletState.address = undefined;
    walletState.isConnected = false;
    view.rerender(<PaymentStep {...props} />);
    expect(await screen.findByRole("button", { name: "Connect Wallet" })).toBeInTheDocument();

    walletState.address = WALLET_B;
    walletState.isConnected = true;
    view.rerender(<PaymentStep {...props} />);
    expect(await screen.findByText("Wallet connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue prepared payment" })).toBeInTheDocument();
    expect(apiPost).toHaveBeenCalledTimes(1);
  });

  it("returns a prepared payment to the network guard before requesting a quote", async () => {
    walletState.address = WALLET_A;
    walletState.isConnected = true;
    apiPost.mockResolvedValueOnce({ intent: { id: "payment-1" }, order: { id: "order-1" } });
    const user = userEvent.setup();
    const view = render(<PaymentStep {...props} />);

    await user.click(screen.getByText("Integration test").closest("button")!);
    await user.click(screen.getByText(/Direct/).closest("button")!);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("button", { name: "Get hUSDC Quote" })).toBeInTheDocument();

    walletState.chainId = 1;
    view.rerender(<PaymentStep {...props} />);
    expect(await screen.findByText("Switch to Base Sepolia")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Get hUSDC Quote" })).not.toBeInTheDocument();
    expect(apiPost).toHaveBeenCalledTimes(1);
  });

  it("does not silently replace the buyer's physical shipping choice after a mode conflict", async () => {
    walletState.address = WALLET_A;
    walletState.isConnected = true;
    apiPost.mockRejectedValueOnce(
      Object.assign(new Error("Shipping execution mode cannot change after payment preparation"), {
        code: "PAYMENT_SHIPPING_EXECUTION_MODE_CONFLICT",
      }),
    );

    const user = userEvent.setup();
    render(<PaymentStep {...props} />);

    await user.click(screen.getByText("Physical shipping rehearsal").closest("button")!);
    await user.click(screen.getByText(/Direct/).closest("button")!);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByText("Shipping execution mode cannot change after payment preparation"),
    ).toBeInTheDocument();
    expect(apiPost).toHaveBeenCalledOnce();
    expect(apiPost).toHaveBeenCalledWith(
      "/payments/prepare",
      expect.objectContaining({ shipping_execution_mode: "physical_live" }),
    );
  });

  it("discards a signed request when the buyer changes wallets and re-quotes for the new wallet", async () => {
    walletState.address = WALLET_A;
    walletState.isConnected = true;
    mockHappyPathApi();
    const user = userEvent.setup();
    const view = render(<PaymentStep {...props} />);

    await reachQuoteStep(user);
    expect(screen.getByRole("button", { name: "Pay 10.00 USDC securely" })).toBeInTheDocument();

    walletState.address = WALLET_B;
    view.rerender(<PaymentStep {...props} />);
    expect(await screen.findByText("Wallet connected")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Pay 10.00 USDC securely" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continue prepared payment" }));
    await user.click(await screen.findByRole("button", { name: "Get hUSDC Quote" }));
    expect(
      await screen.findByRole("button", { name: "Pay 10.00 USDC securely" }),
    ).toBeInTheDocument();

    const requestCalls = apiPost.mock.calls.filter(
      ([requestPath]) => requestPath === "/payments/payment-1/x402/conditional-settlement-request",
    );
    expect(requestCalls).toHaveLength(2);
    expect(requestCalls[0]?.[1]).toEqual({ buyer_wallet_address: WALLET_A });
    expect(requestCalls[1]?.[1]).toEqual({ buyer_wallet_address: WALLET_B });
    expect(sendCallsSyncAsync).not.toHaveBeenCalled();
  });

  it("keeps the prepared intent after a rejected signature and succeeds on retry", async () => {
    walletState.address = WALLET_A;
    walletState.isConnected = true;
    sendCallsSyncAsync
      .mockRejectedValueOnce(new Error("User rejected the request"))
      .mockResolvedValueOnce({
        status: "success",
        atomic: true,
        receipts: [{ transactionHash: "0xretry" }],
      });
    mockHappyPathApi();
    const user = userEvent.setup();
    render(<PaymentStep {...props} />);

    await reachQuoteStep(user);
    await user.click(screen.getByRole("button", { name: "Pay 10.00 USDC securely" }));
    expect(await screen.findByText("User rejected the request")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try Again" }));
    await user.click(await screen.findByRole("button", { name: "Get hUSDC Quote" }));
    await user.click(await screen.findByRole("button", { name: "Pay 10.00 USDC securely" }));
    expect(await screen.findByText("Funding confirmed")).toBeInTheDocument();

    expect(
      apiPost.mock.calls.filter(([requestPath]) => requestPath === "/payments/prepare"),
    ).toHaveLength(1);
    expect(sendCallsSyncAsync).toHaveBeenCalledTimes(2);
    expect(
      apiPost.mock.calls.filter(
        ([requestPath]) =>
          requestPath === "/payments/payment-1/x402/conditional-settlement-funding",
      ),
    ).toHaveLength(1);
  });

  it("shows an actionable error and never submits funding for a non-atomic wallet", async () => {
    walletState.address = WALLET_A;
    walletState.isConnected = true;
    sendCallsSyncAsync.mockResolvedValue({ status: "success", atomic: false, receipts: [] });
    mockHappyPathApi();
    const user = userEvent.setup();
    render(<PaymentStep {...props} />);

    await reachQuoteStep(user);
    await user.click(screen.getByRole("button", { name: "Pay 10.00 USDC securely" }));

    expect(
      await screen.findByText(
        "This wallet cannot combine approval and payment into one confirmation. Use a wallet with atomic batch support.",
      ),
    ).toBeInTheDocument();
    expect(
      apiPost.mock.calls.filter(
        ([requestPath]) =>
          requestPath === "/payments/payment-1/x402/conditional-settlement-funding",
      ),
    ).toHaveLength(0);
  });

  it("prevents a second funding submission while the first wallet request is pending", async () => {
    walletState.address = WALLET_A;
    walletState.isConnected = true;
    let resolveWalletRequest!: (result: {
      status: string;
      atomic: boolean;
      receipts: Array<{ transactionHash: string }>;
    }) => void;
    sendCallsSyncAsync.mockReturnValue(
      new Promise((resolve) => {
        resolveWalletRequest = resolve;
      }),
    );
    mockHappyPathApi();
    const user = userEvent.setup();
    render(<PaymentStep {...props} />);

    await reachQuoteStep(user);
    const payButton = screen.getByRole("button", { name: "Pay 10.00 USDC securely" });
    await user.dblClick(payButton);
    expect(sendCallsSyncAsync).toHaveBeenCalledTimes(1);

    resolveWalletRequest({
      status: "success",
      atomic: true,
      receipts: [{ transactionHash: "0xsingle" }],
    });
    expect(await screen.findByText("Funding confirmed")).toBeInTheDocument();
    expect(
      apiPost.mock.calls.filter(
        ([requestPath]) =>
          requestPath === "/payments/payment-1/x402/conditional-settlement-funding",
      ),
    ).toHaveLength(1);
  });

  it("approves and deposits with one atomic wallet confirmation", async () => {
    walletState.address = WALLET_A;
    walletState.isConnected = true;
    sendCallsSyncAsync.mockResolvedValue({
      status: "success",
      atomic: true,
      receipts: [{ transactionHash: "0xabc" }],
    });
    mockHappyPathApi();

    const user = userEvent.setup();
    render(<PaymentStep {...props} />);

    await reachQuoteStep(user);
    expect(
      await screen.findByRole("button", {
        name: "Pay 10.00 USDC securely",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Confirm once in your wallet/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back to quote" }));
    expect(screen.getByRole("button", { name: "Get hUSDC Quote" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Get hUSDC Quote" }));
    await user.click(await screen.findByRole("button", { name: "Pay 10.00 USDC securely" }));

    expect(sendCallsSyncAsync).toHaveBeenCalledTimes(1);
    expect(sendCallsSyncAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        forceAtomic: true,
        calls: [
          expect.objectContaining({ functionName: "approve" }),
          expect.objectContaining({ functionName: "createAndFund" }),
        ],
      }),
    );
    expect(await screen.findByText("Funding confirmed")).toBeInTheDocument();
  });
});

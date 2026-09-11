import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const patch = vi.fn();

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    status: number;
    code: string;
    details?: Record<string, unknown>;
    constructor(status: number, code: string, message?: string, details?: Record<string, unknown>) {
      super(message || code);
      this.status = status;
      this.code = code;
      this.details = details;
    }
  }
  return {
    ApiError,
    api: {
      patch: (...args: unknown[]) => patch(...args),
      get: vi.fn().mockRejectedValue(new ApiError(404, "NOT_FOUND")),
    },
  };
});

vi.mock("@/hooks/use-credit-balance", () => ({
  useCreditBalance: () => ({
    source: "stub",
    balance: null,
    unlimited: false,
    accountId: null,
    reason: "CREDIT_BALANCE_API_UNAVAILABLE",
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}));

import { ControlModePanel } from "./control-mode-panel";

describe("ControlModePanel", () => {
  beforeEach(() => {
    patch.mockReset();
  });

  it("renders CU-ready own + peer labels from server values only", () => {
    render(
      <ControlModePanel
        sessionId="s1"
        party="buyer"
        localInflight={false}
        serverSession={{
          buyer_control_mode: "auto",
          seller_control_mode: "manual",
        }}
      />,
    );

    expect(screen.getByTestId("control-mode-own")).toHaveTextContent("You: Auto");
    const peer = screen.getByTestId("control-mode-peer");
    expect(peer).toHaveTextContent("Counterpart: Manual");
    expect(peer).toHaveAttribute("data-source", "server");
  });

  it("queues mid-session toggle while Soft API is in-flight (SoT §3 handoff)", async () => {
    const user = userEvent.setup();
    render(
      <ControlModePanel
        sessionId="s1"
        party="buyer"
        localInflight={true}
        serverSession={{
          buyer_control_mode: "auto",
          seller_control_mode: "auto",
        }}
      />,
    );

    await user.click(screen.getByRole("switch", { name: /Turn Auto off/i }));

    expect(patch).not.toHaveBeenCalled();
    expect(screen.getByTestId("control-mode-handoff")).toHaveTextContent(
      /Switching to Manual after current turn/i,
    );
  });

  it("PATCHes SoT control_mode when not in-flight", async () => {
    const user = userEvent.setup();
    patch.mockResolvedValue({
      buyer_control_mode: "manual",
      seller_control_mode: "auto",
    });

    render(
      <ControlModePanel
        sessionId="sess-1"
        party="buyer"
        localInflight={false}
        serverSession={{
          buyer_control_mode: "auto",
          seller_control_mode: "auto",
        }}
      />,
    );

    await user.click(screen.getByRole("switch", { name: /Turn Auto off/i }));

    expect(patch).toHaveBeenCalledWith("/negotiations/sessions/sess-1/control-mode", {
      control_mode: "manual",
    });
  });
});

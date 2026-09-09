import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DogfoodLoginClient } from "./dogfood-login-client";

const replace = vi.fn();
const refresh = vi.fn();
const setSession = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { setSession },
  }),
}));

describe("DogfoodLoginClient", () => {
  beforeEach(() => {
    replace.mockReset();
    refresh.mockReset();
    setSession.mockReset();
    setSession.mockResolvedValue({ error: null });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            ok: false,
            error: "T1_API_NOT_LIVE",
            message: "T1 API not live — dogfood session mint is not available yet.",
          },
          { status: 503 },
        ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows T1 stub message and never calls setSession", async () => {
    const user = userEvent.setup();
    render(<DogfoodLoginClient />);

    await user.click(screen.getByTestId("dogfood-persona-buyer"));
    await user.click(screen.getByTestId("dogfood-login-enter"));

    await waitFor(() => {
      expect(screen.getByTestId("dogfood-login-error")).toHaveTextContent(/T1 API not live/i);
    });
    expect(setSession).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});

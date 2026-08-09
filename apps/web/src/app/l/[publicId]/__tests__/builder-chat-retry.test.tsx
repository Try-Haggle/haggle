/**
 * A failed builder turn must be recoverable in place.
 *
 * Reported from e2e: mid-conversation the turn 502'd ("The negotiation advisor could not
 * complete its response"), the failure arrived as an agent chat bubble, and the only way
 * forward was to retype the message that had just been sent. The builder turn is
 * stateless — the whole conversation is posted each time — so a retry recovers fully.
 */

import { NEGOTIATION_AGENT_PRESETS } from "@haggle/shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";

const mocks = vi.hoisted(() => ({ apiClient: vi.fn() }));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...original, apiClient: mocks.apiClient };
});

import { NegotiationAgentBuilderChat } from "../negotiation-agent-builder-chat";

/**
 * A taxonomy-matched listing on purpose: a seller listing with NO quick-setup pills
 * auto-fires an opening LLM turn on mount, which would consume the mocked responses
 * and make the call counts below meaningless. Here the pills exist, so the only API
 * calls are the ones these tests make.
 */
// Passed via a const: biome's `useValidAriaRole` reads a literal `role="seller"` as an
// ARIA role even though it is this component's own prop.
const SELLER: "seller" = "seller";

function renderChat() {
  return render(
    <NegotiationAgentBuilderChat
      agent={NEGOTIATION_AGENT_PRESETS[0]!}
      listingPublicId="listing-retry-test"
      listingTitle="iPhone 15 Pro 256GB"
      listingCategory="electronics"
      listingPrice="900"
      listingFloorPrice="800"
      listingTags={["iphone"]}
      role={SELLER}
    />,
  );
}

async function sendMessage(text: string) {
  const input = await screen.findByPlaceholderText(/emphasize/i);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
}

beforeEach(() => {
  mocks.apiClient.mockReset();
  window.localStorage.clear();
});

describe("builder chat — failed turn recovery", () => {
  it("offers a retry on the failed turn instead of losing the message", async () => {
    mocks.apiClient.mockRejectedValueOnce(
      new ApiError(
        502,
        "CHAT_TURN_FAILED",
        "The negotiation advisor could not complete its response.",
      ),
    );
    renderChat();
    await sendMessage("lens are clear");

    expect(
      await screen.findByText("The negotiation advisor could not complete its response."),
    ).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
    // The user's own message must still be in the transcript — that is what makes a
    // retry possible without retyping.
    expect(screen.getByText("lens are clear")).toBeInTheDocument();
  });

  it("re-sends the same message and clears the error on success", async () => {
    mocks.apiClient
      .mockRejectedValueOnce(new ApiError(502, "CHAT_TURN_FAILED", "Advisor failed."))
      .mockResolvedValueOnce({ reply: "Got it — clear glass is worth leading with." });
    renderChat();
    await sendMessage("lens are clear");

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(
      await screen.findByText("Got it — clear glass is worth leading with."),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Advisor failed.")).not.toBeInTheDocument());
    // Exactly one user bubble — the retry must not duplicate it.
    expect(screen.getAllByText("lens are clear")).toHaveLength(1);

    const retried = mocks.apiClient.mock.calls.at(-1);
    expect(JSON.parse(String(retried?.[1]?.body)).message).toBe("lens are clear");
  });

  it("does not stack error bubbles when the retry fails too", async () => {
    mocks.apiClient
      .mockRejectedValueOnce(new ApiError(502, "CHAT_TURN_FAILED", "Advisor failed."))
      .mockRejectedValueOnce(new ApiError(502, "CHAT_TURN_FAILED", "Advisor failed."));
    renderChat();
    await sendMessage("lens are clear");

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    await waitFor(() => expect(mocks.apiClient).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByText("Advisor failed.")).toHaveLength(1));
  });
});

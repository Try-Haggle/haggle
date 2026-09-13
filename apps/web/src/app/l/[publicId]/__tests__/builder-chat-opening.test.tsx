/**
 * How a builder conversation opens, on every surface.
 *
 * A new conversation opens with a fixed greeting, instantly — no model call. A
 * seller on a listing whose category had no quick-setup questions used to wait
 * ~78s on an LLM-written opener behind a typing indicator. A saved agent's
 * conversation opens where it left off, restored from its database thread.
 */

import { NEGOTIATION_AGENT_PRESETS } from "@haggle/shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiClient: vi.fn(),
  fetchBuilderThread: vi.fn(),
  saveBuilderThread: vi.fn(),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...original, apiClient: mocks.apiClient };
});
vi.mock("@/lib/negotiation-agents-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/negotiation-agents-api")>();
  return {
    ...original,
    fetchBuilderThread: mocks.fetchBuilderThread,
    saveBuilderThread: mocks.saveBuilderThread,
  };
});

import { NegotiationAgentBuilderChat } from "../negotiation-agent-builder-chat";

// Passed via a const: biome's `useValidAriaRole` reads a literal role as ARIA.
const SELLER: "seller" = "seller";

beforeEach(() => {
  mocks.apiClient.mockReset();
  mocks.fetchBuilderThread.mockReset().mockResolvedValue(null);
  mocks.saveBuilderThread.mockReset().mockResolvedValue(undefined);
  window.localStorage.clear();
});

describe("builder chat opening", () => {
  it("greets a seller on a listing with no quick-setup questions at once, without calling the model", async () => {
    render(
      <NegotiationAgentBuilderChat
        agent={NEGOTIATION_AGENT_PRESETS[0]!}
        listingPublicId="agent-studio:seller:preset:hunter:v1"
        listingTitle="iPhone 15 case leather"
        listingCategory="other"
        listingPrice="40"
        listingFloorPrice="30"
        listingTags={[]}
        role={SELLER}
      />,
    );

    expect(await screen.findByText(/to sell/)).toBeInTheDocument();
    // Give any effect a chance to fire before asserting nothing did.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.apiClient).not.toHaveBeenCalled();
  });

  it("opens a saved agent's conversation where it left off", async () => {
    mocks.fetchBuilderThread.mockResolvedValue({
      key: "agent-studio:seller:saved:agent-1",
      messages: [
        { id: "m1", role: "agent", text: "What should I emphasize?", timestamp: 1 },
        { id: "m2", role: "user", text: "It has no scratches at all", timestamp: 2 },
        { id: "m3", role: "agent", text: "Noted — condition leads.", timestamp: 3 },
      ],
    });
    render(
      <NegotiationAgentBuilderChat
        agent={NEGOTIATION_AGENT_PRESETS[2]!}
        serverThreadKey="agent-studio:seller:saved:agent-1"
        listingPublicId="agent-studio:seller:saved:agent-1"
        listingTitle="brass telescope"
        listingCategory="other"
        listingPrice="120"
        role={SELLER}
      />,
    );

    expect(await screen.findByText("It has no scratches at all")).toBeInTheDocument();
    expect(mocks.fetchBuilderThread).toHaveBeenCalledWith("agent-studio:seller:saved:agent-1");
  });

  it("never reads or writes the database for a preset's conversation", async () => {
    render(
      <NegotiationAgentBuilderChat
        agent={NEGOTIATION_AGENT_PRESETS[0]!}
        listingPublicId="agent-studio:seller:preset:hunter:v1"
        listingTitle="lamp"
        listingCategory="other"
        listingPrice="20"
        role={SELLER}
      />,
    );
    await screen.findByText(/to sell/);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(mocks.fetchBuilderThread).not.toHaveBeenCalled();
    expect(mocks.saveBuilderThread).not.toHaveBeenCalled();
  });
});

describe("builder chat — which listing the advisor is told about", () => {
  it("names the listing, not the conversation key, so learned questions count distinct listings", async () => {
    mocks.apiClient.mockResolvedValue({ reply: "Got it.", memory: undefined });
    render(
      <NegotiationAgentBuilderChat
        agent={NEGOTIATION_AGENT_PRESETS[0]!}
        listingPublicId="agent-studio:seller:preset:hunter:visit-1"
        advisorListingId="listing-draft-42"
        listingTitle="brass telescope"
        listingCategory="other"
        listingPrice="120"
        role={SELLER}
      />,
    );
    const input = await screen.findByPlaceholderText(/emphasize/i);
    fireEvent.change(input, { target: { value: "It has original caps" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(mocks.apiClient).toHaveBeenCalled());
    const body = JSON.parse(mocks.apiClient.mock.calls[0][1].body as string);
    expect(body.listings[0].id).toBe("listing-draft-42");
  });
});

describe("builder chat — memory follows the conversation", () => {
  it("tells the surface a new conversation's memory, so a switched agent does not inherit the last one's", async () => {
    const onMemory = vi.fn();
    render(
      <NegotiationAgentBuilderChat
        agent={NEGOTIATION_AGENT_PRESETS[1]!}
        listingPublicId="agent-studio:seller:preset:closer:v1"
        listingTitle="lamp"
        listingCategory="other"
        listingPrice="20"
        role={SELLER}
        onNegotiationAgentBuilderMemoryUpdate={onMemory}
      />,
    );
    await waitFor(() => expect(onMemory).toHaveBeenCalled());
    expect(onMemory.mock.calls.at(-1)?.[0].dealBreakers ?? []).toEqual([]);
  });

  it("starts a saved agent's new conversation from what that agent already knows", async () => {
    const onMemory = vi.fn();
    render(
      <NegotiationAgentBuilderChat
        agent={NEGOTIATION_AGENT_PRESETS[2]!}
        serverThreadKey="agent-studio:seller:saved:agent-9"
        listingPublicId="agent-studio:seller:saved:agent-9"
        initialMemory={{
          categoryInterest: "electronics",
          mustHave: [],
          avoid: [],
          riskStyle: "safe_first",
          negotiationStyle: "balanced",
          openingTactic: "condition_anchor",
          questions: [],
          source: [],
          dealBreakers: ["no trades"],
        }}
        listingTitle="lamp"
        listingCategory="other"
        listingPrice="20"
        role={SELLER}
        onNegotiationAgentBuilderMemoryUpdate={onMemory}
      />,
    );
    await waitFor(() =>
      expect(onMemory.mock.calls.some(([m]) => m.dealBreakers?.includes("no trades"))).toBe(true),
    );
  });

  it("restores what a saved conversation established along with its transcript", async () => {
    mocks.fetchBuilderThread.mockResolvedValue({
      key: "agent-studio:seller:saved:agent-1",
      messages: [
        { id: "m1", role: "agent", text: "Anything you won't accept?", timestamp: 1 },
        { id: "m2", role: "user", text: "No trades", timestamp: 2 },
      ],
      memory: { dealBreakers: ["no trades"] },
    });
    const onMemory = vi.fn();
    render(
      <NegotiationAgentBuilderChat
        agent={NEGOTIATION_AGENT_PRESETS[2]!}
        serverThreadKey="agent-studio:seller:saved:agent-1"
        listingPublicId="agent-studio:seller:saved:agent-1"
        listingTitle="lamp"
        listingCategory="other"
        listingPrice="20"
        role={SELLER}
        onNegotiationAgentBuilderMemoryUpdate={onMemory}
      />,
    );
    expect(await screen.findByText("No trades")).toBeInTheDocument();
    await waitFor(() =>
      expect(onMemory.mock.calls.at(-1)?.[0].dealBreakers).toEqual(["no trades"]),
    );
  });

  it("writes the memory to the database with the messages", async () => {
    render(
      <NegotiationAgentBuilderChat
        agent={NEGOTIATION_AGENT_PRESETS[2]!}
        serverThreadKey="agent-studio:seller:saved:agent-2"
        listingPublicId="agent-studio:seller:saved:agent-2"
        listingTitle="lamp"
        listingCategory="other"
        listingPrice="20"
        role={SELLER}
      />,
    );
    await waitFor(() => expect(mocks.saveBuilderThread).toHaveBeenCalled(), { timeout: 2000 });
    const written = mocks.saveBuilderThread.mock.calls.at(-1)?.[0];
    expect(written.key).toBe("agent-studio:seller:saved:agent-2");
    expect(written.memory).toMatchObject({ categoryInterest: "other" });
  });
});

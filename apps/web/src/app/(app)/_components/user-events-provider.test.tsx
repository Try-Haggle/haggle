/**
 * The user socket, and how much it costs.
 *
 * Every (re)connect spends a ticket request and, through connectionEpoch, makes
 * each consumer refetch. Both are cheap once and expensive in a loop — which is
 * how a rate-limited page turned into a request storm that kept itself rate
 * limited.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserEventsProvider, useUserEvents } from "./user-events-provider";

const getSession = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession } }),
}));

class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  closed = false;

  constructor() {
    FakeSocket.instances.push(this);
  }

  close() {
    this.closed = true;
    this.onclose?.();
  }
}

function Probe() {
  const { connectionEpoch, connected } = useUserEvents();
  return (
    <div>
      <span data-testid="epoch">{connectionEpoch}</span>
      <span data-testid="connected">{String(connected)}</span>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  FakeSocket.instances = [];
  getSession.mockResolvedValue({ data: { session: { access_token: "token" } } });
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers(),
      json: async () => ({ ticket_protocol: "haggle-ticket.abc" }),
    }),
  );
});

describe("UserEventsProvider", () => {
  it("spends one ticket request for one connection", async () => {
    render(
      <UserEventsProvider>
        <Probe />
      </UserEventsProvider>,
    );

    await waitFor(() => expect(FakeSocket.instances.length).toBe(1));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not bump the refetch epoch on the first connect", async () => {
    render(
      <UserEventsProvider>
        <Probe />
      </UserEventsProvider>,
    );

    await waitFor(() => expect(FakeSocket.instances.length).toBe(1));
    act(() => FakeSocket.instances[0].onopen?.());

    // Consumers already fetched on mount; a bump here would double every one.
    await waitFor(() => expect(screen.getByTestId("connected")).toHaveTextContent("true"));
    expect(screen.getByTestId("epoch")).toHaveTextContent("0");
  });

  it("bumps the epoch when the socket comes back, so consumers fill the gap", async () => {
    render(
      <UserEventsProvider>
        <Probe />
      </UserEventsProvider>,
    );

    await waitFor(() => expect(FakeSocket.instances.length).toBe(1));
    act(() => FakeSocket.instances[0].onopen?.());
    await waitFor(() => expect(screen.getByTestId("connected")).toHaveTextContent("true"));

    // Simulate the reconnect that follows a drop.
    act(() => FakeSocket.instances[0].onopen?.());
    await waitFor(() => expect(screen.getByTestId("epoch")).toHaveTextContent("1"));
  });

  it("waits out a rate-limited ticket instead of retrying into it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({ "Retry-After": "30" }),
        json: async () => ({}),
      }),
    );

    render(
      <UserEventsProvider>
        <Probe />
      </UserEventsProvider>,
    );

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    // No socket, and no immediate second attempt piling onto the limit.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(FakeSocket.instances.length).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

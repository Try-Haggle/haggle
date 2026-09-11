import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  getUser: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: mocks.getUser },
  }),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...original, api: { get: mocks.get, post: mocks.post } };
});

import ConnectPage from "./page";

describe("Connect consent screen", () => {
  beforeEach(() => {
    mocks.searchParams = new URLSearchParams({
      client_id: "mcp_1",
      redirect_uri: "https://grok.x.ai/cb",
      code_challenge: "a".repeat(43),
      scope: "listings",
    });
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mocks.get.mockResolvedValue({
      client_id: "mcp_1",
      client_name: "Grok Bot",
      redirect_uris: ["https://grok.x.ai/cb"],
    });
    mocks.post.mockReset();
  });

  it("shows the registered client name and only requested scopes", async () => {
    render(<ConnectPage />);
    expect(await screen.findByText("Grok Bot")).toBeInTheDocument();
    expect(screen.getByText("Create and publish listings as you")).toBeInTheDocument();
    expect(screen.queryByText("Start and play negotiations as you")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allow access" })).toBeEnabled();
  });

  it("blocks allow when the redirect is not registered", async () => {
    mocks.get.mockResolvedValue({
      client_id: "mcp_1",
      client_name: "Grok Bot",
      redirect_uris: ["https://grok.x.ai/other"],
    });
    render(<ConnectPage />);
    await waitFor(() => {
      expect(
        screen.getByText("This redirect URL is not registered for the client."),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Allow access" })).toBeDisabled();
  });
});

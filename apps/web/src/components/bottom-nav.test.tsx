/**
 * Bottom nav visibility.
 *
 * The bar is fixed, so anywhere it should not appear it would sit on top of the
 * screen's own controls. An open conversation is exactly that case: the
 * composer lives where the bar would be.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BottomNav } from "./bottom-nav";

let pathname = "/messages";
let query = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => query,
}));

vi.mock("@/app/(app)/_components/notification-provider", () => ({
  useNotificationContext: () => ({ unreadCount: 0 }),
}));

beforeEach(() => {
  pathname = "/messages";
  query = new URLSearchParams();
});

describe("BottomNav", () => {
  it("shows on the conversation list", () => {
    render(<BottomNav />);

    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });

  it("steps aside while a conversation is open", () => {
    query = new URLSearchParams("c=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    render(<BottomNav />);

    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("still shows on other screens that carry a query string", () => {
    pathname = "/browse";
    query = new URLSearchParams("c=something");
    render(<BottomNav />);

    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });

  it("stays hidden in the listing wizard", () => {
    pathname = "/sell/listings/new";
    render(<BottomNav />);

    expect(screen.queryByRole("navigation")).toBeNull();
  });
});

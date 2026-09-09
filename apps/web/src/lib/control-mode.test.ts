import { afterEach, describe, expect, it } from "vitest";
import {
  counterpartModeLabel,
  DEFAULT_CONTROL_MODE,
  DEFAULT_CONTROL_MODE_PREF_KEY,
  isControlMode,
  modesFromServerSession,
  ownModeLabel,
  parseControlMode,
  readDefaultControlModePreference,
  withDefaultControlModePreference,
  writeDefaultControlModePreference,
} from "./control-mode";

describe("control-mode SoT helpers", () => {
  afterEach(() => {
    window.localStorage.clear();
    // biome-ignore lint/suspicious/noDocumentCookie: test cleanup of preference cookie
    document.cookie = `${DEFAULT_CONTROL_MODE_PREF_KEY}=; Path=/; Max-Age=0`;
  });

  it("parses only auto|manual and defaults to Auto (SoT §2)", () => {
    expect(parseControlMode("auto")).toBe("auto");
    expect(parseControlMode("manual")).toBe("manual");
    expect(parseControlMode(undefined)).toBe(DEFAULT_CONTROL_MODE);
    expect(parseControlMode("AUTO")).toBe("auto"); // invalid → default
    expect(isControlMode("AUTO")).toBe(false);
  });

  it("exposes CU-ready own + counterpart labels (SoT §6)", () => {
    expect(ownModeLabel("auto")).toBe("You: Auto");
    expect(counterpartModeLabel("manual")).toBe("Counterpart: Manual");
  });

  it("derives peer mode from server fields only (anti-spoof)", () => {
    const buyerView = modesFromServerSession(
      {
        buyer_control_mode: "manual",
        seller_control_mode: "auto",
        soft_ai_inflight_party: "buyer",
        buyer_pending_control_mode: "auto",
      },
      "buyer",
    );
    expect(buyerView.own).toBe("manual");
    expect(buyerView.peer).toBe("auto");
    expect(buyerView.inflight).toBe(true);
    expect(buyerView.ownPending).toBe("auto");

    // Missing peer field → SoT default Auto, never a client-invented value
    const sparse = modesFromServerSession({ buyer_control_mode: "manual" }, "buyer");
    expect(sparse.peer).toBe("auto");
  });

  it("persists Settings default preference for future sessions", () => {
    expect(readDefaultControlModePreference()).toBe("auto");
    expect(writeDefaultControlModePreference("manual")).toBe(true);
    expect(window.localStorage.getItem(DEFAULT_CONTROL_MODE_PREF_KEY)).toBe("manual");
    expect(readDefaultControlModePreference()).toBe("manual");
    expect(writeDefaultControlModePreference("auto")).toBe(true);
    expect(readDefaultControlModePreference()).toBe("auto");
  });

  it("falls back to cookie when localStorage is empty", () => {
    expect(writeDefaultControlModePreference("manual")).toBe(true);
    window.localStorage.clear();
    expect(readDefaultControlModePreference()).toBe("manual");
  });

  it("applies Settings preference onto start body (explicit wins)", () => {
    writeDefaultControlModePreference("manual");
    expect(withDefaultControlModePreference({ listing_public_id: "pub" })).toEqual({
      listing_public_id: "pub",
      buyer_control_mode: "manual",
    });
    expect(
      withDefaultControlModePreference({
        listing_public_id: "pub",
        buyer_control_mode: "auto",
      }),
    ).toEqual({
      listing_public_id: "pub",
      buyer_control_mode: "auto",
    });
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CONTROL_MODE_PREF_KEY,
  readDefaultControlModePreference,
  writeDefaultControlModePreference,
} from "@/lib/control-mode";
import { ControlModeSettings } from "./control-mode-settings";

describe("ControlModeSettings", () => {
  afterEach(() => {
    window.localStorage.clear();
    // biome-ignore lint/suspicious/noDocumentCookie: test cleanup of preference cookie
    document.cookie = `${DEFAULT_CONTROL_MODE_PREF_KEY}=; Path=/; Max-Age=0`;
  });

  it("defaults to Auto ON and saves Manual preference without a start chooser", async () => {
    const user = userEvent.setup();
    render(<ControlModeSettings />);

    expect(screen.getByTestId("control-mode-settings")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    });

    await user.click(screen.getByRole("switch"));
    expect(readDefaultControlModePreference()).toBe("manual");
    expect(window.localStorage.getItem(DEFAULT_CONTROL_MODE_PREF_KEY)).toBe("manual");
    expect(screen.getByText(/applies to new sessions only/i)).toBeInTheDocument();
  });

  it("restores Manual after remount (next-session Settings re-entry)", async () => {
    writeDefaultControlModePreference("manual");
    expect(readDefaultControlModePreference()).toBe("manual");

    const { unmount } = render(<ControlModeSettings />);
    await waitFor(() => {
      expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    });
    expect(screen.getByText(/Manual \(you drive Soft turns\)/i)).toBeInTheDocument();
    unmount();

    render(<ControlModeSettings />);
    await waitFor(() => {
      expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    });
    expect(readDefaultControlModePreference()).toBe("manual");
    expect(screen.getByText(/Manual \(you drive Soft turns\)/i)).toBeInTheDocument();
  });
});

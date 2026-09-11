import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY } from "@/lib/i18n";
import { LocaleProvider } from "@/providers/locale-provider";
import { LanguageSettings } from "./language-settings";

describe("LanguageSettings", () => {
  afterEach(() => {
    window.localStorage.removeItem(LOCALE_STORAGE_KEY);
    document.documentElement.lang = DEFAULT_LOCALE;
    delete document.documentElement.dataset.locale;
  });

  it("defaults to English and switches the visible settings copy", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <LanguageSettings />
      </LocaleProvider>,
    );

    expect(screen.getByTestId("language-settings")).toHaveTextContent("Language");
    expect(screen.getByLabelText("Display language")).toHaveValue("en");

    await user.selectOptions(screen.getByLabelText("Display language"), "ko");

    expect(screen.getByRole("heading", { name: "언어" })).toBeInTheDocument();
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("ko");
    expect(document.documentElement.lang).toBe("ko");
  });
});

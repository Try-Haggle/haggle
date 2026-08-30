/**
 * Enter, and what a Korean keyboard does to it.
 *
 * The bug this pins: with an IME composing the final syllable, Enter means
 * "confirm", not "send". A handler that only looks at `key` posts the message
 * mid-composition, the IME then commits the held syllable into the emptied box,
 * and the next Enter sends that one character as its own message.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "./composer";

function setup() {
  const onSend = vi.fn();
  render(<Composer onSend={onSend} />);
  return { onSend, input: screen.getByRole("textbox", { name: "Message" }) };
}

describe("Composer", () => {
  it("sends on a plain Enter", async () => {
    const { onSend, input } = setup();

    await userEvent.type(input, "hello");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSend).toHaveBeenCalledWith("hello");
  });

  it("does not send while an IME is composing", async () => {
    const { onSend, input } = setup();

    await userEvent.type(input, "하도록");
    // The Enter that confirms "록" — the browser marks it as composing.
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not send on the legacy composition keycode either", async () => {
    const { onSend, input } = setup();

    await userEvent.type(input, "하도록");
    // Some Safari and Windows IME combinations report only keyCode 229.
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("sends once the composition is confirmed", async () => {
    const { onSend, input } = setup();

    await userEvent.type(input, "하도록");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    // The user presses Enter again, now with nothing in composition.
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("하도록");
  });

  it("leaves nothing behind to be sent as its own message", async () => {
    const { onSend, input } = setup();

    await userEvent.type(input, "되긴할듯");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(input).toHaveValue("");
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalledWith("듯");
  });

  it("starts a new line on Shift+Enter", async () => {
    const { onSend, input } = setup();

    await userEvent.type(input, "one");
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("ignores an empty or whitespace-only send", async () => {
    const { onSend, input } = setup();

    fireEvent.keyDown(input, { key: "Enter" });
    await userEvent.type(input, "   ");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSend).not.toHaveBeenCalled();
  });
});

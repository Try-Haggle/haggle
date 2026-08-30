/**
 * Enter, and what an IME does to it.
 *
 * While an input method is composing — Korean, Japanese, Chinese — Enter means
 * "confirm this syllable", not "send". The browser reports that keydown with
 * `isComposing`, but a handler that only looks at `event.key` sees a plain
 * Enter and acts on it. The symptom is specific and ugly: the message goes out
 * mid-composition, the IME then commits the syllable it was holding into the
 * now-empty box, and the next Enter sends that single character as a message of
 * its own.
 *
 * `keyCode === 229` is the older signal for the same thing; some Safari and
 * Windows IME combinations still report only that.
 */
export function isImeComposing(event: {
  nativeEvent: KeyboardEvent | { isComposing?: boolean; keyCode?: number };
}): boolean {
  const native = event.nativeEvent as { isComposing?: boolean; keyCode?: number };
  return Boolean(native?.isComposing) || native?.keyCode === 229;
}

/**
 * True when this keydown should act as "submit": Enter, no modifier, and not
 * the IME confirming a composition.
 */
export function isSubmitEnter(event: {
  key: string;
  shiftKey?: boolean;
  nativeEvent: KeyboardEvent | { isComposing?: boolean; keyCode?: number };
}): boolean {
  return event.key === "Enter" && !event.shiftKey && !isImeComposing(event);
}

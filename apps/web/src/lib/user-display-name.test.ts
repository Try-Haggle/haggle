import { describe, expect, it } from "vitest";
import { getUserDisplayName } from "./user-display-name";

describe("getUserDisplayName", () => {
  it("prefers the name the person chose over Google's", () => {
    expect(
      getUserDisplayName({ user_metadata: { display_name: "Jay", full_name: "Jongwoo Lim" } }),
    ).toBe("Jay");
  });

  it("falls back to Google's full_name, then name", () => {
    expect(getUserDisplayName({ user_metadata: { full_name: "Jongwoo Lim", name: "J" } })).toBe(
      "Jongwoo Lim",
    );
    expect(getUserDisplayName({ user_metadata: { name: "Jongwoo" } })).toBe("Jongwoo");
  });

  it("skips blank values and returns null when there is no name", () => {
    expect(getUserDisplayName({ user_metadata: { display_name: "  ", name: "Kim" } })).toBe("Kim");
    expect(getUserDisplayName({ user_metadata: {} })).toBeNull();
    expect(getUserDisplayName(null)).toBeNull();
  });
});

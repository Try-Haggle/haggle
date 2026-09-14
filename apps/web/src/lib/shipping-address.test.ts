import { describe, expect, it } from "vitest";
import { formatAddressConfirmPreview } from "./shipping-address";

describe("formatAddressConfirmPreview", () => {
  it("redacts street middle and omits phone / street2", () => {
    const preview = formatAddressConfirmPreview({
      name: "Alex Buyer",
      street1: "1600 Blake Street",
      street2: "Apt 4B",
      city: "Denver",
      state: "CO",
      zip: "80202",
      phone: "303-555-0100",
    });
    expect(preview).toContain("Denver, CO 80202");
    expect(preview).toContain("Alex B.");
    expect(preview).toContain("1600");
    expect(preview).toContain("Street");
    expect(preview).toContain("•••");
    expect(preview).not.toContain("Blake");
    expect(preview).not.toContain("Apt 4B");
    expect(preview).not.toContain("303");
    expect(preview).not.toContain("1600 Blake Street");
  });

  it("still shows city line when name is missing", () => {
    const preview = formatAddressConfirmPreview({
      name: "",
      street1: "12 Main",
      city: "Boulder",
      state: "CO",
      zip: "80301",
    });
    expect(preview).toBe("Boulder, CO 80301 · 12 ••• Main");
  });
});

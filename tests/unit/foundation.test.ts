import { describe, expect, it } from "vitest";

import { getFoundationDescriptor } from "../../src/bootstrap/foundation.js";

describe("clean-room foundation", () => {
  it("is explicitly operational and read-only", () => {
    expect(getFoundationDescriptor()).toEqual({
      product: "Hermes Mission Control",
      state: "OPERATIONAL_READ_ONLY",
      readOnly: true,
    });
  });
});

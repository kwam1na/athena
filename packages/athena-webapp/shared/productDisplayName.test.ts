import { describe, expect, it } from "vitest";

import { formatProductDisplayName } from "./productDisplayName";

describe("formatProductDisplayName", () => {
  it("title-cases shouted source names", () => {
    expect(formatProductDisplayName("EBIN TINT SPRAY BIG")).toBe(
      "Ebin Tint Spray Big",
    );
    expect(formatProductDisplayName("DG WIPES 80PCS")).toBe("Dg Wipes 80pcs");
  });

  it("capitalizes lowercase source names", () => {
    expect(formatProductDisplayName("spiral curls")).toBe("Spiral Curls");
  });

  it("trims and collapses whitespace frozen into the snapshot", () => {
    // Production evidence carries "Packaging net 20pcs " verbatim.
    expect(formatProductDisplayName("Packaging net 20pcs ")).toBe(
      "Packaging Net 20pcs",
    );
    expect(formatProductDisplayName("  Gold   bobby  pins ")).toBe(
      "Gold Bobby Pins",
    );
  });

  it("leaves an already-normalized name unchanged", () => {
    expect(formatProductDisplayName("Ponytail Net")).toBe("Ponytail Net");
  });

  it("returns empty input untouched rather than throwing", () => {
    expect(formatProductDisplayName("")).toBe("");
    expect(formatProductDisplayName("   ")).toBe("");
  });
});

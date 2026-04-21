import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeVendorLookupKey } from "./vendors";

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("stock ops vendors", () => {
  it("normalizes vendor names into a stable store-scoped lookup key", () => {
    expect(normalizeVendorLookupKey("  Crown  & Glory Wigs  ")).toBe(
      "crown-glory-wigs"
    );
  });

  it("guards duplicate vendors with the store lookup index", () => {
    const source = getSource("./vendors.ts");

    expect(source).toContain("export const createVendor = mutation({");
    expect(source).toContain('.withIndex("by_storeId_lookupKey"');
    expect(source).toContain(
      'throw new Error("A vendor with this name already exists for this store.");'
    );
  });
});

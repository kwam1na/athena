import { describe, expect, it } from "vitest";

import { parseVariantAttributeValue } from "./AttributesTable";

describe("AttributesTable variant attribute inputs", () => {
  it("normalizes length input to the numeric shape expected by Convex", () => {
    expect(parseVariantAttributeValue("length", "32")).toBe(32);
    expect(parseVariantAttributeValue("length", " 18.5 ")).toBe(18.5);
  });

  it("keeps blank length input unset", () => {
    expect(parseVariantAttributeValue("length", "")).toBeUndefined();
    expect(parseVariantAttributeValue("length", " ")).toBeUndefined();
  });

  it("keeps text attributes as strings", () => {
    expect(parseVariantAttributeValue("size", "medium")).toBe("medium");
    expect(parseVariantAttributeValue("weight", "light")).toBe("light");
  });
});

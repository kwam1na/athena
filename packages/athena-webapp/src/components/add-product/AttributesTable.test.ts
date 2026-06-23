import { describe, expect, it } from "vitest";

import {
  normalizeSkuAttributeValue,
  parseVariantAttributeValue,
} from "./ProductVariantAttributes";

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

  it("treats legacy NULL placeholders as absent attribute input", () => {
    expect(parseVariantAttributeValue("size", "NULL")).toBeUndefined();
    expect(parseVariantAttributeValue("weight", " null ")).toBeUndefined();
    expect(parseVariantAttributeValue("length", "NULL")).toBeUndefined();
  });

  it("normalizes legacy NULL placeholders from persisted SKU attributes", () => {
    expect(normalizeSkuAttributeValue("NULL")).toBeUndefined();
    expect(normalizeSkuAttributeValue(" null ")).toBeUndefined();
    expect(normalizeSkuAttributeValue("Large")).toBe("Large");
    expect(normalizeSkuAttributeValue(18)).toBe(18);
    expect(normalizeSkuAttributeValue(undefined)).toBeUndefined();
  });
});

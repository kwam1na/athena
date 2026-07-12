import { describe, expect, it } from "vitest";
import { parseBoundedPositiveInteger, resolveWalkthroughAllowedOrigins } from "./walkthroughConfig";

describe("walkthrough configuration", () => {
  it("rejects malformed and out-of-range numeric limits instead of failing open", () => {
    expect(() => parseBoundedPositiveInteger("NaN", 10, "TEST_LIMIT", 1, 100)).toThrow();
    expect(() => parseBoundedPositiveInteger("Infinity", 10, "TEST_LIMIT", 1, 100)).toThrow();
    expect(() => parseBoundedPositiveInteger("1.5", 10, "TEST_LIMIT", 1, 100)).toThrow();
    expect(() => parseBoundedPositiveInteger("0", 10, "TEST_LIMIT", 1, 100)).toThrow();
    expect(parseBoundedPositiveInteger(undefined, 10, "TEST_LIMIT", 1, 100)).toBe(10);
  });

  it("adds localhost only when local development is explicitly enabled", () => {
    expect(resolveWalkthroughAllowedOrigins("https://athena.example", false)).toEqual(["https://athena.example"]);
    expect(resolveWalkthroughAllowedOrigins("https://athena.example", true)).toEqual([
      "https://athena.example",
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ]);
  });
});

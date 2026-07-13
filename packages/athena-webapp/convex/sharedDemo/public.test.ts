import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("shared demo public contract", () => {
  it("exposes the frontend context and manual restore contract without a store argument", () => {
    const source = readFileSync("convex/sharedDemo/public.ts", "utf8");
    expect(source).toContain("export const getContext = query");
    expect(source).toContain("export const requestManualRestore = mutation");
    expect(source).toContain('args: { idempotencyKey: v.string() }');
    expect(source).not.toContain('args: { storeId:');
  });
});

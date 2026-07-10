import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("SKU valuation correction route", () => {
  it("requires fail-closed reporting access and delegates stock and cost to the inventory kernel", () => {
    const source = readFileSync(
      join(process.cwd(), "convex", "reporting", "inventory", "corrections.ts"),
      "utf8",
    );

    expect(source).toContain("requireReportingStoreAccess");
    expect(source).not.toContain("requireStoreFullAdminAccess");
    expect(source).toContain("applySkuValuationCorrectionWithCtx");
    expect(source).not.toContain('ctx.db.patch("productSku"');
  });
});

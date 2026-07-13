import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SHARED_DEMO_SEED, validateSharedDemoSeed } from "./provision";

describe("shared demo provisioning", () => {
  it("defines one coherent synthetic six-domain narrative", () => {
    expect(validateSharedDemoSeed(SHARED_DEMO_SEED)).toEqual([]);
    expect(SHARED_DEMO_SEED.domains).toEqual([
      "pos", "inventory", "cash", "orders", "staff", "operations",
    ]);
    expect(JSON.stringify(SHARED_DEMO_SEED)).not.toMatch(/@gmail|@yahoo|@hotmail/i);
  });

  it("seeds staff communication before capturing the baseline", () => {
    const source = readFileSync("convex/sharedDemo/provision.ts", "utf8");
    expect(source).toContain('ctx.db.insert("staffMessage"');
    expect(source.indexOf('ctx.db.insert("staffMessage"')).toBeLessThan(
      source.lastIndexOf("captureBaselineDocumentsWithCtx"),
    );
  });

  it("keeps Daily Operations actionable and migrates the prior started baseline", () => {
    const source = readFileSync("convex/sharedDemo/provision.ts", "utf8");
    expect(source).not.toContain('ctx.db.insert("dailyOpening"');
    expect(source).toContain('eventType: "demo.store_ready"');
    expect(source).toContain("restoreMutableDemoStoreRowsWithCtx");
    expect(source).toContain('ctx.db.delete("dailyOpening"');
  });
});

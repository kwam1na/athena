import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { planDomainRestore, requireBoundedBatch, SHARED_DEMO_MUTABLE_TABLES } from "./domainRestore";

describe("shared demo domain restore registry", () => {
  it("covers actual mutable tables for all six domains", () => {
    expect([...new Set(SHARED_DEMO_MUTABLE_TABLES.map((entry) => entry.domain))]).toEqual([
      "pos", "inventory", "cash", "orders", "operations", "staff",
    ]);
    expect(SHARED_DEMO_MUTABLE_TABLES.map((entry) => entry.tableName)).toEqual(
      expect.arrayContaining(["posTransactionItem", "onlineOrderItem", "staffMessage"]),
    );
  });

  it("restores changed baseline rows, deletes demo additions, and ignores another tenant", () => {
    const plan = planDomainRestore({
      baseline: [{ _id: "base", storeId: "demo", value: "original" }],
      current: [
        { _id: "base", storeId: "demo", value: "changed" },
        { _id: "added", storeId: "demo", value: "visitor" },
        { _id: "other", storeId: "real", value: "untouched" },
      ],
      storeId: "demo",
    });
    expect(plan.replace).toEqual([{ _id: "base", storeId: "demo", value: "original" }]);
    expect(plan.remove).toEqual(["added"]);
    expect(plan.untouched).toEqual([{ _id: "other", storeId: "real", value: "untouched" }]);
  });

  it("fails when protected baseline rows were destructively removed", () => {
    expect(() => planDomainRestore({
      baseline: [{ _id: "base", storeId: "demo" }],
      current: [],
      storeId: "demo",
    })).toThrow("Protected shared demo baseline row is missing.");
  });

  it("fails closed instead of silently truncating an over-budget table", () => {
    expect(() => requireBoundedBatch(Array.from({ length: 501 }), "staffMessage")).toThrow("restore batch required");
  });

  it("uses the daily opening store-prefix index declared by the schema", () => {
    const source = readFileSync("convex/sharedDemo/domainRestore.ts", "utf8");
    expect(source).toContain('tableName === "dailyOpening"');
    expect(source).toContain('withIndex("by_storeId_operatingDate"');
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = process.cwd();
const readProjectFile = (...segments: string[]) =>
  readFileSync(join(projectRoot, ...segments), "utf8");

describe("V26-173 POS query cleanup", () => {
  it("adds the composite transaction index needed for completed POS lookups", () => {
    const schemaSource = readProjectFile("convex", "schema.ts").replace(
      /\s+/g,
      " "
    );

    expect(schemaSource).toContain(
      '.index("by_storeId_status_completedAt", [ "storeId", "status", "completedAt", ])'
    );
  });

  it("uses direct product-id reads instead of store-wide product scans for POS lookups", () => {
    const source = readProjectFile("convex", "inventory", "pos.ts").replace(
      /\s+/g,
      " "
    );

    expect(source).toContain("if (isConvexProductId(query))");
    expect(source).toContain('ctx.db.get("product", query as Id<"product">)');
    expect(source).toContain(
      'ctx.db.get("product", args.barcode as Id<"product">)'
    );
    expect(source).not.toContain(
      '.query("product") .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId)) .filter((q) => q.eq(q.field("_id"), args.barcode))'
    );
  });

  it("uses the completed-transaction index for dashboard and completed transaction reads", () => {
    const source = readProjectFile("convex", "inventory", "pos.ts").replace(
      /\s+/g,
      " "
    );

    expect(source).toContain('withIndex("by_storeId_status_completedAt"');
    expect(source).not.toContain(
      '.withIndex("by_storeId", (q) => q.eq("storeId", args.storeId)) .filter((q) => q.and( q.eq(q.field("status"), "completed"), q.gte(q.field("completedAt"), startOfDay), q.lte(q.field("completedAt"), endOfDay) ) )'
    );
  });

  it("passes Convex lint without a file-level waiver on pos.ts", () => {
    const source = readProjectFile("convex", "inventory", "pos.ts");

    expect(source).not.toMatch(
      /^\/\* eslint-disable .*@convex-dev\/no-collect-in-query.*\*\/$/m
    );
    expect(source).not.toMatch(
      /^\/\* eslint-disable .*@convex-dev\/explicit-table-ids.*\*\/$/m
    );

    const lintResult = spawnSync(
      "bunx",
      ["eslint", "convex/inventory/pos.ts"],
      {
        cwd: projectRoot,
        encoding: "utf8",
      }
    );

    expect(lintResult.status, lintResult.stderr || lintResult.stdout).toBe(0);
  });
});

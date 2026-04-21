import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ESLint } from "eslint";

const projectRoot = process.cwd();
const repoRoot = join(projectRoot, "..", "..");
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

  it("avoids manual pagination loops in POS query helpers", () => {
    const source = readProjectFile("convex", "inventory", "pos.ts").replace(
      /\s+/g,
      " "
    );

    expect(source).not.toContain("async function collectAllPages");
    expect(source).not.toContain('.paginate({ cursor, numItems:');
  });

  it("passes Convex lint without a file-level waiver on pos.ts", async () => {
    const source = readProjectFile("convex", "inventory", "pos.ts");

    expect(source).not.toMatch(
      /^\/\* eslint-disable .*@convex-dev\/no-collect-in-query.*\*\/$/m
    );
    expect(source).not.toMatch(
      /^\/\* eslint-disable .*@convex-dev\/explicit-table-ids.*\*\/$/m
    );

    const eslint = new ESLint({ cwd: projectRoot });
    const lintResult = await eslint.lintFiles(["convex/inventory/pos.ts"]);
    const errorCount = lintResult.reduce(
      (sum, result) => sum + result.errorCount,
      0
    );
    const warningCount = lintResult.reduce(
      (sum, result) => sum + result.warningCount,
      0
    );

    expect(
      { errorCount, warningCount, lintResult },
      JSON.stringify(lintResult, null, 2)
    ).toMatchObject({
      errorCount: 0,
      warningCount: 0,
    });
  }, 30000);
});

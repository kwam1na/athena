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
    const source = readProjectFile(
      "convex",
      "pos",
      "application",
      "queries",
      "searchCatalog.ts"
    ).replace(
      /\s+/g,
      " "
    );

    expect(source).toContain("if (isConvexProductId(query))");
    expect(source).toContain('getProductById(ctx, query as Id<"product">)');
    expect(source).toContain('getProductById(ctx, args.barcode as Id<"product">)');
    expect(source).not.toContain(
      '.query("product") .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))'
    );
  });

  it("uses the completed-transaction index for dashboard and completed transaction reads", () => {
    const source = readProjectFile(
      "convex",
      "pos",
      "infrastructure",
      "repositories",
      "transactionRepository.ts"
    ).replace(
      /\s+/g,
      " "
    );

    expect(source).toContain('withIndex("by_storeId_status_completedAt"');
  });

  it("keeps the legacy POS inventory surface as a thin transport shim", () => {
    const source = readProjectFile("convex", "inventory", "pos.ts").replace(
      /\s+/g,
      " "
    );

    expect(source).toContain(
      'export { search as searchProducts, barcodeLookup as lookupByBarcode, } from "../pos/public/catalog";'
    );
    expect(source).toContain(
      'export { updateInventory, completeTransaction, getTransaction, getTransactionsByStore, getCompletedTransactions, getTransactionById, voidTransaction, createTransactionFromSession, getRecentTransactionsWithCustomers, getTodaySummary, } from "../pos/public/transactions";'
    );
    expect(source).not.toContain("query({");
    expect(source).not.toContain("mutation({");
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

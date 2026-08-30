import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(process.cwd(), "convex");
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "_generated") return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") &&
      !/\.test\.|[Tt]estSupport|\.fixture\./.test(entry.name)
      ? [path]
      : [];
  });
}
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("inventory contribution source write-site coverage", () => {
  it("routes generic and review mutations through atomic contribution helpers", () => {
    const expected = new Map([
      [
        "operations/operationalWorkItems.ts",
        [
          "insertOperationalWorkItemWithInventoryWithCtx",
          "patchOperationalWorkItemWithInventoryWithCtx",
        ],
      ],
      [
        "pos/infrastructure/repositories/localSyncRepository.ts",
        ["insertOperationalWorkItemWithInventoryWithCtx"],
      ],
      [
        "operations/openWorkInventoryReviews.ts",
        ["patchOperationalWorkItemWithInventoryWithCtx"],
      ],
      [
        "operations/dailyClose.ts",
        ["patchOperationalWorkItemWithInventoryWithCtx"],
      ],
      [
        "operations/approvalRequests.ts",
        ["patchOperationalWorkItemWithInventoryWithCtx"],
      ],
      [
        "operations/oversizedOperationalWorkRepair.ts",
        [
          "patchOperationalWorkItemWithInventoryWithCtx",
          "patchInventoryRepairWithCtx",
          "syncInventoryRepairWithCtx",
        ],
      ],
      [
        "pos/application/commands/pendingCheckoutReviewWorkLifecycle.ts",
        ["patchOperationalWorkItemWithInventoryWithCtx"],
      ],
      [
        "pos/application/commands/createOrReusePendingCheckoutItem.ts",
        ["patchOperationalWorkItemWithInventoryWithCtx"],
      ],
      [
        "serviceOps/serviceCases.ts",
        ["patchOperationalWorkItemWithInventoryWithCtx"],
      ],
    ]);
    for (const [path, helpers] of expected)
      for (const helper of helpers) {
        expect(read(path), `${path} must call ${helper}`).toMatch(
          new RegExp(`${helper}\\s*\\(`),
        );
      }
    const direct = sourceFiles(root)
      .flatMap((path) => {
        const matches =
          readFileSync(path, "utf8").match(
            /\.\s*(?:insert|patch|replace|delete)\s*\(\s*["']operationalWorkItem["']/g,
          ) ?? [];
        return matches.map(() => relative(root, path));
      })
      .sort();
    // These existing narrow writes only mutate catalog_taxonomy_setup or the
    // stock_adjustment_review just created in that transaction, never a review
    // alias. A new direct site/count is a mandatory coverage review.
    expect(direct).toEqual([
      "inventory/catalogImport.ts",
      "inventory/catalogImport.ts",
      "operations/inventoryContributions.ts",
      "operations/inventoryContributions.ts",
      "operations/inventoryContributions.ts",
      "stockOps/adjustments.ts",
    ]);
  });
});

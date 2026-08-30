import { describe, expect, it } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import { projectLogicalOperationalWork } from "./logicalOperationalWork";
import { projectLiveWeeklyInventoryAttention } from "../reports/weeklyInventory";
import {
  normalizeInventoryContribution,
  projectCompactInventoryAttention,
} from "./inventoryContributions";

function item(
  id: string,
  overrides: Partial<Doc<"operationalWorkItem">> = {},
): Doc<"operationalWorkItem"> {
  return {
    _id: id as Id<"operationalWorkItem">,
    _creationTime: 0,
    storeId: "store" as Id<"store">,
    organizationId: "org" as Id<"organization">,
    type: "synced_sale_inventory_review",
    status: "open",
    priority: "normal",
    approvalState: "not_required",
    title: "PRIVATE customer detail",
    notes: "PRIVATE",
    productSkuId: "sku-a" as Id<"productSku">,
    createdAt: 100,
    metadata: { localTransactionId: id },
    ...overrides,
  };
}

describe("compact inventory grouping parity", () => {
  it("preserves alias representative, repair split, ordering and min/max creation semantics", () => {
    const items = [
      item("old-alias", {
        createdAt: 50,
        productSkuId: "sku-old" as Id<"productSku">,
        metadata: { localTransactionId: "alias" },
      }),
      item("preferred-alias", {
        createdAt: 120,
        status: "in_progress",
        metadata: { localTransactionId: "alias" },
      }),
      item("fresh", { createdAt: 110 }),
      item("expense", {
        createdAt: 80,
        metadata: { sourceKind: "expense", localExpenseEventId: "expense" },
      }),
      item("unknown", { productSkuId: undefined }),
      item("approval", {
        approvalState: "pending",
        productSkuId: "sku-b" as Id<"productSku">,
      }),
    ];
    const normalized = items.map((value) =>
      normalizeInventoryContribution(value)!,
    );
    const repairs = new Map([
      [
        "synced_sale_inventory_review:store:sku-a",
        new Set([normalized[0].sourceIdentity]),
      ],
    ]);
    for (const ordered of [items, [...items].reverse()]) {
      for (const completeness of ["complete", "incomplete"] as const) {
        const legacy = projectLiveWeeklyInventoryAttention({
          frameStartAt: 100,
          logicalWork: projectLogicalOperationalWork({
            items: ordered,
            sourceCompleteness: completeness,
            remediationSourceIdentitiesByGroupKey: repairs,
          }),
        });
        const compact = projectCompactInventoryAttention({
          frameStartAt: 100,
          contributions: ordered.map((value) =>
            normalizeInventoryContribution(value)!,
          ),
          repairs,
          completeness,
        });
        expect(compact).toEqual(legacy);
        expect(JSON.stringify(normalized)).not.toContain("PRIVATE");
      }
    }
  });

  it("excludes terminal and non-review rows without conflating missing SKU with missing evidence", () => {
    expect(
      normalizeInventoryContribution(item("closed", { status: "completed" })),
    ).toBeNull();
    expect(
      normalizeInventoryContribution(item("other", { type: "service_case" })),
    ).toBeNull();
    const result = projectCompactInventoryAttention({
      frameStartAt: 100,
      contributions: [
        normalizeInventoryContribution(
          item("unknown", { productSkuId: undefined }),
        )!,
      ],
      repairs: new Map(),
      completeness: "complete",
    });
    expect(result.completeness).toBe("complete");
    expect(result.groups[0].evidenceLimited).toBe(true);
  });
});

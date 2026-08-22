import { describe, expect, it } from "vitest";

import type { Doc, Id } from "../_generated/dataModel";
import { projectLogicalOperationalWork } from "../operations/logicalOperationalWork";
import {
  projectFrozenWeeklyInventoryAttention,
  projectLiveWeeklyInventoryAttention,
} from "./weeklyInventory";

function inventoryReview(overrides: Partial<Doc<"operationalWorkItem">> = {}) {
  return {
    _id: "work-1" as Id<"operationalWorkItem">,
    approvalState: "not_required",
    createdAt: 100,
    metadata: { localTransactionId: "sale-1" },
    organizationId: "org-1" as Id<"organization">,
    priority: "normal",
    productSkuId: "sku-1" as Id<"productSku">,
    status: "open",
    storeId: "store-1" as Id<"store">,
    title: "Review inventory",
    type: "synced_sale_inventory_review",
    ...overrides,
  } as Doc<"operationalWorkItem">;
}

describe("projectLiveWeeklyInventoryAttention", () => {
  it("collapses same-SKU reviews and classifies once at the group level", () => {
    const logicalWork = projectLogicalOperationalWork({
      items: [
        inventoryReview({
          _id: "carried" as Id<"operationalWorkItem">,
          createdAt: 99,
          metadata: { localTransactionId: "sale-carried" },
        }),
        inventoryReview({
          _id: "new-on-carried" as Id<"operationalWorkItem">,
          createdAt: 101,
          metadata: { localTransactionId: "sale-new" },
        }),
        inventoryReview({
          _id: "new-sku" as Id<"operationalWorkItem">,
          createdAt: 102,
          metadata: { localTransactionId: "sale-new-sku" },
          productSkuId: "sku-2" as Id<"productSku">,
        }),
      ],
      sourceCompleteness: "complete",
    });

    expect(
      projectLiveWeeklyInventoryAttention({
        frameStartAt: 100,
        logicalWork,
      }),
    ).toEqual({
      carriedForwardCount: 1,
      completeness: "complete",
      groups: [
        expect.objectContaining({
          classification: "carried_forward",
          hasNewActivity: true,
          key: "synced_sale_inventory_review:store-1:sku-1",
        }),
        expect.objectContaining({
          classification: "new_this_week",
          hasNewActivity: true,
          key: "synced_sale_inventory_review:store-1:sku-2",
        }),
      ],
      newCount: 1,
      observedCount: 2,
      overflow: false,
    });
  });

  it("includes expense members in the mixed-source SKU attention group", () => {
    const logicalWork = projectLogicalOperationalWork({
      items: [
        inventoryReview({
          _id: "sale-member" as Id<"operationalWorkItem">,
          createdAt: 99,
          metadata: { localTransactionId: "sale-carried", sourceKind: "sale" },
        }),
        inventoryReview({
          _id: "expense-member" as Id<"operationalWorkItem">,
          createdAt: 101,
          metadata: {
            localExpenseEventId: "local-expense-event-1",
            localExpenseSessionId: "local-expense-session-1",
            sourceKind: "expense",
            terminalId: "terminal-1",
          },
        }),
      ],
      sourceCompleteness: "complete",
    });

    const attention = projectLiveWeeklyInventoryAttention({
      frameStartAt: 100,
      logicalWork,
    });

    expect(attention.observedCount).toBe(1);
    expect(attention.groups).toEqual([
      expect.objectContaining({
        classification: "carried_forward",
        hasNewActivity: true,
        key: "synced_sale_inventory_review:store-1:sku-1",
        memberCount: 2,
      }),
    ]);
    expect(logicalWork.groups[0].sourceIdentities).toHaveLength(2);
  });

  it("preserves the canonical missing-SKU fallback rather than merging unrelated reviews", () => {
    const logicalWork = projectLogicalOperationalWork({
      items: [
        inventoryReview({
          _id: "missing-a" as Id<"operationalWorkItem">,
          metadata: { localTransactionId: "sale-a" },
          productSkuId: undefined,
        }),
        inventoryReview({
          _id: "missing-b" as Id<"operationalWorkItem">,
          metadata: { localTransactionId: "sale-b" },
          productSkuId: undefined,
        }),
      ],
      sourceCompleteness: "complete",
    });

    const result = projectLiveWeeklyInventoryAttention({
      frameStartAt: 0,
      logicalWork,
    });

    expect(result.observedCount).toBe(2);
    expect(result.groups.map((group) => group.productSkuId)).toEqual([
      null,
      null,
    ]);
    expect(result.groups.map((group) => group.evidenceLimited)).toEqual([
      true,
      true,
    ]);
  });

  it("returns a lower-bound/incomplete posture instead of claiming an exact subset", () => {
    const logicalWork = projectLogicalOperationalWork({
      incompleteTypes: new Set(["synced_sale_inventory_review"]),
      items: [inventoryReview()],
      sourceCompleteness: "incomplete",
    });

    expect(
      projectLiveWeeklyInventoryAttention({
        frameStartAt: 0,
        logicalWork,
        overflow: true,
      }),
    ).toMatchObject({
      completeness: "incomplete",
      observedCount: 1,
      overflow: true,
    });
  });

  it("never persists a route: routing is rebuilt per read, not frozen", () => {
    const logicalWork = projectLogicalOperationalWork({
      items: [inventoryReview()],
      sourceCompleteness: "complete",
    });

    expect(
      projectLiveWeeklyInventoryAttention({ frameStartAt: 0, logicalWork }),
    ).not.toHaveProperty("route");
  });
});

describe("projectFrozenWeeklyInventoryAttention", () => {
  it("uses complete frozen group evidence without reading or changing live Open Work", () => {
    expect(
      projectFrozenWeeklyInventoryAttention({
        frameStartAt: 100,
        membershipCompleteness: "complete",
        groups: [
          {
            key: "synced_sale_inventory_review:store-1:sku-1",
            members: [
              { createdAt: 99, workItemId: "carried" },
              { createdAt: 101, workItemId: "new-on-carried" },
            ],
            productSkuId: "sku-1" as Id<"productSku">,
          },
          {
            key: "synced_sale_inventory_review:store-1:sku-2",
            members: [{ createdAt: 101, workItemId: "new" }],
            productSkuId: "sku-2" as Id<"productSku">,
          },
        ],
      }),
    ).toMatchObject({
      carriedForwardCount: 1,
      completeness: "complete",
      newCount: 1,
      observedCount: 2,
      groups: [
        expect.objectContaining({
          classification: "carried_forward",
          hasNewActivity: true,
        }),
        expect.objectContaining({ classification: "new_this_week" }),
      ],
    });
  });

  it("fails closed when a legacy final-close snapshot cannot prove membership", () => {
    expect(
      projectFrozenWeeklyInventoryAttention({
        frameStartAt: 100,
        membershipCompleteness: "incomplete",
        groups: [
          {
            key: "synced_sale_inventory_review:store-1:sku-1",
            members: [],
            productSkuId: "sku-1" as Id<"productSku">,
          },
        ],
      }),
    ).toEqual({
      carriedForwardCount: 0,
      completeness: "unavailable",
      groups: [],
      newCount: 0,
      observedCount: 0,
      overflow: false,
    });
  });

  it("does not classify an individually incomplete frozen group as new work", () => {
    expect(
      projectFrozenWeeklyInventoryAttention({
        frameStartAt: 100,
        membershipCompleteness: "complete",
        groups: [
          {
            key: "synced_sale_inventory_review:store-1:sku-1",
            members: [],
            productSkuId: "sku-1" as Id<"productSku">,
          },
        ],
      }),
    ).toMatchObject({ completeness: "unavailable", observedCount: 0 });
  });
});

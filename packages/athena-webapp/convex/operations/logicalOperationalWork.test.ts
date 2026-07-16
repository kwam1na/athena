import { describe, expect, it } from "vitest";

import type { Doc, Id } from "../_generated/dataModel";
import {
  MAX_ATOMIC_SYNCED_SALE_REVIEW_GROUP_SIZE,
  projectLogicalOperationalWork,
  stableOperationalWorkItemSourceIdentity,
} from "./logicalOperationalWork";

function workItem(
  overrides: Partial<Doc<"operationalWorkItem">> = {},
): Doc<"operationalWorkItem"> {
  return {
    _creationTime: 1,
    _id: "work-1" as Id<"operationalWorkItem">,
    approvalState: "not_required",
    createdAt: 1,
    organizationId: "org-1" as Id<"organization">,
    priority: "normal",
    status: "open",
    storeId: "store-1" as Id<"store">,
    title: "Review inventory",
    type: "synced_sale_inventory_review",
    ...overrides,
  };
}

describe("projectLogicalOperationalWork", () => {
  it("groups same-store synced-sale sources by canonical SKU and retains duplicate aliases", () => {
    const result = projectLogicalOperationalWork({
      items: [
        workItem({
          _id: "work-source-a" as Id<"operationalWorkItem">,
          productSkuId: "sku-1" as Id<"productSku">,
          metadata: {
            localRegisterSessionId: "session-a",
            localTransactionId: "transaction-a",
            terminalId: "terminal-a",
          },
        }),
        workItem({
          _id: "work-source-a-alias" as Id<"operationalWorkItem">,
          createdAt: 2,
          metadata: {
            localRegisterSessionId: "session-a",
            localTransactionId: "transaction-a",
            primaryProductSkuId: "sku-1",
            terminalId: "terminal-a",
          },
        }),
        workItem({
          _id: "work-source-b" as Id<"operationalWorkItem">,
          createdAt: 3,
          metadata: {
            localRegisterSessionId: "session-b",
            localTransactionId: "transaction-b",
            primaryProductSkuId: "sku-1",
            terminalId: "terminal-a",
          },
        }),
      ],
      sourceCompleteness: "complete",
    });

    expect(result).toMatchObject({ completeness: "complete", observedCount: 1 });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({
      key: "synced_sale_inventory_review:store-1:sku-1",
      productSkuId: "sku-1",
      resolutionAvailability: "available",
    });
    expect(result.groups[0].representatives.map((item) => item._id)).toEqual([
      "work-source-a",
      "work-source-b",
    ]);
    expect(result.groups[0].items.map((item) => item._id)).toEqual([
      "work-source-a",
      "work-source-a-alias",
      "work-source-b",
    ]);
  });

  it("aggregates priority, status, and oldest actionable time independently across sources and aliases", () => {
    const result = projectLogicalOperationalWork({
      items: [
        workItem({
          _id: "source-a" as Id<"operationalWorkItem">,
          createdAt: 100,
          metadata: { localTransactionId: "transaction-a" },
          productSkuId: "sku-1" as Id<"productSku">,
          priority: "normal",
          status: "open",
        }),
        workItem({
          _id: "source-a-high-alias" as Id<"operationalWorkItem">,
          createdAt: 200,
          metadata: { localTransactionId: "transaction-a" },
          productSkuId: "sku-1" as Id<"productSku">,
          priority: "high",
          status: "open",
        }),
        workItem({
          _id: "source-b-in-progress" as Id<"operationalWorkItem">,
          createdAt: 300,
          metadata: { localTransactionId: "transaction-b" },
          productSkuId: "sku-1" as Id<"productSku">,
          priority: "normal",
          startedAt: 50,
          status: "in_progress",
        }),
        workItem({
          _id: "source-c-oldest" as Id<"operationalWorkItem">,
          createdAt: 400,
          dueAt: 5,
          metadata: { localTransactionId: "transaction-c" },
          productSkuId: "sku-1" as Id<"productSku">,
          priority: "normal",
          status: "open",
        }),
      ],
      sourceCompleteness: "complete",
    });

    expect(result.groups[0]).toMatchObject({
      oldestActionableAt: 5,
      priority: "high",
      status: "in_progress",
    });
    expect(result.groups[0].items).toHaveLength(4);
    expect(result.groups[0].representatives).toHaveLength(3);
  });

  it("keeps missing-SKU reviews, unrelated work types, and different stores separate", () => {
    const result = projectLogicalOperationalWork({
      items: [
        workItem({ _id: "missing-a" as Id<"operationalWorkItem"> }),
        workItem({ _id: "missing-b" as Id<"operationalWorkItem"> }),
        workItem({
          _id: "other-store" as Id<"operationalWorkItem">,
          productSkuId: "sku-1" as Id<"productSku">,
          storeId: "store-2" as Id<"store">,
        }),
        workItem({
          _id: "service" as Id<"operationalWorkItem">,
          type: "service_case",
        }),
      ],
      sourceCompleteness: "complete",
    });

    expect(result.groups.map((group) => group.key)).toEqual([
      "synced_sale_inventory_review:store-2:sku-1",
      "synced_sale_inventory_review:missing-a",
      "synced_sale_inventory_review:missing-b",
      "service_case:service",
    ]);
  });

  it("keeps unrelated rows distinct even when they share a source identity", () => {
    const result = projectLogicalOperationalWork({
      items: [
        workItem({
          _id: "service-a" as Id<"operationalWorkItem">,
          metadata: { serviceCaseId: "case-1" },
          type: "service_case",
        }),
        workItem({
          _id: "service-b" as Id<"operationalWorkItem">,
          metadata: { serviceCaseId: "case-1" },
          type: "service_case",
        }),
      ],
      sourceCompleteness: "complete",
    });

    expect(result.groups.map((group) => group.key)).toEqual([
      "service_case:service-a",
      "service_case:service-b",
    ]);
  });

  it("keeps complete types actionable when another type is incomplete", () => {
    const result = projectLogicalOperationalWork({
      incompleteTypes: new Set(["service_case"]),
      items: [
        workItem({
          productSkuId: "sku-1" as Id<"productSku">,
        }),
        workItem({
          _id: "service" as Id<"operationalWorkItem">,
          type: "service_case",
        }),
      ],
      sourceCompleteness: "incomplete",
    });

    expect(result.groups).toEqual([
      expect.objectContaining({
        completeness: "complete",
        resolutionAvailability: "available",
      }),
      expect.objectContaining({
        completeness: "incomplete",
        resolutionAvailability: "source_incomplete",
      }),
    ]);
  });

  it("keeps same-session missing-SKU reviews distinct without a sale discriminator", () => {
    const result = projectLogicalOperationalWork({
      items: [
        workItem({
          _id: "missing-session-a" as Id<"operationalWorkItem">,
          metadata: {
            localRegisterSessionId: "session-a",
            terminalId: "terminal-a",
          },
        }),
        workItem({
          _id: "missing-session-b" as Id<"operationalWorkItem">,
          createdAt: 2,
          metadata: {
            localRegisterSessionId: "session-a",
            terminalId: "terminal-a",
          },
        }),
      ],
      sourceCompleteness: "complete",
    });

    expect(result).toMatchObject({
      completeness: "complete",
      observedCount: 2,
    });
    expect(result.groups.map((group) => group.key)).toEqual([
      "synced_sale_inventory_review:missing-session-a",
      "synced_sale_inventory_review:missing-session-b",
    ]);
    expect(
      result.groups.map((group) => group.items.map((item) => item._id)),
    ).toEqual([["missing-session-a"], ["missing-session-b"]]);
  });

  it("marks incomplete projections as lower bounds with no actionable membership", () => {
    const result = projectLogicalOperationalWork({
      items: [
        workItem({
          productSkuId: "sku-1" as Id<"productSku">,
        }),
      ],
      sourceCompleteness: "incomplete",
    });

    expect(result.completeness).toBe("incomplete");
    expect(result.groups[0].resolutionAvailability).toBe("source_incomplete");
  });

  it("fails closed when aliases push a group beyond the atomic transition budget", () => {
    const items = Array.from(
      { length: MAX_ATOMIC_SYNCED_SALE_REVIEW_GROUP_SIZE + 1 },
      (_, index) =>
        workItem({
          _id: `work-${index}` as Id<"operationalWorkItem">,
          createdAt: index,
          metadata: {
            localRegisterSessionId: `session-${index}`,
            localTransactionId: `transaction-${index}`,
            primaryProductSkuId: "sku-1",
            terminalId: "terminal-a",
          },
        }),
    );

    const result = projectLogicalOperationalWork({
      items,
      sourceCompleteness: "complete",
    });

    expect(result.groups[0].resolutionAvailability).toBe("budget_exceeded");
    expect(result.groups[0].items).toHaveLength(51);
  });

  it("keeps an active oversized repair visible as one remediation group", () => {
    const key = "synced_sale_inventory_review:store-1:sku-1";
    const item = workItem({
      productSkuId: "sku-1" as Id<"productSku">,
    });
    const result = projectLogicalOperationalWork({
      items: [item],
      remediationSourceIdentitiesByGroupKey: new Map([
        [key, new Set([stableOperationalWorkItemSourceIdentity(item)])],
      ]),
      sourceCompleteness: "complete",
    });

    expect(result.groups[0]).toMatchObject({
      key,
      resolutionAvailability: "remediation_in_progress",
    });
  });

  it("keeps later distinct sources actionable beside a frozen repair", () => {
    const key = "synced_sale_inventory_review:store-1:sku-1";
    const frozen = workItem({
      metadata: { localTransactionId: "transaction-frozen" },
      productSkuId: "sku-1" as Id<"productSku">,
    });
    const later = workItem({
      _id: "work-later" as Id<"operationalWorkItem">,
      metadata: { localTransactionId: "transaction-later" },
      productSkuId: "sku-1" as Id<"productSku">,
    });
    const result = projectLogicalOperationalWork({
      items: [frozen, later],
      remediationSourceIdentitiesByGroupKey: new Map([
        [key, new Set([stableOperationalWorkItemSourceIdentity(frozen)])],
      ]),
      sourceCompleteness: "complete",
    });

    expect(result.groups).toEqual([
      expect.objectContaining({
        key,
        resolutionAvailability: "remediation_in_progress",
      }),
      expect.objectContaining({
        key: `${key}:post_repair`,
        resolutionAvailability: "available",
      }),
    ]);
  });
});

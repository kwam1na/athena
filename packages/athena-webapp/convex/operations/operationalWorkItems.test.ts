import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../_generated/dataModel";
import {
  createOperationalWorkItem,
  getOpenWorkCountSummary,
  getPendingApprovalCountSummary,
  getQueueSnapshot,
} from "./operationalWorkItems";
import * as athenaUserAuth from "../lib/athenaUserAuth";
import * as sharedDemoActor from "../sharedDemo/actor";

const TEST_MAX_QUEUE_ITEMS = 100;

vi.mock("../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
}));
vi.mock("../sharedDemo/actor", () => ({
  requireSharedDemoStoreCapabilityIfApplicable: vi.fn(),
}));

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

type QueueTestRow = Record<string, unknown>;

function workItem(overrides: Partial<QueueTestRow> = {}) {
  return {
    _id: "work-item-1" as Id<"operationalWorkItem">,
    approvalState: "not_required",
    createdAt: 1,
    organizationId: "org-1" as Id<"organization">,
    priority: "normal",
    status: "open",
    storeId: "store-1" as Id<"store">,
    title: "Operational work",
    type: "service_case",
    ...overrides,
  } as QueueTestRow;
}

function approvalRequest(overrides: Partial<QueueTestRow> = {}) {
  return {
    _id: "approval-1" as Id<"approvalRequest">,
    createdAt: 1,
    requestType: "variance_review",
    status: "pending",
    storeId: "store-1" as Id<"store">,
    subjectId: "subject-1",
    subjectType: "register_session",
    ...overrides,
  } as QueueTestRow;
}

function createQueueContext(
  args: {
    approvalRequests?: QueueTestRow[];
    oversizedRepairs?: QueueTestRow[];
    products?: QueueTestRow[];
    syncConflicts?: QueueTestRow[];
    stores?: QueueTestRow[];
    workItems?: QueueTestRow[];
  } = {},
) {
  const stores = args.stores ?? [{ _id: "store-1", organizationId: "org-1" }];
  const products = args.products ?? [];
  const oversizedRepairs = args.oversizedRepairs ?? [];
  const workItems = args.workItems ?? [];
  const approvalRequests = args.approvalRequests ?? [];
  const syncConflicts = args.syncConflicts ?? [];

  return {
    db: {
      get: vi.fn(async (tableName: string, id: string) => {
        if (tableName === "store") {
          return stores.find((store) => store._id === id) ?? null;
        }
        if (tableName === "operationalWorkItem") {
          return workItems.find((item) => item._id === id) ?? null;
        }
        if (tableName === "product") {
          return products.find((product) => product._id === id) ?? null;
        }
        return null;
      }),
      query: vi.fn((tableName: string) => ({
        withIndex: vi.fn((_indexName: string, callback: Function) => {
          const constraints = new Map<string, unknown>();
          const queryBuilder = {
            eq(fieldName: string, value: unknown) {
              constraints.set(fieldName, value);
              return queryBuilder;
            },
          };
          callback(queryBuilder);

          const collectMatchingRows = async () => {
            if (tableName === "operationalWorkItem") {
              return workItems.filter((item) =>
                Array.from(constraints.entries()).every(
                  ([fieldName, value]) => item[fieldName] === value,
                ),
              );
            }
            if (tableName === "approvalRequest") {
              return approvalRequests.filter((request) =>
                Array.from(constraints.entries()).every(
                  ([fieldName, value]) => request[fieldName] === value,
                ),
              );
            }
            if (tableName === "oversizedOperationalWorkRepair") {
              return oversizedRepairs.filter((repair) =>
                Array.from(constraints.entries()).every(
                  ([fieldName, value]) => repair[fieldName] === value,
                ),
              );
            }
            if (tableName === "posLocalSyncConflict") {
              return syncConflicts.filter((conflict) =>
                Array.from(constraints.entries()).every(
                  ([fieldName, value]) => conflict[fieldName] === value,
                ),
              );
            }
            return [];
          };

          return {
            collect: vi.fn(collectMatchingRows),
            take: vi.fn(async (limit: number) =>
              (await collectMatchingRows()).slice(0, limit),
            ),
            unique: vi.fn(async () => null),
          };
        }),
      })),
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(
    athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
  ).mockResolvedValue({
    _id: "user-1",
  } as never);
});

describe("getOpenWorkCountSummary", () => {
  it("returns the bounded consolidated count without loading queue evidence", async () => {
    const ctx = createQueueContext({
      workItems: [
        workItem({
          _id: "synced-sale-1" as Id<"operationalWorkItem">,
          metadata: { localTransactionId: "transaction-1" },
          productSkuId: "sku-1" as Id<"productSku">,
          type: "synced_sale_inventory_review",
        }),
        workItem({
          _id: "synced-sale-2" as Id<"operationalWorkItem">,
          metadata: { localTransactionId: "transaction-2" },
          productSkuId: "sku-1" as Id<"productSku">,
          status: "in_progress",
          type: "synced_sale_inventory_review",
        }),
        workItem({
          _id: "service-case-1" as Id<"operationalWorkItem">,
          type: "service_case",
        }),
      ],
    });

    const result = await getHandler(getOpenWorkCountSummary)(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(result).toEqual({
      completeness: "complete",
      count: 2,
    });
    expect(ctx.db.query).not.toHaveBeenCalledWith("approvalRequest");
    expect(ctx.db.query).not.toHaveBeenCalledWith("localSyncConflict");
  });

  it("marks the observed count incomplete when a logical-work lane reaches its read bound", async () => {
    const ctx = createQueueContext({
      workItems: Array.from({ length: 501 }, (_, index) =>
        workItem({
          _id: `service-case-${index}` as Id<"operationalWorkItem">,
          type: "service_case",
        }),
      ),
    });

    const result = await getHandler(getOpenWorkCountSummary)(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(result).toEqual({
      completeness: "incomplete",
      count: 500,
    });
  });
});

describe("getPendingApprovalCountSummary", () => {
  it("counts supported pending approvals without loading queue records", async () => {
    const ctx = createQueueContext({
      approvalRequests: [
        approvalRequest({
          _id: "approval-1" as Id<"approvalRequest">,
          requestType: "variance_review",
        }),
        approvalRequest({
          _id: "approval-2" as Id<"approvalRequest">,
          requestType: "pos_transaction_void",
        }),
        approvalRequest({
          _id: "approval-unsupported" as Id<"approvalRequest">,
          requestType: "unsupported_review",
        }),
        approvalRequest({
          _id: "approval-complete" as Id<"approvalRequest">,
          requestType: "variance_review",
          status: "approved",
        }),
      ],
    });

    const result = await getHandler(getPendingApprovalCountSummary)(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(result).toEqual({
      completeness: "complete",
      count: 2,
    });
    expect(ctx.db.query).not.toHaveBeenCalledWith("operationalWorkItem");
  });

  it("marks the observed approval count incomplete at the navigation read bound", async () => {
    const ctx = createQueueContext({
      approvalRequests: Array.from({ length: 101 }, (_, index) =>
        approvalRequest({
          _id: `approval-${index}` as Id<"approvalRequest">,
          requestType: "variance_review",
        }),
      ),
    });

    const result = await getHandler(getPendingApprovalCountSummary)(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(result).toEqual({
      completeness: "incomplete",
      count: 100,
    });
  });

  it("does not let resolved sync-conflict history make an exact approval count incomplete", async () => {
    const ctx = createQueueContext({
      approvalRequests: [
        approvalRequest({
          _id: "approval-1" as Id<"approvalRequest">,
          requestType: "inventory_adjustment_review",
        }),
      ],
      syncConflicts: Array.from({ length: 101 }, (_, index) => ({
        _id: `sync-conflict-resolved-${index}`,
        conflictType: "permission",
        createdAt: index,
        details: {},
        localEventId: `event-resolved-${index}`,
        sequence: index,
        status: "resolved",
        storeId: "store-1",
        summary: "Resolved register sync review.",
      })),
    });

    const result = await getHandler(getPendingApprovalCountSummary)(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(result).toEqual({
      completeness: "complete",
      count: 1,
    });
  });

  it("propagates incomplete sync-conflict evidence into the approval summary", async () => {
    const ctx = createQueueContext({
      syncConflicts: Array.from({ length: 101 }, (_, index) => ({
        _id: `sync-conflict-${index}`,
        conflictType: "permission",
        createdAt: index,
        details: {},
        localEventId: `event-${index}`,
        sequence: index,
        status: "needs_review",
        storeId: "store-1",
        summary: "Register sync review needed.",
      })),
    });

    const result = await getHandler(getPendingApprovalCountSummary)(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(result).toEqual({
      completeness: "incomplete",
      count: 0,
    });
  });
});

describe("getQueueSnapshot", () => {
  it("accepts refreshNonce only on the queue query contract", async () => {
    type ExportedArgsContract = { exportArgs: () => Promise<string> };
    const queueArgs = JSON.parse(
      await (getQueueSnapshot as unknown as ExportedArgsContract).exportArgs(),
    );
    const createArgs = JSON.parse(
      await (
        createOperationalWorkItem as unknown as ExportedArgsContract
      ).exportArgs(),
    );

    expect(queueArgs.value.refreshNonce).toEqual({
      fieldType: { type: "number" },
      optional: true,
    });
    expect(createArgs.value.refreshNonce).toBeUndefined();
  });

  it("serializes aggregate synced-sale urgency independently from its representative", async () => {
    const ctx = createQueueContext({
      workItems: [
        workItem({
          _id: "work-open-oldest" as Id<"operationalWorkItem">,
          createdAt: 1,
          metadata: { localTransactionId: "transaction-open" },
          productSkuId: "sku-1" as Id<"productSku">,
          priority: "normal",
          status: "open",
          type: "synced_sale_inventory_review",
        }),
        workItem({
          _id: "work-open-high-alias" as Id<"operationalWorkItem">,
          createdAt: 3,
          metadata: { localTransactionId: "transaction-open" },
          productSkuId: "sku-1" as Id<"productSku">,
          priority: "high",
          status: "open",
          type: "synced_sale_inventory_review",
        }),
        workItem({
          _id: "work-in-progress" as Id<"operationalWorkItem">,
          createdAt: 10,
          metadata: { localTransactionId: "transaction-progress" },
          productSkuId: "sku-1" as Id<"productSku">,
          priority: "normal",
          startedAt: 5,
          status: "in_progress",
          type: "synced_sale_inventory_review",
        }),
      ],
    });

    const result = await getHandler(getQueueSnapshot)(ctx, {
      refreshNonce: 1,
      storeId: "store-1" as Id<"store">,
      workType: "synced_sale_inventory_review",
    });

    expect(result.workItems[0]).toMatchObject({
      priority: "high",
      status: "in_progress",
      logicalGroup: {
        oldestActionableAt: 1,
      },
    });
  });
  it("uses the inventory capability for the shared demo queue snapshot", async () => {
    const ctx = createQueueContext();
    vi.mocked(
      sharedDemoActor.requireSharedDemoStoreCapabilityIfApplicable,
    ).mockResolvedValueOnce({ kind: "shared_demo" } as never);

    await getHandler(getQueueSnapshot)(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(
      sharedDemoActor.requireSharedDemoStoreCapabilityIfApplicable,
    ).toHaveBeenCalledWith(ctx, "inventory.adjust", "store-1");
    expect(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).toHaveBeenCalledWith(ctx, {
      sharedDemoCapability: "inventory.adjust",
    });
  });

  it("includes current open work items and excludes terminal rows from the queue snapshot", async () => {
    const ctx = createQueueContext({
      workItems: [
        workItem({
          _id: "work-open" as Id<"operationalWorkItem">,
          status: "open",
          type: "synced_sale_inventory_review",
        }),
        workItem({
          _id: "work-in-progress" as Id<"operationalWorkItem">,
          status: "in_progress",
          type: "purchase_order",
        }),
        workItem({
          _id: "work-completed" as Id<"operationalWorkItem">,
          status: "completed",
          type: "service_case",
        }),
        workItem({
          _id: "work-cancelled" as Id<"operationalWorkItem">,
          status: "cancelled",
          type: "service_appointment",
        }),
      ],
    });

    const result = await getHandler(getQueueSnapshot)(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(result.workItems.map((item: QueueTestRow) => item._id)).toEqual([
      "work-open",
      "work-in-progress",
    ]);
    expect(result.approvalRequests).toEqual([]);
    expect(result.overflow).toEqual({
      approvalRequests: false,
      workItems: { inProgress: false, open: false },
    });
  });

  it("keeps work items and approval requests in separate lanes", async () => {
    const ctx = createQueueContext({
      approvalRequests: [
        approvalRequest({
          _id: "approval-pending" as Id<"approvalRequest">,
          createdAt: 2,
        }),
      ],
      workItems: [
        workItem({
          _id: "work-open" as Id<"operationalWorkItem">,
          createdAt: 1,
        }),
      ],
    });

    const result = await getHandler(getQueueSnapshot)(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(result.workItems.map((item: QueueTestRow) => item._id)).toEqual([
      "work-open",
    ]);
    expect(
      result.approvalRequests.map((request: QueueTestRow) => request._id),
    ).toEqual(["approval-pending"]);
  });

  it("projects sanitized work-item details without raw metadata", async () => {
    const ctx = createQueueContext({
      workItems: [
        workItem({
          _id: "work-carry-forward" as Id<"operationalWorkItem">,
          metadata: {
            businessDate: "2026-07-01",
            decisionApprovalProofId: "proof-should-not-leave-server",
            hiddenFinancialEvidence: "card-token-should-not-leave-server",
            internalPayload: { raw: true },
            managerProofId: "manager-proof-should-not-leave-server",
          },
          type: "daily_close_carry_forward",
        }),
        workItem({
          _id: "work-inventory-review" as Id<"operationalWorkItem">,
          metadata: {
            localRegisterSessionId: "local-session-1",
            localTransactionId: "local-txn-1",
            primaryProductSkuId: "sku-1",
            receiptNumber: "939540",
            registerSessionId: "register-session-1",
            skippedMutationItems: [{ productSkuId: "sku-1" }],
            sourceId: "transaction-1",
            sourceType: "posTransaction",
            terminalId: "terminal-1",
          },
          type: "synced_sale_inventory_review",
        }),
        workItem({
          _id: "work-pending-checkout" as Id<"operationalWorkItem">,
          metadata: {
            lookupCode: "hodor",
            pendingCheckoutItemId: "pending-checkout-1",
            price: 55000,
            provisionalProductId: "product-pending-1",
            provisionalProductSkuId: "sku-pending-1",
            rawPendingCheckoutPayload: { shouldNotLeak: true },
            totalQuantitySold: 6,
          },
          type: "pos_pending_checkout_item_review",
        }),
      ],
    });

    const result = await getHandler(getQueueSnapshot)(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(result.workItems).toEqual([
      expect.objectContaining({
        _id: "work-carry-forward",
        details: { businessDate: "2026-07-01", followUpReason: null },
      }),
      expect.objectContaining({
        _id: "work-pending-checkout",
        details: {
          lookupCode: "hodor",
          price: 55000,
          provisionalProductId: "product-pending-1",
          provisionalProductSkuId: "sku-pending-1",
          quantitySold: null,
          totalQuantitySold: 6,
        },
      }),
      expect.objectContaining({
        _id: "work-inventory-review",
        details: expect.objectContaining({
          inventoryReviewLineCount: 1,
          localRegisterSessionId: "local-session-1",
          localTransactionId: "local-txn-1",
          primaryProductSkuId: "sku-1",
          receiptNumber: "939540",
          registerSessionId: "register-session-1",
          sourceId: "transaction-1",
          terminalId: "terminal-1",
        }),
      }),
    ]);
    expect(JSON.stringify(result.workItems)).not.toContain("metadata");
    expect(JSON.stringify(result.workItems)).not.toContain(
      "proof-should-not-leave-server",
    );
    expect(JSON.stringify(result.workItems)).not.toContain(
      "card-token-should-not-leave-server",
    );
    expect(JSON.stringify(result.workItems)).not.toContain(
      "rawPendingCheckoutPayload",
    );
  });

  it("surfaces legacy service deposit approvals while suppressing unsupported work items", async () => {
    const ctx = createQueueContext({
      approvalRequests: [
        approvalRequest({
          _id: "approval-service-deposit" as Id<"approvalRequest">,
          requestType: "service_deposit_review",
        }),
        approvalRequest({
          _id: "approval-variance" as Id<"approvalRequest">,
          requestType: "variance_review",
        }),
      ],
      workItems: [
        workItem({
          _id: "work-service-deposit" as Id<"operationalWorkItem">,
          type: "service_deposit_review",
        }),
        workItem({
          _id: "work-service-case" as Id<"operationalWorkItem">,
          type: "service_case",
        }),
      ],
    });

    const result = await getHandler(getQueueSnapshot)(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(result.workItems.map((item: QueueTestRow) => item._id)).toEqual([
      "work-service-case",
    ]);
    expect(
      result.approvalRequests.map((request: QueueTestRow) => request._id),
    ).toEqual(["approval-service-deposit", "approval-variance"]);
    expect(result.overflow.approvalRequests).toBe(false);
  });

  it("omits POS pending checkout review items when their provisional product is archived", async () => {
    const ctx = createQueueContext({
      products: [
        {
          _id: "product-live" as Id<"product">,
          availability: "live",
          storeId: "store-1" as Id<"store">,
        },
        {
          _id: "product-archived" as Id<"product">,
          availability: "archived",
          storeId: "store-1" as Id<"store">,
        },
      ],
      workItems: [
        workItem({
          _id: "work-live-pending-checkout" as Id<"operationalWorkItem">,
          metadata: {
            pendingCheckoutItemId: "pending-checkout-live",
            provisionalProductId: "product-live",
          },
          title: "Review pending checkout item: Live item",
          type: "pos_pending_checkout_item_review",
        }),
        workItem({
          _id: "work-archived-pending-checkout" as Id<"operationalWorkItem">,
          metadata: {
            pendingCheckoutItemId: "pending-checkout-archived",
            provisionalProductId: "product-archived",
          },
          title: "Review pending checkout item: Archived item",
          type: "pos_pending_checkout_item_review",
        }),
        workItem({
          _id: "work-service-case" as Id<"operationalWorkItem">,
          title: "Service case",
          type: "service_case",
        }),
      ],
    });

    const result = await getHandler(getQueueSnapshot)(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(result.workItems.map((item: QueueTestRow) => item._id)).toEqual([
      "work-live-pending-checkout",
      "work-service-case",
    ]);
  });

  it("surfaces supported return and legacy item adjustment approvals", async () => {
    const ctx = createQueueContext({
      approvalRequests: [
        approvalRequest({
          _id: "approval-online-return" as Id<"approvalRequest">,
          createdAt: 20,
          requestType: "online_order_return_review",
          subjectId: "return-1",
          subjectType: "online_order_return",
        }),
        approvalRequest({
          _id: "approval-legacy-item-adjustment" as Id<"approvalRequest">,
          createdAt: 10,
          metadata: {
            transactionId: "transaction-1",
          },
          requestType: "pos_item_adjustment_review",
          subjectId: "adjustment-1",
          subjectType: "pos_item_adjustment",
        }),
        approvalRequest({
          _id: "approval-service-deposit" as Id<"approvalRequest">,
          createdAt: 30,
          requestType: "service_deposit_review",
        }),
      ],
    });

    const result = await getHandler(getQueueSnapshot)(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(
      result.approvalRequests.map((request: QueueTestRow) => request._id),
    ).toEqual([
      "approval-service-deposit",
      "approval-online-return",
      "approval-legacy-item-adjustment",
    ]);
    expect(
      result.approvalRequests.map(
        (request: QueueTestRow) => request.requestType,
      ),
    ).toEqual([
      "service_deposit_review",
      "online_order_return_review",
      "pos_item_adjustment_review",
    ]);
  });

  it("does not let unsupported legacy rows starve supported queue lanes", async () => {
    const unsupportedWorkItems = Array.from(
      { length: TEST_MAX_QUEUE_ITEMS * 3 },
      (_value, index) =>
        workItem({
          _id: `work-service-deposit-${index}` as Id<"operationalWorkItem">,
          createdAt: index,
          type: "service_deposit_review",
        }),
    );
    const unsupportedApprovalRequests = Array.from(
      { length: TEST_MAX_QUEUE_ITEMS * 3 },
      (_value, index) =>
        approvalRequest({
          _id: `approval-service-deposit-${index}` as Id<"approvalRequest">,
          createdAt: index,
          requestType: "service_deposit_review",
          subjectId: `service-deposit-${index}`,
        }),
    );
    const ctx = createQueueContext({
      approvalRequests: [
        ...unsupportedApprovalRequests,
        approvalRequest({
          _id: "approval-variance" as Id<"approvalRequest">,
          createdAt: 1_000,
          requestType: "variance_review",
        }),
      ],
      workItems: [
        ...unsupportedWorkItems,
        workItem({
          _id: "work-service-case" as Id<"operationalWorkItem">,
          createdAt: 1_000,
          type: "service_case",
        }),
      ],
    });

    const result = await getHandler(getQueueSnapshot)(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(result.workItems.map((item: QueueTestRow) => item._id)).toEqual([
      "work-service-case",
    ]);
    expect(
      result.approvalRequests.map((request: QueueTestRow) => request._id),
    ).toContain("approval-variance");
    expect(result.overflow.approvalRequests).toBe(true);
    expect(result.overflow.workItems.open).toBe(false);
  });

  it("orders work items by bucket, status urgency, actionable timestamp, source identity, then id", async () => {
    const ctx = createQueueContext({
      workItems: [
        workItem({
          _id: "work-catalog-taxonomy" as Id<"operationalWorkItem">,
          createdAt: 40,
          metadata: {
            categorySlug: "legacy-import",
            productId: "product-1",
            productName: "Packaging Rubber",
            productSkuId: "sku-1",
            sku: "6N2Y-PKG-RBR",
            subcategorySlug: "472",
          },
          status: "open",
          type: "catalog_taxonomy_setup",
        }),
        workItem({
          _id: "work-purchase-z" as Id<"operationalWorkItem">,
          createdAt: 5,
          metadata: { purchaseOrderId: "po-z" },
          status: "open",
          type: "purchase_order",
        }),
        workItem({
          _id: "work-purchase-a" as Id<"operationalWorkItem">,
          createdAt: 5,
          metadata: { purchaseOrderId: "po-a" },
          status: "open",
          type: "purchase_order",
        }),
        workItem({
          _id: "work-synced-open" as Id<"operationalWorkItem">,
          createdAt: 1,
          metadata: {
            localRegisterSessionId: "local-session-1",
            localTransactionId: "txn-open",
            terminalId: "terminal-1",
          },
          status: "open",
          type: "synced_sale_inventory_review",
        }),
        workItem({
          _id: "work-synced-in-progress" as Id<"operationalWorkItem">,
          createdAt: 20,
          metadata: {
            localRegisterSessionId: "local-session-2",
            localTransactionId: "txn-progress",
            terminalId: "terminal-1",
          },
          startedAt: 30,
          status: "in_progress",
          type: "synced_sale_inventory_review",
        }),
        workItem({
          _id: "work-adjustment-approval" as Id<"operationalWorkItem">,
          approvalRequestId: "approval-stock" as Id<"approvalRequest">,
          approvalState: "pending",
          createdAt: 50,
          metadata: { stockAdjustmentBatchId: "batch-1" },
          status: "open",
          type: "stock_adjustment_review",
        }),
      ],
    });

    const result = await getHandler(getQueueSnapshot)(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(result.workItems.map((item: QueueTestRow) => item._id)).toEqual([
      "work-catalog-taxonomy",
      "work-adjustment-approval",
      "work-synced-in-progress",
      "work-synced-open",
      "work-purchase-a",
      "work-purchase-z",
    ]);
    expect(result.workItems[0]).toMatchObject({
      details: {
        categorySlug: "legacy-import",
        productId: "product-1",
        productName: "Packaging Rubber",
        productSkuId: "sku-1",
        sku: "6N2Y-PKG-RBR",
        subcategorySlug: "472",
      },
      sourceIdentity: "catalog_taxonomy_setup:product-1",
    });
    expect(JSON.stringify(result.workItems[0])).not.toContain("metadata");
  });

  it("returns explicit overflow metadata when open, in-progress, or approval lanes exceed the queue cap", async () => {
    const openItems = Array.from(
      { length: TEST_MAX_QUEUE_ITEMS + 1 },
      (_value, index) =>
        workItem({
          _id: `work-open-${String(index).padStart(3, "0")}` as Id<"operationalWorkItem">,
          createdAt: index,
          metadata: { sourceId: `open-${index}` },
          status: "open",
        }),
    );
    const inProgressItems = Array.from(
      { length: TEST_MAX_QUEUE_ITEMS + 1 },
      (_value, index) =>
        workItem({
          _id: `work-in-progress-${String(index).padStart(3, "0")}` as Id<"operationalWorkItem">,
          createdAt: index,
          metadata: { sourceId: `in-progress-${index}` },
          status: "in_progress",
        }),
    );
    const pendingApprovals = Array.from(
      { length: TEST_MAX_QUEUE_ITEMS + 1 },
      (_value, index) =>
        approvalRequest({
          _id: `approval-${String(index).padStart(3, "0")}` as Id<"approvalRequest">,
          createdAt: index,
          subjectId: `approval-subject-${index}`,
        }),
    );
    const ctx = createQueueContext({
      approvalRequests: pendingApprovals,
      workItems: [...openItems, ...inProgressItems],
    });

    const result = await getHandler(getQueueSnapshot)(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(result.overflow).toEqual({
      approvalRequests: true,
      workItems: { inProgress: true, open: true },
    });
    expect(result.workItems).toHaveLength(TEST_MAX_QUEUE_ITEMS);
    expect(result.approvalRequests).toHaveLength(TEST_MAX_QUEUE_ITEMS);
  });

  it("marks overflow when exact status-cap lanes combine beyond the display cap", async () => {
    const openItems = Array.from(
      { length: TEST_MAX_QUEUE_ITEMS },
      (_value, index) =>
        workItem({
          _id: `work-open-exact-${String(index).padStart(3, "0")}` as Id<"operationalWorkItem">,
          createdAt: index,
          metadata: { sourceId: `open-exact-${index}` },
          status: "open",
        }),
    );
    const inProgressItems = Array.from(
      { length: TEST_MAX_QUEUE_ITEMS },
      (_value, index) =>
        workItem({
          _id: `work-progress-exact-${String(index).padStart(3, "0")}` as Id<"operationalWorkItem">,
          createdAt: index,
          metadata: { sourceId: `progress-exact-${index}` },
          status: "in_progress",
        }),
    );
    const pendingApprovals = Array.from(
      { length: TEST_MAX_QUEUE_ITEMS },
      (_value, index) =>
        approvalRequest({
          _id: `approval-exact-${String(index).padStart(3, "0")}` as Id<"approvalRequest">,
          createdAt: index,
          subjectId: `approval-exact-subject-${index}`,
        }),
    );
    const ctx = createQueueContext({
      approvalRequests: pendingApprovals,
      workItems: [...openItems, ...inProgressItems],
    });

    const result = await getHandler(getQueueSnapshot)(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(result.overflow).toEqual({
      approvalRequests: false,
      workItems: { inProgress: false, open: true },
    });
    expect(result.workItems).toHaveLength(TEST_MAX_QUEUE_ITEMS);
    expect(result.approvalRequests).toHaveLength(TEST_MAX_QUEUE_ITEMS);
  });

  it("keeps high-priority work on the first page even when inserted beyond the display cap", async () => {
    const lowPriorityItems = Array.from(
      { length: TEST_MAX_QUEUE_ITEMS },
      (_value, index) =>
        workItem({
          _id: `work-low-${String(index).padStart(3, "0")}` as Id<"operationalWorkItem">,
          createdAt: index,
          metadata: { purchaseOrderId: `po-${String(index).padStart(3, "0")}` },
          priority: "normal",
          status: "open",
          type: "purchase_order",
        }),
    );
    const ctx = createQueueContext({
      workItems: [
        ...lowPriorityItems,
        workItem({
          _id: "work-high-review" as Id<"operationalWorkItem">,
          approvalRequestId: "approval-stock" as Id<"approvalRequest">,
          approvalState: "pending",
          createdAt: 999,
          metadata: { stockAdjustmentBatchId: "batch-late" },
          priority: "high",
          status: "open",
          type: "stock_adjustment_review",
        }),
      ],
    });

    const result = await getHandler(getQueueSnapshot)(ctx, {
      storeId: "store-1" as Id<"store">,
    });
    const returnedIds = result.workItems.map((item: QueueTestRow) => item._id);

    expect(returnedIds).toHaveLength(TEST_MAX_QUEUE_ITEMS);
    expect(returnedIds[0]).toBe("work-high-review");
    expect(returnedIds).toContain("work-low-098");
    expect(returnedIds).not.toContain("work-low-099");
  });

  it("keeps high-priority work from another supported lane past an overloaded low-priority lane", async () => {
    const lowPriorityItems = Array.from(
      { length: TEST_MAX_QUEUE_ITEMS + 1 },
      (_value, index) =>
        workItem({
          _id: `work-low-service-${String(index).padStart(3, "0")}` as Id<"operationalWorkItem">,
          createdAt: index,
          priority: "normal",
          status: "open",
          type: "service_case",
        }),
    );
    const ctx = createQueueContext({
      workItems: [
        ...lowPriorityItems,
        workItem({
          _id: "work-high-stock-adjustment" as Id<"operationalWorkItem">,
          approvalRequestId: "approval-stock" as Id<"approvalRequest">,
          approvalState: "pending",
          createdAt: 2_000,
          metadata: { stockAdjustmentBatchId: "batch-late" },
          priority: "high",
          status: "open",
          type: "stock_adjustment_review",
        }),
      ],
    });

    const result = await getHandler(getQueueSnapshot)(ctx, {
      storeId: "store-1" as Id<"store">,
    });
    const returnedIds = result.workItems.map((item: QueueTestRow) => item._id);

    expect(returnedIds).toHaveLength(TEST_MAX_QUEUE_ITEMS);
    expect(returnedIds[0]).toBe("work-high-stock-adjustment");
    expect(result.overflow.workItems.open).toBe(true);
  });

  it("returns truthful totals and selected-type cards beyond the all-work cap", async () => {
    const ctx = createQueueContext({
      workItems: [
        ...Array.from({ length: TEST_MAX_QUEUE_ITEMS + 1 }, (_, index) =>
          workItem({
            _id: `catalog-${index}` as Id<"operationalWorkItem">,
            metadata: { productId: `product-${index}` },
            type: "catalog_taxonomy_setup",
          }),
        ),
        workItem({
          _id: "service-hidden-from-all-cap" as Id<"operationalWorkItem">,
          type: "service_case",
        }),
      ],
    });

    const result = await getHandler(getQueueSnapshot)(ctx, {
      storeId: "store-1" as Id<"store">,
      workType: "service_case",
    });

    expect(result.workItems).toEqual([
      expect.objectContaining({ _id: "service-hidden-from-all-cap" }),
    ]);
    expect(result.workItemSummary).toMatchObject({
      completeness: "complete",
      count: 102,
      byType: expect.arrayContaining([
        expect.objectContaining({
          completeness: "complete",
          count: 101,
          type: "catalog_taxonomy_setup",
        }),
        expect.objectContaining({
          completeness: "complete",
          count: 1,
          type: "service_case",
        }),
      ]),
    });
  });

  it("keeps a selected synced-sale type exact when an unrelated lane is incomplete", async () => {
    const ctx = createQueueContext({
      workItems: [
        ...Array.from({ length: 1_001 }, (_, index) =>
          workItem({
            _id: `service-${index}` as Id<"operationalWorkItem">,
            type: "service_case",
          }),
        ),
        workItem({
          _id: "synced-review" as Id<"operationalWorkItem">,
          productSkuId: "sku-1" as Id<"productSku">,
          type: "synced_sale_inventory_review",
        }),
      ],
    });

    const result = await getHandler(getQueueSnapshot)(ctx, {
      storeId: "store-1" as Id<"store">,
      workType: "synced_sale_inventory_review",
    });

    expect(result.workItems[0]).toMatchObject({
      _id: "synced-review",
      logicalGroup: {
        completeness: "complete",
        resolutionAvailability: "available",
      },
    });
    expect(result.workItemSummary).toMatchObject({
      completeness: "incomplete",
      byType: expect.arrayContaining([
        expect.objectContaining({
          completeness: "complete",
          count: 1,
          type: "synced_sale_inventory_review",
        }),
      ]),
    });
  });

  it("fails synced-sale work closed when active repair membership is capped", async () => {
    const ctx = createQueueContext({
      oversizedRepairs: Array.from({ length: 1_001 }, (_, index) => ({
        _id: `repair-${index}`,
        groupKey: `synced_sale_inventory_review:store-1:sku-${index}`,
        sourceIdentities: [`source-${index}`],
        status: "pending",
        storeId: "store-1",
      })),
      workItems: [
        workItem({
          _id: "synced-review" as Id<"operationalWorkItem">,
          productSkuId: "sku-live" as Id<"productSku">,
          type: "synced_sale_inventory_review",
        }),
      ],
    });

    const result = await getHandler(getQueueSnapshot)(ctx, {
      storeId: "store-1" as Id<"store">,
      workType: "synced_sale_inventory_review",
    });

    expect(result.workItems[0].logicalGroup).toMatchObject({
      completeness: "incomplete",
      memberIds: [],
      members: [],
      resolutionAvailability: "source_incomplete",
    });
    expect(result.workItemSummary.byType).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          completeness: "incomplete",
          type: "synced_sale_inventory_review",
        }),
      ]),
    );
  });

  it("exposes source identities while only collapsing synced-sale aliases", async () => {
    const ctx = createQueueContext({
      workItems: [
        workItem({
          _id: "work-synced-a" as Id<"operationalWorkItem">,
          createdAt: 1,
          metadata: {
            localRegisterSessionId: "local-session-1",
            localTransactionId: "txn-1",
            terminalId: "terminal-1",
          },
          type: "synced_sale_inventory_review",
        }),
        workItem({
          _id: "work-synced-b" as Id<"operationalWorkItem">,
          createdAt: 2,
          metadata: {
            localRegisterSessionId: "local-session-1",
            localTransactionId: "txn-1",
            terminalId: "terminal-1",
          },
          type: "synced_sale_inventory_review",
        }),
        workItem({
          _id: "work-pending-checkout-a" as Id<"operationalWorkItem">,
          createdAt: 3,
          metadata: { posPendingCheckoutItemId: "pending-checkout-1" },
          type: "pos_pending_checkout_item_review",
        }),
        workItem({
          _id: "work-pending-checkout-b" as Id<"operationalWorkItem">,
          createdAt: 4,
          metadata: { posPendingCheckoutItemId: "pending-checkout-1" },
          type: "pos_pending_checkout_item_review",
        }),
        workItem({
          _id: "work-service-appointment" as Id<"operationalWorkItem">,
          createdAt: 5,
          metadata: { appointmentId: "appointment-1" },
          type: "service_appointment",
        }),
        workItem({
          _id: "work-purchase-order" as Id<"operationalWorkItem">,
          createdAt: 6,
          metadata: { purchaseOrderId: "purchase-order-1" },
          type: "purchase_order",
        }),
        workItem({
          _id: "work-daily-carry-forward" as Id<"operationalWorkItem">,
          createdAt: 7,
          metadata: {
            businessDate: "2026-07-01",
            carryForwardSourceId: "carry-forward-1",
          },
          type: "daily_close_carry_forward",
        }),
      ],
    });

    const result = await getHandler(getQueueSnapshot)(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(result.workItems).toHaveLength(6);
    expect(
      result.workItems.map((item: QueueTestRow) => [
        item._id,
        item.sourceIdentity,
      ]),
    ).toEqual([
      [
        "work-pending-checkout-a",
        "pos_pending_checkout_item_review:pending-checkout-1",
      ],
      [
        "work-pending-checkout-b",
        "pos_pending_checkout_item_review:pending-checkout-1",
      ],
      [
        "work-daily-carry-forward",
        "daily_close_carry_forward:2026-07-01:carry-forward-1",
      ],
      [
        "work-synced-a",
        "synced_sale_inventory_review:store-1:terminal-1:local-session-1:txn-1",
      ],
      ["work-service-appointment", "service_appointment:appointment-1"],
      ["work-purchase-order", "purchase_order:purchase-order-1"],
    ]);
    expect(result.workItems[3]).toMatchObject({
      logicalGroup: {
        key: "synced_sale_inventory_review:store-1:terminal-1:local-session-1:txn-1",
        memberIds: ["work-synced-a", "work-synced-b"],
        resolutionAvailability: "available",
      },
    });
  });

  it("returns one sanitized logical queue row for same-SKU sources before the display cap", async () => {
    const ctx = createQueueContext({
      workItems: [
        workItem({
          _id: "review-a" as Id<"operationalWorkItem">,
          metadata: {
            localTransactionId: "transaction-a",
            primaryProductSkuId: "sku-1",
            rawFinancialEvidence: { secret: true },
          },
          productSkuId: "sku-1" as Id<"productSku">,
          type: "synced_sale_inventory_review",
        }),
        workItem({
          _id: "review-b" as Id<"operationalWorkItem">,
          createdAt: 2,
          metadata: {
            localTransactionId: "transaction-b",
            primaryProductSkuId: "sku-1",
            proofId: "hidden-proof",
          },
          productSkuId: "sku-1" as Id<"productSku">,
          type: "synced_sale_inventory_review",
        }),
      ],
    });

    const result = await getHandler(getQueueSnapshot)(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(result.workItems).toHaveLength(1);
    expect(result.workItems[0]).toMatchObject({
      _id: "review-a",
      logicalGroup: {
        key: "synced_sale_inventory_review:store-1:sku-1",
        memberIds: ["review-a", "review-b"],
        members: [
          expect.objectContaining({ _id: "review-a" }),
          expect.objectContaining({ _id: "review-b" }),
        ],
        resolutionAvailability: "available",
      },
    });
    expect(JSON.stringify(result.workItems)).not.toContain("hidden-proof");
    expect(JSON.stringify(result.workItems)).not.toContain(
      "rawFinancialEvidence",
    );
  });

  it("prefers the synced sale resolver row with an affected SKU when duplicate current rows exist", async () => {
    const ctx = createQueueContext({
      workItems: [
        workItem({
          _id: "work-synced-incomplete" as Id<"operationalWorkItem">,
          createdAt: 1,
          metadata: {
            localRegisterSessionId: "local-session-1",
            localTransactionId: "txn-1",
            terminalId: "terminal-1",
          },
          type: "synced_sale_inventory_review",
        }),
        workItem({
          _id: "work-synced-complete" as Id<"operationalWorkItem">,
          createdAt: 2,
          metadata: {
            localRegisterSessionId: "local-session-1",
            localTransactionId: "txn-1",
            primaryProductSkuId: "sku-1",
            registerSessionId: "register-session-1",
            sourceId: "transaction-1",
            sourceType: "posTransaction",
            terminalId: "terminal-1",
          },
          type: "synced_sale_inventory_review",
        }),
      ],
    });

    const result = await getHandler(getQueueSnapshot)(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(result.workItems).toEqual([
      expect.objectContaining({
        _id: "work-synced-complete",
        details: expect.objectContaining({
          primaryProductSkuId: "sku-1",
        }),
      }),
    ]);
  });

  it("dedupes current lane probes before the queue cap hides rows with affected SKUs", async () => {
    const incompleteDuplicates = Array.from(
      { length: TEST_MAX_QUEUE_ITEMS + 1 },
      (_, index) =>
        workItem({
          _id: `work-synced-incomplete-${index}` as Id<"operationalWorkItem">,
          createdAt: index + 1,
          metadata: {
            localRegisterSessionId: "local-session-1",
            localTransactionId: "txn-1",
            terminalId: "terminal-1",
          },
          type: "synced_sale_inventory_review",
        }),
    );
    const ctx = createQueueContext({
      workItems: [
        ...incompleteDuplicates,
        workItem({
          _id: "work-synced-complete" as Id<"operationalWorkItem">,
          createdAt: TEST_MAX_QUEUE_ITEMS + 2,
          metadata: {
            localRegisterSessionId: "local-session-1",
            localTransactionId: "txn-1",
            primaryProductSkuId: "sku-1",
            registerSessionId: "register-session-1",
            sourceId: "transaction-1",
            sourceType: "posTransaction",
            terminalId: "terminal-1",
          },
          type: "synced_sale_inventory_review",
        }),
      ],
    });

    const result = await getHandler(getQueueSnapshot)(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(result.workItems).toEqual([
      expect.objectContaining({
        _id: "work-synced-complete",
        details: expect.objectContaining({
          primaryProductSkuId: "sku-1",
        }),
      }),
    ]);
    expect(result.overflow.workItems.open).toBe(true);
  });

  it("normalizes item adjustment approval payloads for the operations queue", async () => {
    const approvalRequest = {
      _id: "approval-1" as Id<"approvalRequest">,
      createdAt: 10,
      metadata: {
        correctedTotal: 15000,
        deltaTotal: -5000,
        originalTotal: 20000,
        payload: {
          lines: [
            {
              adjustedQuantity: 1,
              inventoryDelta: 1,
              originalQuantity: 2,
              productName: "Closure wig",
              productSku: "CW-18",
              productSkuId: "sku-1" as Id<"productSku">,
            },
          ],
        },
        settlementAmount: 5000,
        settlementDirection: "refund",
        settlementMethod: "cash",
        transactionId: "txn-1" as Id<"posTransaction">,
        transactionNumber: "434898",
      },
      posTransactionId: "txn-1" as Id<"posTransaction">,
      requestType: "pos_item_adjustment",
      status: "pending",
      storeId: "store-1" as Id<"store">,
      subjectId: "pos_transaction_item_adjustment:txn-1:fingerprint",
      subjectType: "pos_transaction_item_adjustment",
    };
    const ctx = {
      db: {
        get: vi.fn(async (tableName: string, id: string) => {
          if (tableName === "store" && id === "store-1") {
            return { _id: "store-1", organizationId: "org-1" };
          }
          if (tableName === "posTransaction" && id === "txn-1") {
            return {
              _id: "txn-1",
              completedAt: 1,
              paymentMethod: "cash",
              total: 20000,
              totalPaid: 20000,
              transactionNumber: "434898",
            };
          }
          return null;
        }),
        query: vi.fn((tableName: string) => ({
          withIndex: vi.fn((_indexName: string, callback: Function) => {
            const constraints = new Map<string, unknown>();
            const queryBuilder = {
              eq(fieldName: string, value: unknown) {
                constraints.set(fieldName, value);
                return queryBuilder;
              },
            };
            callback(queryBuilder);
            const rows =
              tableName === "approvalRequest" &&
              Array.from(constraints.entries()).every(
                ([fieldName, value]) =>
                  (approvalRequest as QueueTestRow)[fieldName] === value,
              )
                ? [approvalRequest]
                : [];

            return {
              collect: vi.fn(async () => {
                return rows;
              }),
              take: vi.fn(async () => {
                return rows;
              }),
            };
          }),
        })),
      },
    };

    const result = await getHandler(getQueueSnapshot)(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).toHaveBeenCalledWith(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage: "Only POS operators can view approval queue.",
      organizationId: "org-1",
      userId: "user-1",
    });
    expect(result.approvalRequests).toEqual([
      expect.objectContaining({
        _id: "approval-1",
        metadata: expect.objectContaining({
          adjustedTotal: 15000,
          lineItems: [
            expect.objectContaining({
              adjustedQuantity: 1,
              originalQuantity: 2,
              productName: "Closure wig",
              quantityDelta: -1,
              sku: "CW-18",
            }),
          ],
          totalDelta: -5000,
        }),
        transactionSummary: expect.objectContaining({
          transactionId: "txn-1",
          transactionNumber: "434898",
        }),
      }),
    ]);
  });

  it("links completed sale void approvals to the transaction summary", async () => {
    const approvalRequest = {
      _id: "approval-void-1" as Id<"approvalRequest">,
      createdAt: 10,
      requestType: "pos_transaction_void",
      requestedByStaffProfileId: "staff-1" as Id<"staffProfile">,
      status: "pending",
      storeId: "store-1" as Id<"store">,
      subjectId: "txn-void-1" as Id<"posTransaction">,
      subjectType: "pos_transaction",
    };
    const ctx = {
      db: {
        get: vi.fn(async (tableName: string, id: string) => {
          if (tableName === "store" && id === "store-1") {
            return { _id: "store-1", organizationId: "org-1" };
          }
          if (tableName === "staffProfile" && id === "staff-1") {
            return { _id: "staff-1", fullName: "Skank Hunt" };
          }
          if (tableName === "posTransaction" && id === "txn-void-1") {
            return {
              _id: "txn-void-1",
              completedAt: 1,
              paymentMethod: "cash",
              registerSessionId: "register-session-1",
              total: 396000,
              totalPaid: 396000,
              transactionNumber: "158503",
            };
          }
          if (tableName === "registerSession" && id === "register-session-1") {
            return {
              _id: "register-session-1",
              countedCash: null,
              expectedCash: 50000,
              registerNumber: "8",
              status: "closed",
              storeId: "store-1",
              terminalId: "terminal-1",
            };
          }
          if (tableName === "posTerminal" && id === "terminal-1") {
            return { _id: "terminal-1", displayName: "Codex" };
          }
          return null;
        }),
        query: vi.fn((tableName: string) => ({
          withIndex: vi.fn((_indexName: string, callback: Function) => {
            const constraints = new Map<string, unknown>();
            const queryBuilder = {
              eq(fieldName: string, value: unknown) {
                constraints.set(fieldName, value);
                return queryBuilder;
              },
            };
            callback(queryBuilder);
            const rows =
              tableName === "approvalRequest" &&
              Array.from(constraints.entries()).every(
                ([fieldName, value]) =>
                  (approvalRequest as QueueTestRow)[fieldName] === value,
              )
                ? [approvalRequest]
                : [];

            return {
              collect: vi.fn(async () => {
                return rows;
              }),
              take: vi.fn(async () => {
                return rows;
              }),
            };
          }),
        })),
      },
    };

    const result = await getHandler(getQueueSnapshot)(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(result.approvalRequests).toEqual([
      expect.objectContaining({
        _id: "approval-void-1",
        requestType: "pos_transaction_void",
        requestedByStaffName: "Skank Hunt",
        transactionSummary: expect.objectContaining({
          paymentMethod: "cash",
          total: 396000,
          transactionId: "txn-void-1",
          transactionNumber: "158503",
        }),
        registerSessionSummary: expect.objectContaining({
          registerNumber: "8",
          registerSessionId: "register-session-1",
          terminalName: "Codex",
        }),
      }),
    ]);
  });

  it("surfaces register sync conflicts as pending approval work", async () => {
    const ctx = {
      db: {
        get: vi.fn(async (tableName: string, id: string) => {
          if (tableName === "store" && id === "store-1") {
            return { _id: "store-1", organizationId: "org-1" };
          }
          if (tableName === "registerSession" && id === "session-1") {
            return {
              _id: "session-1",
              countedCash: null,
              expectedCash: 50000,
              registerNumber: "2",
              status: "active",
              storeId: "store-1",
              terminalId: "terminal-1",
            };
          }
          if (tableName === "posTerminal" && id === "terminal-1") {
            return { _id: "terminal-1", displayName: "Wigshop" };
          }
          return null;
        }),
        query: vi.fn((tableName: string) => ({
          withIndex: vi.fn(() => ({
            collect: vi.fn(async () => {
              if (tableName === "posLocalSyncConflict") {
                return [];
              }
              return [];
            }),
            take: vi.fn(async () => {
              if (tableName === "posLocalSyncConflict") {
                return [
                  {
                    _id: "sync-conflict-1",
                    conflictType: "permission",
                    createdAt: 20,
                    localEventId: "event-sale-completed-1",
                    localRegisterSessionId: "local-session-1",
                    sequence: 2,
                    status: "needs_review",
                    storeId: "store-1",
                    summary: "Register was not open before this sale synced.",
                    terminalId: "terminal-1",
                  },
                ];
              }
              return [];
            }),
            unique: vi.fn(async () => {
              if (tableName === "posLocalSyncMapping") {
                return {
                  cloudId: "session-1",
                  cloudTable: "registerSession",
                };
              }
              return null;
            }),
          })),
        })),
      },
    };

    const result = await getHandler(getQueueSnapshot)(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(result.approvalRequests).toEqual([
      expect.objectContaining({
        _id: "register-sync-review:session-1",
        metadata: expect.objectContaining({
          conflictCount: 1,
          reviewItems: [
            expect.objectContaining({
              id: "sync-conflict-1",
              sequence: 2,
              type: "permission",
            }),
          ],
        }),
        registerSessionSummary: expect.objectContaining({
          registerNumber: "2",
          registerSessionId: "session-1",
          terminalName: "Wigshop",
        }),
        requestType: "register_sync_review",
        subjectType: "register_session_sync_review",
        workItemTitle: "Synced register activity review",
      }),
    ]);
  });
});

import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

import {
  bestEffortRecordPurchaseOrderReceivingTraceWithCtx,
  bestEffortRecordPurchaseOrderStatusTraceWithCtx,
} from "./purchaseOrderTracing";

type TableName = "workflowTrace" | "workflowTraceEvent" | "workflowTraceLookup";

function createWorkflowTraceCtx(args?: { failInserts?: boolean }) {
  const tables: Record<TableName, Map<string, Record<string, any>>> = {
    workflowTrace: new Map(),
    workflowTraceEvent: new Map(),
    workflowTraceLookup: new Map(),
  };
  const counters: Record<TableName, number> = {
    workflowTrace: 0,
    workflowTraceEvent: 0,
    workflowTraceLookup: 0,
  };

  const ctx = {
    db: {
      async get(table: TableName, id: string) {
        return tables[table].get(id) ?? null;
      },
      async insert(table: TableName, value: Record<string, any>) {
        if (args?.failInserts) {
          throw new Error("trace insert failed");
        }

        counters[table] += 1;
        const id = `${table}-${counters[table]}`;
        tables[table].set(id, { _id: id, ...value });
        return id;
      },
      async patch(table: TableName, id: string, value: Record<string, any>) {
        const existing = tables[table].get(id);

        if (!existing) {
          throw new Error(`Missing ${table} record: ${id}`);
        }

        tables[table].set(id, { ...existing, ...value });
      },
      query(table: TableName) {
        return {
          withIndex(
            _index: string,
            applyIndex: (queryBuilder: {
              eq: (field: string, value: unknown) => unknown;
            }) => unknown,
          ) {
            const filters: Array<[string, unknown]> = [];
            const queryBuilder = {
              eq(field: string, value: unknown) {
                filters.push([field, value]);
                return queryBuilder;
              },
            };

            applyIndex(queryBuilder);

            const matches = () =>
              Array.from(tables[table].values()).filter((record) =>
                filters.every(([field, value]) => record[field] === value),
              );

            return {
              collect: async () => matches(),
              first: async () => matches()[0] ?? null,
              order(direction: "asc" | "desc") {
                return {
                  first: async () => {
                    const sorted = matches().sort(
                      (left, right) =>
                        (left.sequence ?? 0) - (right.sequence ?? 0),
                    );
                    return direction === "desc"
                      ? (sorted.at(-1) ?? null)
                      : (sorted[0] ?? null);
                  },
                };
              },
              unique: async () => matches()[0] ?? null,
            };
          },
        };
      },
    },
  } as unknown as MutationCtx;

  return { ctx, tables };
}

describe("purchase-order workflow tracing", () => {
  const purchaseOrder = {
    _id: "po_1" as Id<"purchaseOrder">,
    cancelledAt: undefined,
    createdAt: 100,
    operationalWorkItemId: "work_1" as Id<"operationalWorkItem">,
    organizationId: "org_1" as Id<"organization">,
    poNumber: "PO-001",
    receivedAt: undefined,
    status: "ordered",
    storeId: "store_1" as Id<"store">,
    vendorId: "vendor_1" as Id<"vendor">,
  };

  it("uses stable event keys so replayed status milestones are idempotent", async () => {
    const { ctx, tables } = createWorkflowTraceCtx();

    await bestEffortRecordPurchaseOrderStatusTraceWithCtx(ctx, {
      actorUserId: "user_1" as Id<"athenaUser">,
      nextStatus: "ordered",
      occurredAt: 200,
      previousStatus: "approved",
      purchaseOrder,
    });
    await bestEffortRecordPurchaseOrderStatusTraceWithCtx(ctx, {
      actorUserId: "user_1" as Id<"athenaUser">,
      nextStatus: "ordered",
      occurredAt: 201,
      previousStatus: "approved",
      purchaseOrder,
    });

    expect(Array.from(tables.workflowTrace.values())).toHaveLength(1);
    expect(Array.from(tables.workflowTraceEvent.values())).toEqual([
      expect.objectContaining({
        eventKey: "purchase_order_status:po_1:ordered",
        sequence: 1,
        subjectRefs: expect.objectContaining({
          operationalWorkItemId: "work_1",
          purchaseOrderId: "po_1",
          vendorId: "vendor_1",
        }),
      }),
    ]);
    expect(
      Array.from(tables.workflowTraceLookup.values()).map((lookup) => [
        lookup.lookupType,
        lookup.lookupValue,
      ]),
    ).toEqual([
      ["purchase_order_id", "po_1"],
      ["purchase_order_number", "po-001"],
      ["vendor_id", "vendor_1"],
    ]);
  });

  it("records receiving evidence with batch, submission, line, movement, and work-item refs", async () => {
    const { ctx, tables } = createWorkflowTraceCtx();

    await bestEffortRecordPurchaseOrderReceivingTraceWithCtx(ctx, {
      inventoryMovements: [
        {
          inventoryMovementId: "movement_1" as Id<"inventoryMovement">,
          productSkuId: "sku_1" as Id<"productSku">,
          sourceId: "purchase_order_receiving_batch:po_1:receive-1",
          sourceType: "purchase_order_receiving_batch",
        },
      ],
      lineItems: [
        {
          productId: "product_1" as Id<"product">,
          productSkuId: "sku_1" as Id<"productSku">,
          purchaseOrderLineItemId: "line_1" as Id<"purchaseOrderLineItem">,
          receivedQuantity: 2,
        },
      ],
      nextStatus: "partially_received",
      occurredAt: 300,
      purchaseOrder,
      receivedByUserId: "user_1" as Id<"athenaUser">,
      receivingBatchId: "batch_1" as Id<"receivingBatch">,
      sourceId: "purchase_order_receiving_batch:po_1:receive-1",
      submissionKey: "receive-1",
    });
    await bestEffortRecordPurchaseOrderReceivingTraceWithCtx(ctx, {
      inventoryMovements: [],
      lineItems: [],
      nextStatus: "partially_received",
      occurredAt: 301,
      purchaseOrder,
      receivingBatchId: "batch_1" as Id<"receivingBatch">,
      sourceId: "purchase_order_receiving_batch:po_1:receive-1",
      submissionKey: "receive-1",
    });

    expect(Array.from(tables.workflowTraceEvent.values())).toEqual([
      expect.objectContaining({
        eventKey: "purchase_order_receiving:po_1:receive-1",
        details: expect.objectContaining({
          inventoryMovementRefs: [
            {
              inventoryMovementId: "movement_1",
              productSkuId: "sku_1",
              sourceId: "purchase_order_receiving_batch:po_1:receive-1",
              sourceType: "purchase_order_receiving_batch",
            },
          ],
          lineRefs: [
            {
              productId: "product_1",
              productSkuId: "sku_1",
              purchaseOrderLineItemId: "line_1",
              receivedQuantity: "2",
            },
          ],
          receivingBatchId: "batch_1",
          submissionKey: "receive-1",
          workItemRefs: [{ operationalWorkItemId: "work_1" }],
        }),
        subjectRefs: expect.objectContaining({
          receivingBatchId: "batch_1",
          submissionKey: "receive-1",
        }),
      }),
    ]);
    expect(
      Array.from(tables.workflowTraceLookup.values()).map((lookup) => [
        lookup.lookupType,
        lookup.lookupValue,
      ]),
    ).toContainEqual(["receiving_submission_key", "receive-1"]);
  });

  it("swallows trace write failures so callers keep their durable mutation result", async () => {
    const { ctx } = createWorkflowTraceCtx({ failInserts: true });

    await expect(
      bestEffortRecordPurchaseOrderStatusTraceWithCtx(ctx, {
        nextStatus: "submitted",
        occurredAt: 200,
        previousStatus: "draft",
        purchaseOrder,
      }),
    ).resolves.toBeUndefined();
  });
});

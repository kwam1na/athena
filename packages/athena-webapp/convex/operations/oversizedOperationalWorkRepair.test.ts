import { describe, expect, it, vi } from "vitest";

import type { Doc, Id } from "../_generated/dataModel";
import {
  amendRepairWithCtx,
  createRepairWithCtx,
  processRepairBatchWithCtx,
  resumeRepairWithCtx,
} from "./oversizedOperationalWorkRepair";

function workItem(index: number): Doc<"operationalWorkItem"> {
  return {
    _creationTime: index,
    _id: `work-${index}` as Id<"operationalWorkItem">,
    approvalState: "not_required",
    createdAt: index,
    metadata: {
      localTransactionId: `transaction-${index}`,
      primaryProductSkuId: "sku-1",
    },
    organizationId: "org-1" as Id<"organization">,
    priority: "normal",
    productSkuId: "sku-1" as Id<"productSku">,
    status: "open",
    storeId: "store-1" as Id<"store">,
    title: "Review inventory",
    type: "synced_sale_inventory_review",
  };
}

function queryResult(rows: unknown[]) {
  return {
    first: vi.fn(async () => rows[0] ?? null),
    order: vi.fn(() => ({ first: vi.fn(async () => rows[0] ?? null) })),
    take: vi.fn(async (limit: number) => rows.slice(0, limit)),
  };
}

function repairDoc(
  overrides: Partial<Doc<"oversizedOperationalWorkRepair">> = {},
): Doc<"oversizedOperationalWorkRepair"> {
  return {
    _creationTime: 1,
    _id: "repair-1" as Id<"oversizedOperationalWorkRepair">,
    createdAt: 1,
    cursor: 0,
    groupKey: "synced_sale_inventory_review:store-1:sku-1",
    initiatorIdentifier: "support@example.com",
    memberIds: ["work-0" as Id<"operationalWorkItem">],
    organizationId: "org-1" as Id<"organization">,
    productSkuId: "sku-1" as Id<"productSku">,
    reason: "Resolve reviewed inventory.",
    sourceIdentities: [
      "synced_sale_inventory_review:store-1:transaction-0",
    ],
    status: "running",
    storeId: "store-1" as Id<"store">,
    supportTicket: "SUP-123",
    updatedAt: 1,
    ...overrides,
  };
}

describe("oversized operational work repair", () => {
  it("freezes complete oversized membership with immutable support evidence", async () => {
    const items = Array.from({ length: 51 }, (_, index) => workItem(index));
    const inserted: Array<[string, Record<string, unknown>]> = [];
    const ctx = {
      db: {
        get: vi.fn(async (table: string) =>
          table === "store"
            ? { _id: "store-1", organizationId: "org-1" }
            : null,
        ),
        insert: vi.fn(async (table: string, value: Record<string, unknown>) => {
          inserted.push([table, value]);
          return "repair-1";
        }),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((_index: string, builder: Function) => {
            const constraints: Record<string, unknown> = {};
            const q = {
              eq(field: string, value: unknown) {
                constraints[field] = value;
                return q;
              },
            };
            builder(q);
            if (table === "operationalWorkItem") {
              return queryResult(
                items.filter((item) => item.status === constraints.status),
              );
            }
            return queryResult([]);
          }),
        })),
      },
      scheduler: { runAfter: vi.fn() },
    };

    await createRepairWithCtx(ctx as never, {
      groupKey: "synced_sale_inventory_review:store-1:sku-1",
      initiatorIdentifier: "support@example.com",
      organizationId: "org-1" as Id<"organization">,
      reason: "Resolve an oversized reviewed SKU group.",
      storeId: "store-1" as Id<"store">,
      supportTicket: "SUP-123",
    });

    expect(inserted[0]).toEqual([
      "oversizedOperationalWorkRepair",
      expect.objectContaining({
        cursor: 0,
        initiatorIdentifier: "support@example.com",
        memberIds: items.map((item) => item._id),
        sourceIdentities: items.map(
          (_, index) =>
            `synced_sale_inventory_review:store-1:transaction-${index}`,
        ),
        status: "pending",
        supportTicket: "SUP-123",
      }),
    ]);
    expect(inserted[1]).toEqual([
      "oversizedOperationalWorkRepairAction",
      expect.objectContaining({
        action: "created",
        initiatorIdentifier: "support@example.com",
        repairId: "repair-1",
        supportTicket: "SUP-123",
      }),
    ]);
    expect(ctx.scheduler.runAfter).toHaveBeenCalledOnce();
  });

  it("pauses before writes when current membership differs from the frozen remainder", async () => {
    const repair = repairDoc({
      memberIds: ["work-frozen" as Id<"operationalWorkItem">],
    });
    const patch = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async (table: string) =>
          table === "oversizedOperationalWorkRepair" ? repair : null,
        ),
        insert: vi.fn(),
        patch,
        query: vi.fn(() => ({
          withIndex: vi.fn((_index: string, builder: Function) => {
            const constraints: Record<string, unknown> = {};
            const q = {
              eq(field: string, value: unknown) {
                constraints[field] = value;
                return q;
              },
            };
            builder(q);
            return queryResult(
              constraints.status === "open" ? [workItem(2)] : [],
            );
          }),
        })),
      },
      scheduler: { runAfter: vi.fn() },
    };

    const result = await processRepairBatchWithCtx(ctx as never, {
      repairId: repair._id,
    });

    expect(result).toEqual({
      action: "paused",
      error:
        "Current membership changed. Amend the frozen repair before resuming.",
    });
    expect(patch).toHaveBeenCalledWith(
      "oversizedOperationalWorkRepair",
      "repair-1",
      expect.objectContaining({ status: "paused" }),
    );
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "oversizedOperationalWorkRepairAction",
      expect.objectContaining({
        action: "paused",
        error:
          "Current membership changed. Amend the frozen repair before resuming.",
        initiatorIdentifier: "support@example.com",
        reason: "Resolve reviewed inventory.",
        repairId: repair._id,
        supportTicket: "SUP-123",
      }),
    );
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "operationalEvent",
      expect.objectContaining({
        eventType: "oversized_operational_work_repair_paused",
      }),
    );
  });

  it.each([
    ["stale", { createdAt: -1, movementType: "cycle_count" }],
    ["wrong type", { createdAt: 10, movementType: "sale" }],
  ])("does not accept a %s movement as stock proof", async (_label, movement) => {
    const item = workItem(0);
    const repair = repairDoc({
      sourceIdentities: [
        "synced_sale_inventory_review:store-1:transaction-0",
      ],
    });
    const patch = vi.fn();
    const insert = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async (table: string, id: string) => {
          if (table === "oversizedOperationalWorkRepair") return repair;
          if (table === "operationalWorkItem" && id === item._id) return item;
          if (table === "productSku") {
            return { _id: "sku-1", inventoryCount: 0, storeId: "store-1" };
          }
          return null;
        }),
        insert,
        patch,
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((_index: string, builder: Function) => {
            const constraints: Record<string, unknown> = {};
            const q = {
              eq(field: string, value: unknown) {
                constraints[field] = value;
                return q;
              },
            };
            builder(q);
            if (table === "operationalWorkItem") {
              return queryResult(constraints.status === "open" ? [item] : []);
            }
            if (table === "inventoryMovement") {
              return queryResult([
                {
                  ...movement,
                  sourceType: "stock_adjustment_batch",
                },
              ]);
            }
            return queryResult([]);
          }),
        })),
      },
      scheduler: { runAfter: vi.fn() },
    };

    const result = await processRepairBatchWithCtx(ctx as never, {
      repairId: repair._id,
    });

    expect(result).toEqual({
      action: "paused",
      error: "The affected SKU has no qualifying stock proof.",
    });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith(
      "oversizedOperationalWorkRepair",
      repair._id,
      expect.objectContaining({ status: "paused" }),
    );
  });

  it("pauses with audit evidence when a frozen batch member is invalid", async () => {
    const item = workItem(0);
    const repair = repairDoc();
    const patch = vi.fn();
    const insert = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async (table: string) => {
          if (table === "oversizedOperationalWorkRepair") return repair;
          if (table === "productSku") {
            return { _id: "sku-1", inventoryCount: 1, storeId: "store-1" };
          }
          return null;
        }),
        insert,
        patch,
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((_index: string, builder: Function) => {
            const constraints: Record<string, unknown> = {};
            const q = {
              eq(field: string, value: unknown) {
                constraints[field] = value;
                return q;
              },
            };
            builder(q);
            return queryResult(
              table === "operationalWorkItem" && constraints.status === "open"
                ? [item]
                : [],
            );
          }),
        })),
      },
      scheduler: { runAfter: vi.fn() },
    };

    const result = await processRepairBatchWithCtx(ctx as never, {
      repairId: repair._id,
    });

    expect(result).toEqual({
      action: "paused",
      error: "Frozen repair membership is no longer actionable.",
    });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(
      "operationalEvent",
      expect.objectContaining({
        eventType: "oversized_operational_work_repair_paused",
      }),
    );
  });

  it("pauses before member writes when frozen source evidence no longer matches", async () => {
    const item = workItem(0);
    item.metadata = {
      ...item.metadata,
      terminalId: "terminal-1",
    };
    const repair = repairDoc({
      sourceIdentities: [
        "synced_sale_inventory_review:store-1:terminal-1:transaction-0",
      ],
    });
    const patch = vi.fn();
    const insert = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async (table: string, id: string) => {
          if (table === "oversizedOperationalWorkRepair") return repair;
          if (table === "operationalWorkItem" && id === item._id) return item;
          if (table === "productSku") {
            return { _id: "sku-1", inventoryCount: 1, storeId: "store-1" };
          }
          if (table === "posTerminal") {
            return { _id: id, storeId: "store-2" };
          }
          return null;
        }),
        insert,
        patch,
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((_index: string, builder: Function) => {
            const constraints: Record<string, unknown> = {};
            const q = {
              eq(field: string, value: unknown) {
                constraints[field] = value;
                return q;
              },
            };
            builder(q);
            return queryResult(
              table === "operationalWorkItem" && constraints.status === "open"
                ? [item]
                : [],
            );
          }),
        })),
      },
      scheduler: { runAfter: vi.fn() },
    };

    const result = await processRepairBatchWithCtx(ctx as never, {
      repairId: repair._id,
    });

    expect(result).toMatchObject({
      action: "paused",
      error: expect.stringContaining("Terminal does not match"),
    });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith(
      "oversizedOperationalWorkRepair",
      repair._id,
      expect.objectContaining({ status: "paused" }),
    );
    expect(insert).toHaveBeenCalledWith(
      "operationalEvent",
      expect.objectContaining({
        eventType: "oversized_operational_work_repair_paused",
      }),
    );
  });

  it("pauses and audits when the post-creation membership probe is incomplete", async () => {
    const repair = repairDoc();
    const items = Array.from({ length: 1_001 }, (_, index) => workItem(index));
    const patch = vi.fn();
    const insert = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async (table: string) =>
          table === "oversizedOperationalWorkRepair" ? repair : null,
        ),
        insert,
        patch,
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((_index: string, builder: Function) => {
            const constraints: Record<string, unknown> = {};
            const q = {
              eq(field: string, value: unknown) {
                constraints[field] = value;
                return q;
              },
            };
            builder(q);
            return queryResult(
              table === "operationalWorkItem" && constraints.status === "open"
                ? items
                : [],
            );
          }),
        })),
      },
      scheduler: { runAfter: vi.fn() },
    };

    const result = await processRepairBatchWithCtx(ctx as never, {
      repairId: repair._id,
    });

    expect(result).toEqual({
      action: "paused",
      error: "Current inventory review membership is incomplete.",
    });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(
      "operationalEvent",
      expect.objectContaining({
        eventType: "oversized_operational_work_repair_paused",
      }),
    );
  });

  it("persists completed lifecycle evidence and an audit event", async () => {
    const item = workItem(0);
    const repair = repairDoc();
    const patch = vi.fn();
    const insert = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async (table: string, id: string) => {
          if (table === "oversizedOperationalWorkRepair") return repair;
          if (table === "operationalWorkItem" && id === item._id) return item;
          if (table === "productSku") {
            return { _id: "sku-1", inventoryCount: 1, storeId: "store-1" };
          }
          return null;
        }),
        insert,
        patch,
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((_index: string, builder: Function) => {
            const constraints: Record<string, unknown> = {};
            const q = {
              eq(field: string, value: unknown) {
                constraints[field] = value;
                return q;
              },
            };
            builder(q);
            return queryResult(
              table === "operationalWorkItem" && constraints.status === "open"
                ? [item]
                : [],
            );
          }),
        })),
      },
      scheduler: { runAfter: vi.fn() },
    };

    const result = await processRepairBatchWithCtx(ctx as never, {
      repairId: repair._id,
    });

    expect(result).toEqual({ action: "completed", processedCount: 1 });
    expect(patch).toHaveBeenCalledWith(
      "oversizedOperationalWorkRepair",
      repair._id,
      expect.objectContaining({
        status: "completed",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "oversizedOperationalWorkRepairAction",
      expect.objectContaining({
        action: "completed",
        repairId: repair._id,
        supportTicket: "SUP-123",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "operationalEvent",
      expect.objectContaining({
        eventType: "oversized_operational_work_repair_completed",
      }),
    );
  });

  it("persists immutable evidence when a paused repair resumes", async () => {
    const repair = repairDoc({ status: "paused" });
    const patch = vi.fn();
    const insert = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async () => repair),
        insert,
        patch,
      },
      scheduler: { runAfter: vi.fn() },
    };

    await resumeRepairWithCtx(ctx as never, {
      initiatorIdentifier: "support-2@example.com",
      reason: "Stock proof restored.",
      repairId: repair._id,
      supportTicket: "SUP-124",
    });

    expect(patch).toHaveBeenCalledWith(
      "oversizedOperationalWorkRepair",
      repair._id,
      expect.objectContaining({
        status: "running",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "oversizedOperationalWorkRepairAction",
      expect.objectContaining({
        action: "resumed",
        initiatorIdentifier: "support-2@example.com",
        repairId: repair._id,
        supportTicket: "SUP-124",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "operationalEvent",
      expect.objectContaining({
        eventType: "oversized_operational_work_repair_resumed",
      }),
    );
  });

  it("amends only aliases of frozen sources and leaves later sales outside the repair", async () => {
    const repair = repairDoc({ status: "paused" });
    const alias = workItem(2);
    alias._id = "work-alias" as Id<"operationalWorkItem">;
    alias.metadata = { ...alias.metadata, localTransactionId: "transaction-0" };
    const laterSale = workItem(1);
    const patch = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async () => repair),
        insert: vi.fn(),
        patch,
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((_index: string, builder: Function) => {
            const constraints: Record<string, unknown> = {};
            const q = {
              eq(field: string, value: unknown) {
                constraints[field] = value;
                return q;
              },
            };
            builder(q);
            return queryResult(
              table === "operationalWorkItem" && constraints.status === "open"
                ? [alias, laterSale]
                : [],
            );
          }),
        })),
      },
      scheduler: { runAfter: vi.fn() },
    };

    const result = await amendRepairWithCtx(ctx as never, {
      initiatorIdentifier: "support-2@example.com",
      reason: "Include the duplicate alias.",
      repairId: repair._id,
      supportTicket: "SUP-125",
    });

    expect(result).toEqual({ action: "amended", addedCount: 1 });
    expect(patch).toHaveBeenCalledWith(
      "oversizedOperationalWorkRepair",
      repair._id,
      expect.objectContaining({
        memberIds: ["work-0", "work-alias"],
      }),
    );
    expect(
      patch.mock.calls[0]?.[2]?.memberIds,
    ).not.toContain("work-1");
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "oversizedOperationalWorkRepairAction",
      expect.objectContaining({
        action: "amended",
        addedMemberIds: ["work-alias"],
        initiatorIdentifier: "support-2@example.com",
        reason: "Include the duplicate alias.",
        repairId: repair._id,
        supportTicket: "SUP-125",
      }),
    );
  });
});

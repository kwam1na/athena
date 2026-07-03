import { describe, expect, it } from "vitest";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  listProductOperationalTimelineWithCtx,
  recordOperationalEventWithCtx,
} from "./operationalEvents";

type TableName =
  | "automationRun"
  | "operationalEvent"
  | "product"
  | "productSku"
  | "posPendingCheckoutItem";
type Row = Record<string, unknown> & { _id: string };

function createCtx(seed: Partial<Record<TableName, Row[]>>) {
  const tables: Record<TableName, Map<string, Row>> = {
    operationalEvent: new Map(),
    automationRun: new Map(),
    product: new Map(),
    productSku: new Map(),
    posPendingCheckoutItem: new Map(),
  };

  for (const [table, rows] of Object.entries(seed) as Array<
    [TableName, Row[]]
  >) {
    rows.forEach((row) => tables[table].set(row._id, row));
  }

  const ctx = {
    db: {
      async get(table: TableName, id: string) {
        return tables[table].get(id) ?? null;
      },
      async insert(table: TableName, value: Record<string, unknown>) {
        const id = `${table}-${tables[table].size + 1}`;
        tables[table].set(id, { _id: id, ...value });
        return id;
      },
      query(table: TableName) {
        const filters: Array<[string, unknown]> = [];
        const rows = () =>
          Array.from(tables[table].values()).filter((row) =>
            filters.every(([field, value]) => row[field] === value),
          );

        const chain = {
          collect: async () => rows(),
          take: async (limit: number) => rows().slice(0, limit),
          withIndex(
            _index: string,
            applyIndex: (builder: {
              eq: (field: string, value: unknown) => typeof builder;
            }) => unknown,
          ) {
            const builder = {
              eq(field: string, value: unknown) {
                filters.push([field, value]);
                return builder;
              },
            };
            applyIndex(builder);
            return chain;
          },
        };

        return chain;
      },
    },
  } as unknown as QueryCtx;

  return ctx;
}

describe("operational events", () => {
  it("lists product and SKU operational events in newest-first order", async () => {
    const ctx = createCtx({
      product: [
        {
          _id: "product-1",
          storeId: "store-1",
        },
      ],
      productSku: [
        {
          _id: "sku-1",
          productId: "product-1",
          sku: "SKU-001",
        },
        {
          _id: "sku-2",
          productId: "product-1",
          sku: "SKU-002",
        },
      ],
      operationalEvent: [
        {
          _id: "event-product",
          createdAt: 100,
          eventType: "product_updated",
          message: "Product updated.",
          storeId: "store-1",
          subjectId: "product-1",
          subjectType: "product",
        },
        {
          _id: "event-sku",
          createdAt: 200,
          eventType: "pos_quick_add_product_created",
          message: "Kwamina Nuh quick added Vitamilk with quantity 100.",
          storeId: "store-1",
          subjectId: "sku-1",
          subjectLabel: "Vitamilk",
          subjectType: "product_sku",
        },
        {
          _id: "event-other-product",
          createdAt: 300,
          eventType: "pos_quick_add_product_created",
          message: "Other product.",
          storeId: "store-1",
          subjectId: "sku-other",
          subjectType: "product_sku",
        },
      ],
    });

    const result = await listProductOperationalTimelineWithCtx(ctx, {
      productId: "product-1" as Id<"product">,
      storeId: "store-1" as Id<"store">,
    });

    expect(result.map((event) => event.id)).toEqual([
      "event-sku",
      "event-product",
    ]);
    expect(result[0]).toMatchObject({
      message: "Kwamina Nuh quick added Vitamilk with quantity 100.",
      subject: {
        id: "sku-1",
        label: "Vitamilk",
        sku: "SKU-001",
        type: "product_sku",
      },
    });
  });

  it("includes pending checkout item events anchored to a provisional product SKU", async () => {
    const ctx = createCtx({
      product: [
        {
          _id: "product-1",
          storeId: "store-1",
        },
      ],
      productSku: [
        {
          _id: "sku-1",
          productId: "product-1",
          sku: "PENDING-001",
        },
      ],
      posPendingCheckoutItem: [
        {
          _id: "pending-1",
          provisionalProductId: "product-1",
          provisionalProductSkuId: "sku-1",
          storeId: "store-1",
        },
        {
          _id: "pending-other-store",
          provisionalProductId: "product-1",
          provisionalProductSkuId: "sku-1",
          storeId: "store-2",
        },
      ],
      operationalEvent: [
        {
          _id: "event-pending",
          createdAt: 300,
          eventType: "pos_pending_checkout_item_created",
          message: "Cashier added pending checkout item Ebin lace bond.",
          storeId: "store-1",
          subjectId: "pending-1",
          subjectLabel: "Ebin lace bond",
          subjectType: "pos_pending_checkout_item",
        },
        {
          _id: "event-sku",
          createdAt: 200,
          eventType: "product_sku_updated",
          message: "SKU updated.",
          storeId: "store-1",
          subjectId: "sku-1",
          subjectType: "product_sku",
        },
        {
          _id: "event-other-store-pending",
          createdAt: 400,
          eventType: "pos_pending_checkout_item_created",
          message: "Other store pending item.",
          storeId: "store-2",
          subjectId: "pending-other-store",
          subjectType: "pos_pending_checkout_item",
        },
      ],
    });

    const result = await listProductOperationalTimelineWithCtx(ctx, {
      productId: "product-1" as Id<"product">,
      storeId: "store-1" as Id<"store">,
    });

    expect(result.map((event) => event.id)).toEqual([
      "event-pending",
      "event-sku",
    ]);
    expect(result[0]).toMatchObject({
      message: "Cashier added pending checkout item Ebin lace bond.",
      subject: {
        id: "pending-1",
        label: "Ebin lace bond",
        sku: "PENDING-001",
        type: "pos_pending_checkout_item",
      },
    });
  });

  it("includes linked pending checkout item events under the approved trusted SKU", async () => {
    const ctx = createCtx({
      product: [
        {
          _id: "product-1",
          storeId: "store-1",
        },
      ],
      productSku: [
        {
          _id: "sku-1",
          productId: "product-1",
          sku: "TRUSTED-001",
        },
      ],
      posPendingCheckoutItem: [
        {
          _id: "pending-1",
          approvedProductId: "product-1",
          approvedProductSkuId: "sku-1",
          provisionalProductId: "product-provisional",
          provisionalProductSkuId: "sku-provisional",
          status: "linked_to_catalog",
          storeId: "store-1",
        },
      ],
      operationalEvent: [
        {
          _id: "event-pending-linked",
          createdAt: 300,
          eventType: "pos_pending_checkout_item_reviewed",
          message: "Linked pending checkout item to Trusted Wig.",
          storeId: "store-1",
          subjectId: "pending-1",
          subjectLabel: "Loose wave",
          subjectType: "pos_pending_checkout_item",
        },
      ],
    });

    const result = await listProductOperationalTimelineWithCtx(ctx, {
      productId: "product-1" as Id<"product">,
      storeId: "store-1" as Id<"store">,
    });

    expect(result).toEqual([
      expect.objectContaining({
        id: "event-pending-linked",
        subject: expect.objectContaining({
          sku: "TRUSTED-001",
          type: "pos_pending_checkout_item",
        }),
      }),
    ]);
  });

  it("returns no events when the product is outside the requested store", async () => {
    const ctx = createCtx({
      product: [
        {
          _id: "product-1",
          storeId: "store-2",
        },
      ],
    });

    await expect(
      listProductOperationalTimelineWithCtx(ctx, {
        productId: "product-1" as Id<"product">,
        storeId: "store-1" as Id<"store">,
      }),
    ).resolves.toEqual([]);
  });

  it("dedupes operational events by actor identity when actor fields are present", async () => {
    const ctx = createCtx({});
    const baseEvent = {
      storeId: "store-1" as Id<"store">,
      eventType: "drawer_action",
      subjectType: "posTerminal",
      subjectId: "terminal-1",
      reason: "validated",
      message: "Drawer action recorded.",
    };

    await recordOperationalEventWithCtx(ctx as unknown as MutationCtx, {
      ...baseEvent,
      actorUserId: "user-1" as Id<"athenaUser">,
    });
    await recordOperationalEventWithCtx(ctx as unknown as MutationCtx, {
      ...baseEvent,
      actorUserId: "user-1" as Id<"athenaUser">,
    });
    await recordOperationalEventWithCtx(ctx as unknown as MutationCtx, {
      ...baseEvent,
      actorUserId: "user-2" as Id<"athenaUser">,
    });
    await recordOperationalEventWithCtx(ctx as unknown as MutationCtx, {
      ...baseEvent,
      actorStaffProfileId: "staff-1" as Id<"staffProfile">,
    });

    const events = await ctx.db
      .query("operationalEvent")
      .withIndex("by_storeId_subject", (q) =>
        q
          .eq("storeId", "store-1" as Id<"store">)
          .eq("subjectType", "posTerminal")
          .eq("subjectId", "terminal-1"),
      )
      .take(10);

    expect(events).toHaveLength(3);
    expect(events).toEqual([
      expect.objectContaining({ actorUserId: "user-1" }),
      expect.objectContaining({ actorUserId: "user-2" }),
      expect.objectContaining({ actorStaffProfileId: "staff-1" }),
    ]);
  });

  it("normalizes POS trace fields into top-level fields and metadata", async () => {
    const ctx = createCtx({});

    await recordOperationalEventWithCtx(ctx as unknown as MutationCtx, {
      actorStaffProfileId: "staff-1" as Id<"staffProfile">,
      eventType: "pos_quick_add_product_created",
      localEventId: "event-local-1",
      message: "Quick add recorded.",
      metadata: {
        productSkuId: "sku-1",
      },
      posTransactionId: "transaction-1" as Id<"posTransaction">,
      registerSessionId: "register-session-1" as Id<"registerSession">,
      storeId: "store-1" as Id<"store">,
      subjectId: "sku-1",
      subjectType: "product_sku",
      terminalId: "terminal-1" as Id<"posTerminal">,
    });

    const events = await ctx.db
      .query("operationalEvent")
      .withIndex("by_storeId_subject", (q) =>
        q
          .eq("storeId", "store-1" as Id<"store">)
          .eq("subjectType", "product_sku")
          .eq("subjectId", "sku-1"),
      )
      .take(10);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorStaffProfileId: "staff-1",
      localEventId: "event-local-1",
      posTransactionId: "transaction-1",
      registerSessionId: "register-session-1",
      terminalId: "terminal-1",
      metadata: {
        localEventId: "event-local-1",
        productSkuId: "sku-1",
        posTrace: {
          actorStaffProfileId: "staff-1",
          localEventId: "event-local-1",
          posTransactionId: "transaction-1",
          registerSessionId: "register-session-1",
          terminalId: "terminal-1",
        },
        posTransactionId: "transaction-1",
        registerSessionId: "register-session-1",
        terminalId: "terminal-1",
      },
    });
  });

  it("records Athena-authored operational events without staff impersonation", async () => {
    const ctx = createCtx({});
    const baseEvent = {
      actorType: "automation" as const,
      automationDecisionReason: "Clean Opening snapshot.",
      automationPolicyVersion: "daily-operations.v1",
      automationRunId: "automation-run-1" as Id<"automationRun">,
      eventType: "daily_opening_auto_started",
      message: "Athena started Opening Handoff for 2026-06-08.",
      metadata: {
        operatingDate: "2026-06-08",
      },
      metadataDedupeKeys: ["operatingDate"],
      storeId: "store-1" as Id<"store">,
      subjectId: "daily-opening-1",
      subjectType: "daily_opening",
    };

    await recordOperationalEventWithCtx(ctx as unknown as MutationCtx, baseEvent);
    await recordOperationalEventWithCtx(ctx as unknown as MutationCtx, baseEvent);
    await recordOperationalEventWithCtx(ctx as unknown as MutationCtx, {
      ...baseEvent,
      automationRunId: "automation-run-2" as Id<"automationRun">,
    });

    const events = await ctx.db
      .query("operationalEvent")
      .withIndex("by_storeId_subject", (q) =>
        q
          .eq("storeId", "store-1" as Id<"store">)
          .eq("subjectType", "daily_opening")
          .eq("subjectId", "daily-opening-1"),
      )
      .take(10);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      actorType: "automation",
      automationDecisionReason: "Clean Opening snapshot.",
      automationPolicyVersion: "daily-operations.v1",
      automationRunId: "automation-run-1",
    });
    expect(events[0]).not.toHaveProperty("actorStaffProfileId");
    expect(events[0]).not.toHaveProperty("actorUserId");
  });
});

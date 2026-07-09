import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import {
  createOrReusePendingCheckoutItem,
  recordPendingCheckoutItemSaleEvidence,
  recordPendingCheckoutItemEvidenceCorrection,
} from "./createOrReusePendingCheckoutItem";

const mocks = vi.hoisted(() => ({
  upsertProductSkuSearchProjection: vi.fn(),
}));

vi.mock("../../../inventory/skuSearch", () => ({
  upsertProductSkuSearchProjection: mocks.upsertProductSkuSearchProjection,
}));

type TableName =
  | "athenaUser"
  | "category"
  | "operationalEvent"
  | "operationalWorkItem"
  | "posPendingCheckoutItem"
  | "product"
  | "productSku"
  | "registerSession"
  | "store"
  | "subcategory";
type Row = Record<string, unknown> & { _id: string };

function createPendingCheckoutCtx(seed?: Partial<Record<TableName, Row[]>>) {
  const patches: Array<{ table: TableName; id: string; value: Record<string, unknown> }> =
    [];
  const inserts: Array<{ table: TableName; id: string; value: Record<string, unknown> }> =
    [];
  const tables: Record<TableName, Map<string, Row>> = {
    athenaUser: new Map(),
    category: new Map(),
    operationalEvent: new Map(),
    operationalWorkItem: new Map(),
    posPendingCheckoutItem: new Map(),
    product: new Map(),
    productSku: new Map(),
    registerSession: new Map(),
    store: new Map(),
    subcategory: new Map(),
  };
  const insertCounters: Record<TableName, number> = {
    athenaUser: 0,
    category: 0,
    operationalEvent: 0,
    operationalWorkItem: 0,
    posPendingCheckoutItem: 0,
    product: 0,
    productSku: 0,
    registerSession: 0,
    store: 0,
    subcategory: 0,
  };

  for (const [table, rows] of Object.entries(seed ?? {}) as Array<
    [TableName, Row[]]
  >) {
    rows.forEach((row) => tables[table].set(row._id, row));
  }

  function createIndexedQuery(
    table: TableName,
    filters: Array<[string, unknown]>,
  ) {
    const matches = Array.from(tables[table].values()).filter((row) =>
      filters.every(([field, value]) => row[field] === value),
    );

    return {
      collect: async () => matches,
      first: async () => matches[0] ?? null,
      take: async (limit: number) => matches.slice(0, limit),
    };
  }

  const ctx = {
    db: {
      async get(table: TableName, id: string) {
        return tables[table].get(id) ?? null;
      },
      async insert(table: TableName, value: Record<string, unknown>) {
        insertCounters[table] += 1;
        const id = `${table}00${insertCounters[table]}`;
        inserts.push({ table, id, value });
        tables[table].set(id, { _id: id, ...value });
        return id;
      },
      async patch(table: TableName, id: string, value: Record<string, unknown>) {
        const existing = tables[table].get(id);
        if (!existing) {
          throw new Error(`Missing ${table}: ${id}`);
        }

        patches.push({ table, id, value });
        tables[table].set(id, { ...existing, ...value });
      },
      query(table: TableName) {
        return {
          filter() {
            if (table === "category") {
              return createIndexedQuery(table, [
                ["storeId", "storezzzz"],
                ["slug", "pos-pending-checkout"],
              ]);
            }

            if (table === "subcategory") {
              const pendingCategory = Array.from(
                tables.category.values(),
              ).find((row) => row.slug === "pos-pending-checkout");

              return createIndexedQuery(table, [
                ["storeId", "storezzzz"],
                ["categoryId", pendingCategory?._id],
                ["slug", "needs-review"],
              ]);
            }

            return createIndexedQuery(table, []);
          },
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
            return createIndexedQuery(table, filters);
          },
        };
      },
    },
  } as unknown as MutationCtx;

  return { ctx, inserts, patches, tables };
}

const baseSeed = {
  athenaUser: [
    {
      _id: "user0001",
      email: "cashier@example.com",
      firstName: "Ama",
      lastName: "Mensah",
    },
  ],
  store: [
    {
      _id: "storezzzz",
      currency: "GHS",
      organizationId: "org0001",
    },
  ],
};

describe("createOrReusePendingCheckoutItem", () => {
  beforeEach(() => {
    mocks.upsertProductSkuSearchProjection.mockReset();
  });

  it("rejects ordinary pending checkout sale context for review-only drawers", async () => {
    const { ctx, tables } = createPendingCheckoutCtx({
      ...baseSeed,
      registerSession: [
        {
          _id: "register-session-1",
          expectedCash: 5_000,
          status: "closeout_rejected",
          storeId: "storezzzz",
        },
      ],
    });

    await expect(
      createOrReusePendingCheckoutItem(ctx, {
        createdByUserId: "user0001" as Id<"athenaUser">,
        lookupCode: "123456789012",
        name: "Loose wave bundle",
        price: 125000,
        quantitySold: 1,
        registerSessionId: "register-session-1" as Id<"registerSession">,
        storeId: "storezzzz" as Id<"store">,
        timestamp: 1_000,
      }),
    ).rejects.toThrow(
      "Open a replacement drawer before selling this pending checkout item.",
    );

    expect(tables.posPendingCheckoutItem.size).toBe(0);
  });

  it("creates a reviewable pending checkout item without creating trusted catalog stock", async () => {
    const { ctx, tables } = createPendingCheckoutCtx(baseSeed);

    const result = await createOrReusePendingCheckoutItem(ctx, {
      createdByUserId: "user0001" as Id<"athenaUser">,
      lookupCode: " 123456789012 ",
      name: "Loose wave bundle",
      price: 125000,
      quantitySold: 2.8,
      storeId: "storezzzz" as Id<"store">,
      timestamp: 1_000,
    });

    expect(result).toMatchObject({
      lookupCode: "123456789012",
      name: "Loose wave bundle",
      price: 125000,
      productId: "product001",
      productSkuId: "productSku001",
      quantitySold: 2,
      reviewPriority: "normal",
      sku: "ZZZZ-1-1",
      status: "pending_review",
    });
    expect(mocks.upsertProductSkuSearchProjection).toHaveBeenCalledWith(
      ctx,
      "productSku001",
    );

    const item = Array.from(tables.posPendingCheckoutItem.values())[0];
    expect(item).toMatchObject({
      createdByUserId: "user0001",
      currency: "GHS",
      lookupCode: "123456789012",
      normalizedLookupCode: "123456789012",
      normalizedName: "loose wave bundle",
      operationalWorkItemId: "operationalWorkItem001",
      provisionalProductId: "product001",
      provisionalProductSkuId: "productSku001",
      provisionalPrice: 125000,
      status: "pending_review",
    });
    expect(Array.from(tables.product.values())).toEqual([
      expect.objectContaining({
        _id: "product001",
        availability: "draft",
        inventoryCount: 0,
        isVisible: false,
        quantityAvailable: 0,
      }),
    ]);
    expect(Array.from(tables.productSku.values())).toEqual([
      expect.objectContaining({
        _id: "productSku001",
        inventoryCount: 0,
        isVisible: false,
        quantityAvailable: 0,
        sku: "ZZZZ-1-1",
      }),
    ]);
    expect(item.evidence).toMatchObject({
      firstSeenAt: 1_000,
      lastSeenAt: 1_000,
      observedLookupCodes: ["123456789012"],
      observedPrices: [125000],
      totalQuantitySold: 0,
      transactionCount: 0,
    });

    expect(Array.from(tables.operationalWorkItem.values())).toEqual([
      expect.objectContaining({
        status: "open",
        title: "Review pending checkout item: Loose wave bundle",
        type: "pos_pending_checkout_item_review",
      }),
    ]);
    expect(Array.from(tables.operationalEvent.values())).toEqual([
      expect.objectContaining({
        actorUserId: "user0001",
        eventType: "pos_pending_checkout_item_created",
        message:
          "Ama Mensah added pending checkout item Loose wave bundle. Quantity entered: 2.",
        subjectId: item._id,
        subjectLabel: "Loose wave bundle",
        subjectType: "pos_pending_checkout_item",
        metadata: expect.objectContaining({
          pendingCheckoutItemId: item._id,
          provisionalProductId: "product001",
          provisionalProductSkuId: "productSku001",
          quantitySold: 2,
          totalQuantitySold: 0,
          transactionCount: 0,
        }),
      }),
    ]);
  });

  it("reuses the same pending item before review and raises review priority without blocking the sale", async () => {
    const { ctx, tables } = createPendingCheckoutCtx(baseSeed);

    await createOrReusePendingCheckoutItem(ctx, {
      createdByUserId: "user0001" as Id<"athenaUser">,
      lookupCode: "998877665544",
      name: "Mystery wig",
      price: 90000,
      quantitySold: 1,
      storeId: "storezzzz" as Id<"store">,
      timestamp: 1_000,
    });
    const result = await createOrReusePendingCheckoutItem(ctx, {
      createdByUserId: "user0001" as Id<"athenaUser">,
      lookupCode: "998877665544",
      name: "Mystery wig",
      price: 95000,
      quantitySold: 3,
      storeId: "storezzzz" as Id<"store">,
      timestamp: 2_000,
    });

    expect(result).toMatchObject({
      price: 95000,
      quantitySold: 3,
      reviewPriority: "high",
      status: "pending_review",
    });
    expect(tables.posPendingCheckoutItem.size).toBe(1);
    expect(tables.operationalWorkItem.size).toBe(1);

    const item = Array.from(tables.posPendingCheckoutItem.values())[0];
    expect(item.evidence).toMatchObject({
      lastSeenAt: 2_000,
      observedPrices: [90000, 95000],
      totalQuantitySold: 0,
      transactionCount: 0,
    });
    expect(Array.from(tables.operationalWorkItem.values())[0]).toMatchObject({
      priority: "high",
      metadata: expect.objectContaining({
        reviewPriority: "high",
        totalQuantitySold: 0,
        transactionCount: 0,
      }),
    });

    expect(Array.from(tables.operationalEvent.values())).toEqual([
      expect.objectContaining({
        eventType: "pos_pending_checkout_item_created",
      }),
      expect.objectContaining({
        eventType: "pos_pending_checkout_item_reused",
        message:
          "Ama Mensah reused pending checkout item Mystery wig. Quantity entered: 3.",
        metadata: expect.objectContaining({
          quantitySold: 3,
          reviewPriority: "high",
          totalQuantitySold: 0,
          transactionCount: 0,
        }),
      }),
    ]);
  });

  it("reuses a flagged pending item instead of creating a second review case", async () => {
    const { ctx, tables } = createPendingCheckoutCtx({
      ...baseSeed,
      posPendingCheckoutItem: [
        {
          _id: "pending-flagged",
          createdAt: 1,
          evidence: {
            firstSeenAt: 1,
            lastSeenAt: 1,
            observedLookupCodes: ["998877665544"],
            observedPrices: [90000],
            offlineSaleCount: 0,
            totalQuantitySold: 0,
            transactionCount: 0,
          },
          lookupCode: "998877665544",
          name: "Mystery wig",
          normalizedLookupCode: "998877665544",
          normalizedName: "mystery wig",
          organizationId: "org0001",
          provisionalPrice: 90000,
          provisionalProductId: "product-pending",
          provisionalProductSkuId: "sku-pending",
          reviewPriority: "elevated",
          status: "flagged",
          storeId: "storezzzz",
          updatedAt: 1,
        },
      ],
      productSku: [
        {
          _id: "sku-pending",
          sku: "ZZZZ-1-1",
          storeId: "storezzzz",
        },
      ],
    });

    const result = await createOrReusePendingCheckoutItem(ctx, {
      createdByUserId: "user0001" as Id<"athenaUser">,
      lookupCode: "998877665544",
      name: "Mystery wig",
      price: 95000,
      quantitySold: 1,
      storeId: "storezzzz" as Id<"store">,
      timestamp: 2_000,
    });

    expect(result).toMatchObject({
      pendingCheckoutItemId: "pending-flagged",
      status: "flagged",
    });
    expect(tables.posPendingCheckoutItem.size).toBe(1);
  });

  it("blocks a rejected pending item from being recreated with the same lookup code", async () => {
    const { ctx, tables } = createPendingCheckoutCtx({
      ...baseSeed,
      posPendingCheckoutItem: [
        {
          _id: "pending-rejected",
          evidence: {
            firstSeenAt: 1,
            lastSeenAt: 1,
            observedLookupCodes: ["998877665544"],
            observedPrices: [90000],
            offlineSaleCount: 0,
            totalQuantitySold: 0,
            transactionCount: 0,
          },
          lookupCode: "998877665544",
          name: "Rejected wig",
          normalizedLookupCode: "998877665544",
          normalizedName: "rejected wig",
          organizationId: "org0001",
          provisionalPrice: 90000,
          reviewPriority: "normal",
          status: "rejected",
          storeId: "storezzzz",
          updatedAt: 1,
        },
      ],
    });

    await expect(
      createOrReusePendingCheckoutItem(ctx, {
        createdByUserId: "user0001" as Id<"athenaUser">,
        lookupCode: "998877665544",
        name: "Rejected wig",
        price: 95000,
        quantitySold: 1,
        storeId: "storezzzz" as Id<"store">,
      }),
    ).rejects.toThrow("This item was rejected in review.");

    expect(tables.posPendingCheckoutItem.size).toBe(1);
  });

  it.each(["approved", "linked_to_catalog"] as const)(
    "blocks a %s pending item from being sold through pending checkout again",
    async (status) => {
      const { ctx, inserts, patches, tables } = createPendingCheckoutCtx({
        ...baseSeed,
        posPendingCheckoutItem: [
          {
            _id: `pending-${status}`,
            evidence: {
              firstSeenAt: 1,
              lastSeenAt: 1,
              observedLookupCodes: ["998877665544"],
              observedPrices: [90000],
              offlineSaleCount: 0,
              totalQuantitySold: 1,
              transactionCount: 1,
            },
            lookupCode: "998877665544",
            name: "Reviewed wig",
            normalizedLookupCode: "998877665544",
            normalizedName: "reviewed wig",
            organizationId: "org0001",
            provisionalPrice: 90000,
            provisionalProductId: "product-pending",
            provisionalProductSkuId: "sku-pending",
            reviewPriority: "normal",
            status,
            storeId: "storezzzz",
            updatedAt: 1,
          },
        ],
      });

      await expect(
        createOrReusePendingCheckoutItem(ctx, {
          createdByUserId: "user0001" as Id<"athenaUser">,
          lookupCode: "998877665544",
          name: "Reviewed wig",
          price: 95000,
          quantitySold: 1,
          storeId: "storezzzz" as Id<"store">,
        }),
      ).rejects.toThrow("This item was already reviewed.");

      expect(tables.posPendingCheckoutItem.size).toBe(1);
      expect(patches).toEqual([]);
      expect(inserts).toEqual([]);
    },
  );

  it("records offline replay evidence with local event ids idempotently on the pending item", async () => {
    const { ctx, tables } = createPendingCheckoutCtx(baseSeed);

    const result = await createOrReusePendingCheckoutItem(ctx, {
      createdByUserId: "user0001" as Id<"athenaUser">,
      localEventId: "local-event-1",
      name: "Offline item",
      price: 45000,
      quantitySold: 1,
      source: "offline_sync",
      storeId: "storezzzz" as Id<"store">,
      timestamp: 1_000,
    });

    expect(result.status).toBe("pending_review");
    const item = Array.from(tables.posPendingCheckoutItem.values())[0];
    expect(item.createdFrom).toBe("offline_sync");
    expect(item.evidence).toMatchObject({
      localEventIds: ["local-event-1"],
      offlineSaleCount: 0,
      totalQuantitySold: 0,
    });
    expect(Array.from(tables.operationalEvent.values())[0]).toMatchObject({
      metadata: expect.objectContaining({
        source: "offline_sync",
      }),
    });
  });

  it("records sold evidence only after a pending checkout line is committed", async () => {
    const { ctx, tables } = createPendingCheckoutCtx({
      ...baseSeed,
      registerSession: [
        {
          _id: "register-session-1",
          expectedCash: 5_000,
          status: "active",
          storeId: "storezzzz",
        },
      ],
    });

    const result = await createOrReusePendingCheckoutItem(ctx, {
      createdByUserId: "user0001" as Id<"athenaUser">,
      createdByStaffProfileId: "staff0001" as Id<"staffProfile">,
      lookupCode: "556677",
      localEventId: "define-event-1",
      name: "Committed pending item",
      price: 30000,
      quantitySold: 2,
      registerSessionId: "register-session-1" as Id<"registerSession">,
      storeId: "storezzzz" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      timestamp: 1_000,
    });

    await recordPendingCheckoutItemSaleEvidence(ctx, {
      actorStaffProfileId: "staff0001" as Id<"staffProfile">,
      actorUserId: "user0001" as Id<"athenaUser">,
      localEventId: "sale-event-1",
      pendingCheckoutItemId: result.pendingCheckoutItemId,
      posTransactionId: "txn001" as Id<"posTransaction">,
      price: 30000,
      quantitySold: 2,
      registerSessionId: "register-session-1" as Id<"registerSession">,
      source: "offline_sync",
      storeId: "storezzzz" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      timestamp: 2_000,
    });

    const item = Array.from(tables.posPendingCheckoutItem.values())[0];
    expect(item.evidence).toMatchObject({
      lastPosTransactionId: "txn001",
      localEventIds: ["define-event-1", "sale-event-1"],
      offlineSaleCount: 1,
      totalQuantitySold: 2,
      transactionCount: 1,
    });
    expect(Array.from(tables.operationalWorkItem.values())[0]).toMatchObject({
      metadata: expect.objectContaining({
        totalQuantitySold: 2,
        transactionCount: 1,
      }),
    });
    expect(Array.from(tables.operationalEvent.values())).toEqual([
      expect.objectContaining({
        actorStaffProfileId: "staff0001",
        actorUserId: "user0001",
        eventType: "pos_pending_checkout_item_created",
        registerSessionId: "register-session-1",
        metadata: expect.objectContaining({
          localEventId: "define-event-1",
          registerSessionId: "register-session-1",
          terminalId: "terminal-1",
          transactionCount: 0,
        }),
      }),
      expect.objectContaining({
        actorStaffProfileId: "staff0001",
        actorUserId: "user0001",
        eventType: "pos_pending_checkout_item_reused",
        posTransactionId: "txn001",
        registerSessionId: "register-session-1",
        metadata: expect.objectContaining({
          localEventId: "sale-event-1",
          posTransactionId: "txn001",
          registerSessionId: "register-session-1",
          terminalId: "terminal-1",
          transactionCount: 1,
        }),
      }),
    ]);
  });

  it("does not double-count sale evidence when an offline local event is replayed", async () => {
    const { ctx, patches, tables } = createPendingCheckoutCtx({
      ...baseSeed,
      operationalWorkItem: [
        {
          _id: "work-item-1",
          metadata: {
            pendingCheckoutItemId: "pending-1",
            totalQuantitySold: 2,
            transactionCount: 1,
          },
          status: "open",
          storeId: "storezzzz",
        },
      ],
      posPendingCheckoutItem: [
        {
          _id: "pending-1",
          evidence: {
            firstSeenAt: 1_000,
            lastSeenAt: 2_000,
            lastPosTransactionId: "txn001",
            localEventIds: ["sale-event-1"],
            observedLookupCodes: ["556677"],
            observedPrices: [30000],
            offlineSaleCount: 1,
            totalQuantitySold: 2,
            transactionCount: 1,
          },
          lookupCode: "556677",
          name: "Committed pending item",
          normalizedLookupCode: "556677",
          normalizedName: "committed pending item",
          operationalWorkItemId: "work-item-1",
          organizationId: "org0001",
          provisionalPrice: 30000,
          provisionalProductId: "product-pending",
          provisionalProductSkuId: "sku-pending",
          reviewPriority: "normal",
          status: "pending_review",
          storeId: "storezzzz",
          updatedAt: 2_000,
        },
      ],
    });

    const result = await recordPendingCheckoutItemSaleEvidence(ctx, {
      actorUserId: "user0001" as Id<"athenaUser">,
      localEventId: "sale-event-1",
      pendingCheckoutItemId: "pending-1" as Id<"posPendingCheckoutItem">,
      posTransactionId: "txn001" as Id<"posTransaction">,
      price: 30000,
      quantitySold: 2,
      source: "offline_sync",
      storeId: "storezzzz" as Id<"store">,
      timestamp: 3_000,
    });

    expect(result).toMatchObject({
      _id: "pending-1",
      evidence: expect.objectContaining({
        localEventIds: ["sale-event-1"],
        totalQuantitySold: 2,
        transactionCount: 1,
      }),
    });
    expect(patches).toEqual([]);
    expect(tables.operationalEvent.size).toBe(0);
  });

  it("keeps distinct lookup codes separate even when the item name matches", async () => {
    const { ctx, tables } = createPendingCheckoutCtx(baseSeed);

    const first = await createOrReusePendingCheckoutItem(ctx, {
      createdByUserId: "user0001" as Id<"athenaUser">,
      lookupCode: "111111111111",
      name: "Loose wave bundle",
      price: 30000,
      quantitySold: 1,
      storeId: "storezzzz" as Id<"store">,
      timestamp: 1_000,
    });
    const second = await createOrReusePendingCheckoutItem(ctx, {
      createdByUserId: "user0001" as Id<"athenaUser">,
      lookupCode: "222222222222",
      name: "Loose wave bundle",
      price: 30000,
      quantitySold: 1,
      storeId: "storezzzz" as Id<"store">,
      timestamp: 2_000,
    });

    expect(second.pendingCheckoutItemId).not.toBe(first.pendingCheckoutItemId);
    expect(tables.posPendingCheckoutItem.size).toBe(2);
  });

  it("reuses a no-barcode pending item when the same name later has a lookup code", async () => {
    const { ctx, tables } = createPendingCheckoutCtx(baseSeed);

    const first = await createOrReusePendingCheckoutItem(ctx, {
      createdByUserId: "user0001" as Id<"athenaUser">,
      name: "Loose wave bundle",
      price: 30000,
      quantitySold: 1,
      storeId: "storezzzz" as Id<"store">,
      timestamp: 1_000,
    });
    const second = await createOrReusePendingCheckoutItem(ctx, {
      createdByUserId: "user0001" as Id<"athenaUser">,
      lookupCode: "222222222222",
      name: "Loose wave bundle",
      price: 30000,
      quantitySold: 1,
      storeId: "storezzzz" as Id<"store">,
      timestamp: 2_000,
    });

    expect(second.pendingCheckoutItemId).toBe(first.pendingCheckoutItemId);
    expect(tables.posPendingCheckoutItem.size).toBe(1);
    const item = tables.posPendingCheckoutItem.get(first.pendingCheckoutItemId);
    expect(item?.evidence).toMatchObject({
      observedLookupCodes: ["222222222222"],
      totalQuantitySold: 0,
    });
  });

  it("corrects pending checkout sale evidence when a completed sale is reversed", async () => {
    const { ctx, tables } = createPendingCheckoutCtx(baseSeed);
    const result = await createOrReusePendingCheckoutItem(ctx, {
      createdByUserId: "user0001" as Id<"athenaUser">,
      lookupCode: "556677",
      name: "Committed pending item",
      price: 30000,
      quantitySold: 2,
      storeId: "storezzzz" as Id<"store">,
      timestamp: 1_000,
    });

    await recordPendingCheckoutItemSaleEvidence(ctx, {
      actorUserId: "user0001" as Id<"athenaUser">,
      pendingCheckoutItemId: result.pendingCheckoutItemId,
      posTransactionId: "txn001" as Id<"posTransaction">,
      price: 30000,
      quantitySold: 2,
      source: "online",
      storeId: "storezzzz" as Id<"store">,
      timestamp: 2_000,
    });
    await recordPendingCheckoutItemEvidenceCorrection(ctx, {
      actorUserId: "user0001" as Id<"athenaUser">,
      pendingCheckoutItemId: result.pendingCheckoutItemId,
      posTransactionId: "txn001" as Id<"posTransaction">,
      quantityDelta: -2,
      reason: "transaction_void",
      storeId: "storezzzz" as Id<"store">,
      timestamp: 3_000,
      transactionCountDelta: -1,
    });

    const item = tables.posPendingCheckoutItem.get(result.pendingCheckoutItemId);
    expect(item?.evidence).toMatchObject({
      totalQuantitySold: 0,
      transactionCount: 0,
    });
    expect(Array.from(tables.operationalEvent.values()).at(-1)).toMatchObject({
      eventType: "pos_pending_checkout_item_evidence_corrected",
      posTransactionId: "txn001",
      metadata: expect.objectContaining({
        provisionalProductId: "product001",
        provisionalProductSkuId: "productSku001",
        quantityDelta: -2,
        reason: "transaction_void",
      }),
    });
  });

  it("records distinct operational events for repeated pending checkout evidence corrections", async () => {
    const { ctx, tables } = createPendingCheckoutCtx(baseSeed);
    const result = await createOrReusePendingCheckoutItem(ctx, {
      createdByUserId: "user0001" as Id<"athenaUser">,
      lookupCode: "556677",
      name: "Committed pending item",
      price: 30000,
      quantitySold: 3,
      storeId: "storezzzz" as Id<"store">,
      timestamp: 1_000,
    });

    await recordPendingCheckoutItemSaleEvidence(ctx, {
      actorUserId: "user0001" as Id<"athenaUser">,
      pendingCheckoutItemId: result.pendingCheckoutItemId,
      posTransactionId: "txn001" as Id<"posTransaction">,
      price: 30000,
      quantitySold: 3,
      source: "online",
      storeId: "storezzzz" as Id<"store">,
      timestamp: 2_000,
    });
    await recordPendingCheckoutItemEvidenceCorrection(ctx, {
      actorUserId: "user0001" as Id<"athenaUser">,
      pendingCheckoutItemId: result.pendingCheckoutItemId,
      posTransactionId: "txn001" as Id<"posTransaction">,
      quantityDelta: -1,
      reason: "item_adjustment",
      storeId: "storezzzz" as Id<"store">,
      timestamp: 3_000,
    });
    await recordPendingCheckoutItemEvidenceCorrection(ctx, {
      actorUserId: "user0001" as Id<"athenaUser">,
      pendingCheckoutItemId: result.pendingCheckoutItemId,
      posTransactionId: "txn001" as Id<"posTransaction">,
      quantityDelta: -1,
      reason: "item_adjustment",
      storeId: "storezzzz" as Id<"store">,
      timestamp: 4_000,
    });

    const correctionEvents = Array.from(tables.operationalEvent.values()).filter(
      (event) =>
        event.eventType === "pos_pending_checkout_item_evidence_corrected",
    );

    expect(correctionEvents).toHaveLength(2);
    expect(correctionEvents).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          quantityDelta: -1,
          totalQuantitySold: 2,
        }),
        posTransactionId: "txn001",
      }),
      expect.objectContaining({
        metadata: expect.objectContaining({
          quantityDelta: -1,
          totalQuantitySold: 1,
        }),
        posTransactionId: "txn001",
      }),
    ]);
  });

  it("rejects a pending checkout item when the lookup code already matches trusted catalog stock", async () => {
    const { ctx, tables } = createPendingCheckoutCtx({
      ...baseSeed,
      product: [
        {
          _id: "product-live",
          availability: "live",
          isVisible: true,
          storeId: "storezzzz",
        },
      ],
      productSku: [
        {
          _id: "sku-live",
          barcode: "123456789012",
          isVisible: true,
          productId: "product-live",
          sku: "LIVE-SKU",
          storeId: "storezzzz",
        },
      ],
    });

    await expect(
      createOrReusePendingCheckoutItem(ctx, {
        createdByUserId: "user0001" as Id<"athenaUser">,
        lookupCode: "123456789012",
        name: "Known item",
        price: 30000,
        quantitySold: 1,
        storeId: "storezzzz" as Id<"store">,
      }),
    ).rejects.toThrow("This item is already in the catalog.");

    expect(tables.posPendingCheckoutItem.size).toBe(0);
    expect(tables.operationalWorkItem.size).toBe(0);
  });

  it("uses POS visibility when deciding whether lookup matches trusted catalog stock", async () => {
    for (const [label, productPatch, skuPatch] of [
      ["product POS-hidden", { posVisible: false }, { posVisible: true }],
      ["SKU POS-hidden", { posVisible: true }, { posVisible: false }],
    ] as const) {
      const { ctx, tables } = createPendingCheckoutCtx({
        ...baseSeed,
        product: [
          {
            _id: `product-${label}`,
            availability: "live",
            isVisible: true,
            storeId: "storezzzz",
            ...productPatch,
          },
        ],
        productSku: [
          {
            _id: `sku-${label}`,
            barcode: "123456789012",
            isVisible: true,
            productId: `product-${label}`,
            sku: "LIVE-SKU",
            storeId: "storezzzz",
            ...skuPatch,
          },
        ],
      });

      const result = await createOrReusePendingCheckoutItem(ctx, {
        createdByUserId: "user0001" as Id<"athenaUser">,
        lookupCode: "123456789012",
        name: "Known item",
        price: 30000,
        quantitySold: 1,
        storeId: "storezzzz" as Id<"store">,
      });

      expect(result.status).toBe("pending_review");
      expect(tables.posPendingCheckoutItem.size).toBe(1);
    }

    const legacyHidden = createPendingCheckoutCtx({
      ...baseSeed,
      product: [
        {
          _id: "product-legacy-hidden",
          availability: "live",
          isVisible: false,
          storeId: "storezzzz",
        },
      ],
      productSku: [
        {
          _id: "sku-legacy-hidden",
          barcode: "123456789012",
          isVisible: false,
          productId: "product-legacy-hidden",
          sku: "LEGACY-HIDDEN",
          storeId: "storezzzz",
        },
      ],
    });

    const legacyHiddenResult = await createOrReusePendingCheckoutItem(
      legacyHidden.ctx,
      {
        createdByUserId: "user0001" as Id<"athenaUser">,
        lookupCode: "123456789012",
        name: "Known hidden legacy item",
        price: 30000,
        quantitySold: 1,
        storeId: "storezzzz" as Id<"store">,
      },
    );

    expect(legacyHiddenResult.status).toBe("pending_review");
    expect(legacyHidden.tables.posPendingCheckoutItem.size).toBe(1);

    const { ctx, tables } = createPendingCheckoutCtx({
      ...baseSeed,
      product: [
        {
          _id: "product-online-hidden",
          availability: "live",
          isVisible: false,
          posVisible: true,
          storeId: "storezzzz",
        },
      ],
      productSku: [
        {
          _id: "sku-online-hidden",
          barcode: "123456789012",
          isVisible: false,
          posVisible: true,
          productId: "product-online-hidden",
          sku: "LIVE-SKU",
          storeId: "storezzzz",
        },
      ],
    });

    await expect(
      createOrReusePendingCheckoutItem(ctx, {
        createdByUserId: "user0001" as Id<"athenaUser">,
        lookupCode: "123456789012",
        name: "Known item",
        price: 30000,
        quantitySold: 1,
        storeId: "storezzzz" as Id<"store">,
      }),
    ).rejects.toThrow("This item is already in the catalog.");
    expect(tables.posPendingCheckoutItem.size).toBe(0);
  });

  it("treats visible legacy catalog rows without availability as trusted stock", async () => {
    const { ctx, tables } = createPendingCheckoutCtx({
      ...baseSeed,
      product: [
        {
          _id: "product-legacy",
          isVisible: true,
          storeId: "storezzzz",
        },
      ],
      productSku: [
        {
          _id: "sku-legacy",
          barcode: "123456789012",
          isVisible: true,
          productId: "product-legacy",
          sku: "LEGACY-SKU",
          storeId: "storezzzz",
        },
      ],
    });

    await expect(
      createOrReusePendingCheckoutItem(ctx, {
        createdByUserId: "user0001" as Id<"athenaUser">,
        lookupCode: "123456789012",
        name: "Known legacy item",
        price: 30000,
        quantitySold: 1,
        storeId: "storezzzz" as Id<"store">,
      }),
    ).rejects.toThrow("This item is already in the catalog.");

    expect(tables.posPendingCheckoutItem.size).toBe(0);
  });

  it("rejects invalid quantities instead of treating them as trusted availability", async () => {
    const { ctx } = createPendingCheckoutCtx(baseSeed);

    await expect(
      createOrReusePendingCheckoutItem(ctx, {
        createdByUserId: "user0001" as Id<"athenaUser">,
        name: "Invalid item",
        price: 1000,
        quantitySold: 0,
        storeId: "storezzzz" as Id<"store">,
      }),
    ).rejects.toThrow("Enter a quantity sold greater than zero.");
  });
});

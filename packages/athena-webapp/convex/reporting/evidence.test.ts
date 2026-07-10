import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  decodeEvidenceCursor,
  encodeEvidenceCursor,
  materializePendingCheckoutSkuAttribution,
  recordInventoryEffectSkuEvidenceWithCtx,
  recordPaymentAllocationSkuEvidenceWithCtx,
  sanitizeSourceReference,
} from "./evidence";

describe("reporting evidence", () => {
  it("binds cursors to store, filter, and contract versions", () => {
    const cursor = encodeEvidenceCursor({
      factId: "fact-10",
      factVersion: 1,
      filterKey: "sku:sku-1",
      metricVersion: 1,
      recognizedAt: 500,
      storeId: "store-1",
    });

    expect(
      decodeEvidenceCursor(cursor, {
        factVersion: 1,
        filterKey: "sku:sku-1",
        metricVersion: 1,
        storeId: "store-1",
      }),
    ).toMatchObject({ factId: "fact-10", recognizedAt: 500 });
    expect(() =>
      decodeEvidenceCursor(cursor, {
        factVersion: 1,
        filterKey: "sku:sku-1",
        metricVersion: 1,
        storeId: "store-2",
      }),
    ).toThrow("evidence cursor does not match request");
  });

  it("allows only minimized source references", () => {
    expect(
      sanitizeSourceReference({
        label: "POS 1001",
        sourceId: "transaction-1",
        sourceType: "pos_transaction",
        storeId: "store-1",
      }),
    ).toEqual({
      label: "POS 1001",
      sourceId: "transaction-1",
      sourceType: "pos_transaction",
      storeId: "store-1",
    });
    expect(() =>
      sanitizeSourceReference({
        sourceId: "customer-1",
        sourceType: "customer",
        storeId: "store-1",
      }),
    ).toThrow("source type is not reportable");
  });

  it("reads durable evidence without hydrating deleted or archived source rows", () => {
    const source = readFileSync(
      join(process.cwd(), "convex", "reporting", "evidence.ts"),
      "utf8",
    );
    expect(source).toContain('.query("reportingSkuEvidence")');
    expect(source).not.toMatch(
      /ctx\.db\.get\("(?:posTransaction|onlineOrder|inventoryMovement|paymentAllocation)"/,
    );
    expect(source).not.toContain("generationId: v.id");
    expect(source).toContain("SKU_EVIDENCE_MAX_PAGE_SIZE");
    expect(source).toContain("SKU_EVIDENCE_MAX_PERIOD_MS");
    expect(source).toContain("listSkuEvidence = action");
    expect(source).toContain("preflightListSkuEvidence = internalMutation");
    expect(source).toContain("readSkuEvidencePage = internalQuery");
    expect(source).toContain("knownGrossProfitMinor");
    expect(source).toContain("refundAdjustmentState");
    expect(source).toContain("recognitionProductSkuId");
    expect(source).toContain("originalProductSkuId");
    expect(source).toContain("materializePendingCheckoutSkuAttribution");
    expect(source).toContain("SKU_ATTRIBUTION_PAGE_SIZE");
  });

  it("attributes paginated provisional facts to a canonical SKU without losing recognition lineage", async () => {
    const tables = new Map<string, Map<string, Record<string, unknown>>>([
      [
        "reportingSkuAttribution",
        new Map([
          [
            "attribution-1",
            {
              _id: "attribution-1",
              attemptCount: 0,
              attributionVersion: 1,
              canonicalProductSkuId: "sku-canonical",
              originalProductSkuId: "sku-provisional",
              pendingCheckoutItemId: "pending-1",
              status: "pending",
              storeId: "store-1",
            },
          ],
        ]),
      ],
      [
        "reportingFact",
        new Map([
          [
            "fact-1",
            {
              _id: "fact-1",
              _creationTime: 100,
              acceptedAt: 100,
              amountMinor: 5_000,
              businessEventKey: "pos:transaction-1:complete:line-1",
              completeness: "partial",
              costStatus: "unknown",
              factType: "sale",
              operatingDate: "2026-07-10",
              organizationId: "organization-1",
              pendingCheckoutItemId: "pending-1",
              productSkuId: "sku-provisional",
              revenueKind: "merchandise",
              limitingReason: "uncosted",
              recognitionAt: 100,
              scheduleVersionId: "schedule-1",
              sourceDomain: "pos",
              status: "canonical",
              storeId: "store-1",
            },
          ],
        ]),
      ],
      [
        "reportingProjectionActivation",
        new Map([
          [
            "activation-1",
            {
              _id: "activation-1",
              activatedAt: 100,
              generationId: "generation-1",
              projectionKind: "sku_day",
              storeId: "store-1",
            },
          ],
        ]),
      ],
      [
        "reportingProjectionGeneration",
        new Map([
          [
            "generation-1",
            {
              _id: "generation-1",
              metricContractVersion: 1,
              projectionKind: "sku_day",
              storeId: "store-1",
            },
          ],
        ]),
      ],
      [
        "reportingProjectionEvidence",
        new Map([
          [
            "projection-evidence-1",
            {
              _id: "projection-evidence-1",
              factId: "fact-1",
              generationId: "generation-1",
              metric: "net_sales",
              operatingDate: "2026-07-10",
              productSkuId: "sku-provisional",
              sourceWatermark: 100,
            },
          ],
        ]),
      ],
      [
        "reportingSkuDayProjection",
        new Map([
          [
            "projection-provisional",
            {
              _id: "projection-provisional",
              generationId: "generation-1",
              knownValue: 5_000,
              completeness: "partial",
              limitingReason: "uncosted",
              metric: "net_sales",
              operatingDate: "2026-07-10",
              productSkuId: "sku-provisional",
              projectedAt: 100,
              sourceWatermark: 100,
            },
          ],
          [
            "projection-canonical",
            {
              _id: "projection-canonical",
              completeness: "complete",
              generationId: "generation-1",
              knownValue: 1_000,
              metric: "net_sales",
              operatingDate: "2026-07-10",
              productSkuId: "sku-canonical",
              projectedAt: 100,
              sourceWatermark: 50,
            },
          ],
        ]),
      ],
      [
        "reportingSkuEvidence",
        new Map([
          [
            "evidence-1",
            {
              _id: "evidence-1",
              identityKey: "fact:fact-1",
              productSkuId: "sku-provisional",
              recognitionProductSkuId: "sku-provisional",
              storeId: "store-1",
            },
          ],
        ]),
      ],
    ]);
    const rows = (table: string) => [...(tables.get(table)?.values() ?? [])];
    const ctx = {
      db: {
        delete: async (table: string, id: string) => {
          tables.get(table)?.delete(id);
        },
        get: async (table: string, id: string) =>
          tables.get(table)?.get(id) ?? null,
        patch: async (
          table: string,
          id: string,
          value: Record<string, unknown>,
        ) => {
          const current = tables.get(table)?.get(id);
          if (!current) throw new Error(`missing ${table}:${id}`);
          tables.get(table)!.set(id, { ...current, ...value });
        },
        query: (table: string) => ({
          withIndex: (_index: string, apply: Function) => {
            const filters: Array<[string, unknown]> = [];
            const builder = {
              eq(field: string, value: unknown) {
                filters.push([field, value]);
                return builder;
              },
            };
            apply(builder);
            const matches = () =>
              rows(table).filter((row) =>
                filters.every(([field, value]) => row[field] === value),
              );
            const chain = {
              first: async () => matches()[0] ?? null,
              order: () => chain,
              paginate: async () => ({
                continueCursor: "",
                isDone: true,
                page: matches(),
                pageStatus: null,
                splitCursor: null,
              }),
              take: async (limit: number) => matches().slice(0, limit),
            };
            return chain;
          },
        }),
      },
      scheduler: { runAfter: async () => undefined },
    };
    const handler = (
      materializePendingCheckoutSkuAttribution as unknown as {
        _handler: Function;
      }
    )._handler;

    await expect(
      handler(ctx, { attributionId: "attribution-1", cursor: null }),
    ).resolves.toEqual({ completed: true, processedCount: 1 });
    expect(tables.get("reportingFact")?.get("fact-1")).toMatchObject({
      canonicalProductSkuId: "sku-canonical",
      productSkuId: "sku-provisional",
    });
    expect(tables.get("reportingSkuEvidence")?.get("evidence-1")).toMatchObject(
      {
        attributionKind: "pending_checkout",
        originalProductSkuId: "sku-provisional",
        productSkuId: "sku-canonical",
        recognitionProductSkuId: "sku-provisional",
      },
    );
    expect(
      tables.get("reportingSkuDayProjection")?.get("projection-provisional"),
    ).toBeUndefined();
    expect(
      tables.get("reportingSkuDayProjection")?.get("projection-canonical"),
    ).toMatchObject({ knownValue: 6_000 });
    expect(
      tables.get("reportingProjectionEvidence")?.get("projection-evidence-1"),
    ).toMatchObject({
      attributionKind: "pending_checkout",
      productSkuId: "sku-canonical",
      provisionalProductSkuId: "sku-provisional",
    });
  });

  it("preserves return disposition and quantity in SKU evidence", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const ctx = {
      db: {
        insert: async (_table: string, value: Record<string, unknown>) => {
          inserted.push(value);
          return "evidence-1";
        },
        query: () => ({
          withIndex: (_index: string, apply: Function) => {
            const builder = { eq: () => builder };
            apply(builder);
            return { take: async () => [] };
          },
        }),
      },
    };

    await recordInventoryEffectSkuEvidenceWithCtx(
      ctx as never,
      {
        _id: "effect-1",
        businessEventKey: "storefront:return:line-1",
        completeness: "complete",
        costedQuantityDelta: 0,
        createdAt: 100,
        effectType: "return",
        knownCostPoolDeltaMinor: 0,
        occurrenceAt: 100,
        organizationId: "organization-1",
        physicalQuantityDelta: 0,
        productSkuId: "sku-1",
        returnDisposition: "damaged",
        returnedQuantity: 2,
        sellableQuantityDelta: 0,
        sourceDomain: "storefront",
        storeId: "store-1",
        uncostedQuantityDelta: 0,
        unresolvedDeficitDelta: 0,
        contentFingerprint: "return-1",
      } as never,
    );

    expect(inserted[0]).toMatchObject({
      quantity: 0,
      returnDisposition: "damaged",
      returnedQuantity: 2,
    });
  });

  it("bounds explicit payment SKU evidence before any SKU reads or writes", async () => {
    const inserted: Array<{ table: string; value: Record<string, unknown> }> =
      [];
    let skuReads = 0;
    const ctx = {
      db: {
        get: async () => {
          skuReads += 1;
          return null;
        },
        insert: async (table: string, value: Record<string, unknown>) => {
          inserted.push({ table, value });
          return `${table}-${inserted.length}`;
        },
        query: (table: string) => ({
          withIndex: (_index: string, apply: Function) => {
            const builder = { eq: () => builder };
            apply(builder);
            const rows: Record<string, unknown>[] = [];
            return {
              first: async () => rows[0] ?? null,
              take: async () => rows,
            };
          },
        }),
      },
    };

    await expect(
      recordPaymentAllocationSkuEvidenceWithCtx(
        ctx as never,
        {
          _id: "allocation-large",
          amount: 2_000,
          direction: "out",
          evidenceProductSkuIds: Array.from(
            { length: 101 },
            (_, index) => `sku-${index}`,
          ),
          recordedAt: 100,
          status: "recorded",
          storeId: "store-1",
        } as never,
        "organization-1" as never,
      ),
    ).resolves.toEqual({ itemCount: 101, kind: "truncated" });
    expect(skuReads).toBe(0);
    expect(inserted).toContainEqual({
      table: "reportingQuarantine",
      value: expect.objectContaining({ safeCode: "sku_evidence_truncated" }),
    });
  });

  it("quarantines and skips explicit payment SKU evidence from another store", async () => {
    const inserted: Array<{ table: string; value: Record<string, unknown> }> =
      [];
    const ctx = {
      db: {
        get: async () => ({ _id: "sku-other", storeId: "store-2" }),
        insert: async (table: string, value: Record<string, unknown>) => {
          inserted.push({ table, value });
          return `${table}-${inserted.length}`;
        },
        query: (table: string) => ({
          withIndex: (_index: string, apply: Function) => {
            const builder = { eq: () => builder };
            apply(builder);
            const rows: Record<string, unknown>[] = [];
            return {
              first: async () => rows[0] ?? null,
              take: async () => rows,
            };
          },
        }),
      },
    };

    await expect(
      recordPaymentAllocationSkuEvidenceWithCtx(
        ctx as never,
        {
          _id: "allocation-cross-store",
          amount: 2_000,
          direction: "out",
          evidenceProductSkuIds: ["sku-other"],
          recordedAt: 100,
          status: "recorded",
          storeId: "store-1",
        } as never,
        "organization-1" as never,
      ),
    ).resolves.toEqual({ kind: "recorded", skuCount: 0 });
    expect(inserted).toContainEqual({
      table: "reportingQuarantine",
      value: expect.objectContaining({ safeCode: "cross_store_reference" }),
    });
    expect(inserted.some((row) => row.table === "reportingSkuEvidence")).toBe(
      false,
    );
  });

  it("uses explicit payment SKU evidence, including an explicit empty set", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const ctx = {
      db: {
        get: async (_table: string, productSkuId: string) => ({
          _id: productSkuId,
          storeId: "store-1",
        }),
        insert: async (_table: string, value: Record<string, unknown>) => {
          inserted.push(value);
          return `evidence-${inserted.length}`;
        },
        query: () => ({
          withIndex: (_index: string, apply: Function) => {
            const builder = { eq: () => builder };
            apply(builder);
            return { take: async () => [] };
          },
        }),
      },
    };
    const allocation = {
      _id: "allocation-1",
      amount: 5_000,
      currency: "GHS",
      direction: "in",
      evidenceProductSkuIds: [],
      posTransactionId: "transaction-1",
      recordedAt: 100,
      status: "recorded",
      storeId: "store-1",
    };

    await expect(
      recordPaymentAllocationSkuEvidenceWithCtx(
        ctx as never,
        allocation as never,
        "organization-1" as never,
      ),
    ).resolves.toEqual({ kind: "recorded", skuCount: 0 });
    expect(inserted).toHaveLength(0);

    await expect(
      recordPaymentAllocationSkuEvidenceWithCtx(
        ctx as never,
        { ...allocation, evidenceProductSkuIds: ["sku-explicit"] } as never,
        "organization-1" as never,
      ),
    ).resolves.toEqual({ kind: "recorded", skuCount: 1 });
    expect(inserted[0]).toMatchObject({ productSkuId: "sku-explicit" });
  });

  it("keeps legacy outgoing allocations unattributed without querying all order lines", async () => {
    let queried = false;
    const ctx = {
      db: {
        insert: async () => {
          throw new Error("outgoing allocation should not create SKU evidence");
        },
        query: () => {
          queried = true;
          throw new Error("outgoing allocation should not query order lines");
        },
      },
    };

    await expect(
      recordPaymentAllocationSkuEvidenceWithCtx(
        ctx as never,
        {
          _id: "allocation-refund",
          amount: 2_000,
          direction: "out",
          onlineOrderId: "order-1",
          recordedAt: 100,
          status: "recorded",
          storeId: "store-1",
        } as never,
        "organization-1" as never,
      ),
    ).resolves.toEqual({ kind: "recorded", skuCount: 0 });
    expect(queried).toBe(false);
  });

  it("quarantines oversized payment evidence without failing the allocation path", async () => {
    const inserted: Array<{ table: string; value: Record<string, unknown> }> =
      [];
    const items = Array.from({ length: 101 }, (_, index) => ({
      productSkuId: `sku-${index}`,
    }));
    const ctx = {
      db: {
        insert: async (table: string, value: Record<string, unknown>) => {
          inserted.push({ table, value });
          return `${table}-${inserted.length}`;
        },
        query: (table: string) => ({
          withIndex: (_index: string, apply: Function) => {
            const builder = {
              eq: () => builder,
            };
            apply(builder);
            const rows = table === "posTransactionItem" ? items : [];
            return {
              first: async () => rows[0] ?? null,
              take: async (limit: number) => rows.slice(0, limit),
            };
          },
        }),
      },
    };

    await expect(
      recordPaymentAllocationSkuEvidenceWithCtx(
        ctx as never,
        {
          _id: "allocation-1",
          amount: 5_000,
          direction: "in",
          posTransactionId: "transaction-1",
          recordedAt: 100,
          status: "recorded",
          storeId: "store-1",
        } as never,
        "organization-1" as never,
      ),
    ).resolves.toEqual({ itemCount: 101, kind: "truncated" });
    expect(inserted).toContainEqual({
      table: "reportingQuarantine",
      value: expect.objectContaining({
        safeCode: "sku_evidence_truncated",
        sourceDomain: "payments",
      }),
    });
    expect(
      inserted.filter((row) => row.table === "reportingProjectionHealth"),
    ).toHaveLength(2);
    expect(inserted.some((row) => row.table === "reportingSkuEvidence")).toBe(
      false,
    );
  });
});

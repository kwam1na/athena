import { describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";

vi.mock("./operatingPeriods", () => ({
  resolveReportingFinancialPeriodWithCtx: vi.fn(async () => ({
    kind: "resolved",
    occurrenceAt: 100,
    recognitionAt: 100,
    reportingDate: "2026-07-09",
    scheduleContext: {
      kind: "within_hours",
      operatingDate: "2026-07-09",
      scheduleVersionId: "schedule-1",
    },
    timezone: "Africa/Accra",
    timezoneVersionHash: "timezone-hash-1",
    timezoneVersionId: "timezone-1",
  })),
}));

import {
  appendReportingIngressWithCtx,
  classifyIngressChildCounts,
  processPendingIngress,
  resumePendingIngressForStore,
  REPORTING_INGRESS_LINE_LIMIT,
  REPORTING_INGRESS_SOURCE_REFERENCE_LIMIT,
} from "./ingress";

function context(existing: Array<Record<string, unknown>> = []) {
  const rows = [...existing];
  const inserted: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patched: Array<{ id: string; value: Record<string, unknown> }> = [];
  return {
    inserted,
    patched,
    scheduled: vi.fn(async () => undefined),
    ctx: {
      db: {
        get: vi.fn(async (_table: string, id: string) =>
          rows.find((row) => row._id === id) ?? null,
        ),
        insert: vi.fn(async (table: string, value: Record<string, unknown>) => {
          const id = `${table}-${inserted.length + 1}`;
          inserted.push({ table, value });
          if (table === "reportingIngress") rows.push({ _id: id, ...value });
          return id;
        }),
        patch: vi.fn(async (_table: string, id: string, value: Record<string, unknown>) => {
          patched.push({ id, value });
        }),
        query: vi.fn(() => ({
          withIndex: vi.fn((_index: string, apply: Function) => {
            const values: unknown[] = [];
            const q = {
              eq: vi.fn((_field: string, value: unknown) => {
                values.push(value);
                return q;
              }),
            };
            apply(q);
            const [storeId, sourceDomain, businessEventKey] = values;
            const matches = rows.filter(
              (row) =>
                row.storeId === storeId &&
                row.sourceDomain === sourceDomain &&
                row.businessEventKey === businessEventKey,
            );
            const result = {
              first: vi.fn(async () => matches[0] ?? null),
              order: vi.fn(() => result),
              take: vi.fn(async (limit: number) => matches.slice(0, limit)),
            };
            return result;
          }),
        })),
      },
      scheduler: { runAfter: vi.fn(async (...args: unknown[]) => args) },
    },
  };
}

function canonicalContext() {
  const tables = new Map<string, Map<string, Record<string, unknown>>>();
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name)!;
  };
  table("reportingIngress").set("ingress-1", {
    _id: "ingress-1",
    acceptedAt: 110,
    adapterVersion: 1,
    businessEventKey: "pos:tx-1:complete",
    contentFingerprint: "fingerprint-1",
    currencyCode: "GHS",
    currencyMinorUnitScale: 2,
    factContractVersion: 2,
    occurredAt: 100,
    organizationId: "org-1",
    sourceDomain: "pos",
    sourceEventType: "pos_completed",
    status: "pending",
    storeId: "store-1",
  });
  table("reportingIngressLine").set("line-row-1", {
    _id: "line-row-1",
    costStatus: "unknown",
    discountAmountMinor: 500,
    allocatedDiscountMinor: 500,
    attributionKind: "pending_checkout",
    attributionVersion: 1,
    channel: "pos",
    grossAmountMinor: 5_000,
    ingressId: "ingress-1",
    lineKey: "line-1",
    lineKind: "merchandise",
    netAmountMinor: 4_500,
    originalProductSkuId: "sku-provisional",
    originalQuantity: 1,
    pendingCheckoutItemId: "pending-1",
    productId: "product-1",
    productSkuId: "sku-1",
    provisionalProductSkuId: "sku-provisional",
    quantity: 1,
    recognizedNetAmountMinor: 4_500,
    recognitionCategoryId: "category-1",
    recognitionProductId: "product-1",
    recognitionProductSkuId: "sku-1",
    storeId: "store-1",
    unitPriceMinor: 5_000,
  });
  table("reportingIngressSourceReference").set("ref-1", {
    _id: "ref-1",
    ingressId: "ingress-1",
    relation: "owns",
    sourceId: "tx-1",
    sourceType: "pos_transaction",
    storeId: "store-1",
  });
  let sequence = 0;
  const ctx = {
    db: {
      async get(name: string, id: string) {
        return table(name).get(id) ?? null;
      },
      async insert(name: string, value: Record<string, unknown>) {
        sequence += 1;
        const id = `${name}-${sequence}`;
        table(name).set(id, { _id: id, ...value });
        return id;
      },
      async patch(name: string, id: string, value: Record<string, unknown>) {
        const current = table(name).get(id);
        if (!current) throw new Error(`Missing ${name}:${id}`);
        table(name).set(id, { ...current, ...value });
      },
      query(name: string) {
        return {
          withIndex(_index: string, apply: Function) {
            const filters: Array<[string, unknown]> = [];
            const builder = {
              eq(field: string, value: unknown) {
                filters.push([field, value]);
                return builder;
              },
            };
            apply(builder);
            const rows = () =>
              Array.from(table(name).values()).filter((row) =>
                filters.every(([field, value]) => row[field] === value),
              );
            const chain = {
              first: async () => rows()[0] ?? null,
              order: () => chain,
              take: async (limit: number) => rows().slice(0, limit),
            };
            return chain;
          },
        };
      },
    },
    scheduler: { runAfter: vi.fn(async () => undefined) },
  };
  return { ctx, table };
}

const baseArgs = {
  organizationId: "org-1" as Id<"organization">,
  storeId: "store-1" as Id<"store">,
  sourceDomain: "pos" as const,
  sourceEventType: "sale_completed",
  businessEventKey: "sale:tx-1:completed",
  adapterVersion: 1,
  factContractVersion: 2,
  occurredAt: 100,
  acceptedAt: 110,
  contentFingerprint: "sha256:one",
  materialFields: ["amountMinor"],
  sourceReferences: [
    { sourceType: "pos_transaction", sourceId: "tx-1", relation: "owns" as const },
  ],
};

describe("reporting ingress", () => {
  it("defines hard child bounds without silently truncating overflow", () => {
    expect(
      classifyIngressChildCounts({
        lineCount: 1,
        sourceReferenceCount: 1,
      }),
    ).toEqual({ reason: null, status: "eligible" });
    expect(
      classifyIngressChildCounts({
        lineCount: REPORTING_INGRESS_LINE_LIMIT,
        sourceReferenceCount: REPORTING_INGRESS_SOURCE_REFERENCE_LIMIT,
      }),
    ).toEqual({
      reason: "ingress_processing_write_limit_exceeded",
      status: "quarantined",
    });
    expect(
      classifyIngressChildCounts({
        lineCount: REPORTING_INGRESS_LINE_LIMIT + 1,
        sourceReferenceCount: 0,
      }),
    ).toEqual({
      reason: "ingress_line_limit_exceeded",
      status: "quarantined",
    });
    expect(
      classifyIngressChildCounts({
        lineCount: 0,
        sourceReferenceCount: REPORTING_INGRESS_SOURCE_REFERENCE_LIMIT + 1,
      }),
    ).toEqual({
      reason: "ingress_source_reference_limit_exceeded",
      status: "quarantined",
    });
  });

  it.each([
    "operational_event",
    "pos_transaction_adjustment",
    "purchase_order_line",
    "purchase_order_receiving_batch",
  ])("accepts the live %s source reference", async (sourceType) => {
    const { ctx } = context();
    await expect(
      appendReportingIngressWithCtx(ctx as never, {
        ...baseArgs,
        businessEventKey: `source:${sourceType}`,
        contentFingerprint: `source:${sourceType}`,
        sourceReferences: [
          { relation: "owns", sourceId: "source-1", sourceType },
        ],
      }),
    ).resolves.toMatchObject({ kind: "appended" });
  });

  it("appends once, stores child source references, and schedules continuation", async () => {
    const { ctx, inserted } = context();
    await expect(
      appendReportingIngressWithCtx(ctx as never, baseArgs),
    ).resolves.toMatchObject({ kind: "appended" });

    expect(inserted.map((row) => row.table)).toEqual([
      "reportingIngress",
      "reportingIngressSourceReference",
    ]);
    expect(ctx.scheduler.runAfter).toHaveBeenCalledTimes(1);
  });

  it("keeps the durable ingress pending when scheduling is unavailable", async () => {
    const { ctx, inserted, patched } = context();
    ctx.scheduler.runAfter.mockRejectedValueOnce(new Error("scheduler unavailable"));

    await expect(
      appendReportingIngressWithCtx(ctx as never, baseArgs),
    ).resolves.toMatchObject({ kind: "appended" });
    expect(inserted).toContainEqual({
      table: "reportingIngress",
      value: expect.objectContaining({ status: "pending" }),
    });
    expect(inserted).toContainEqual({
      table: "reportingFactProcessingAttempt",
      value: expect.objectContaining({
        adapterVersion: 1,
        attempt: 1,
        factContractVersion: 2,
        metricContractVersion: 1,
        outcome: "failed",
        projectionContractVersion: 2,
        recoveryDisposition: "retry_pending",
        safeCode: "initial_processing_schedule_failed",
      }),
    });
    expect(patched).toContainEqual({
      id: expect.stringMatching(/^reportingIngress-/),
      value: expect.objectContaining({
        attemptCount: 1,
        firstFailureAt: expect.any(Number),
        latestFailureAt: expect.any(Number),
        latestFailureCode: "initial_processing_schedule_failed",
        recoveryDisposition: "retry_pending",
      }),
    });
  });

  it("quarantines oversized ingress before storing partial children or scheduling", async () => {
    const { ctx, inserted, patched } = context();
    const lines = Array.from(
      { length: REPORTING_INGRESS_LINE_LIMIT + 1 },
      (_, index) => ({
        costStatus: "unknown" as const,
        grossAmountMinor: 100,
        lineKey: `line-${index}`,
        lineKind: "merchandise" as const,
        netAmountMinor: 100,
        quantity: 1,
      }),
    );

    await expect(
      appendReportingIngressWithCtx(ctx as never, { ...baseArgs, lines }),
    ).resolves.toMatchObject({
      kind: "quarantined",
      reason: "ingress_line_limit_exceeded",
    });

    expect(
      inserted.filter((row) => row.table === "reportingIngressLine"),
    ).toEqual([]);
    expect(
      inserted.filter(
        (row) => row.table === "reportingIngressSourceReference",
      ),
    ).toEqual([]);
    expect(inserted).toContainEqual({
      table: "reportingQuarantine",
      value: expect.objectContaining({
        safeCode: "ingress_line_limit_exceeded",
        status: "open",
      }),
    });
    expect(inserted).toContainEqual({
      table: "reportingFactProcessingAttempt",
      value: expect.objectContaining({
        outcome: "deferred",
        recoveryDisposition: "quarantined",
        safeCode: "ingress_line_limit_exceeded",
      }),
    });
    expect(patched).toContainEqual({
      id: expect.stringMatching(/^reportingIngress-/),
      value: expect.objectContaining({
        recoveryDisposition: "quarantined",
        status: "quarantined",
      }),
    });
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("quarantines source-reference overflow without persisting a partial list", async () => {
    const { ctx, inserted } = context();
    const sourceReferences = Array.from(
      { length: REPORTING_INGRESS_SOURCE_REFERENCE_LIMIT + 1 },
      (_, index) => ({
        relation: "supports" as const,
        sourceId: `tx-${index}`,
        sourceType: "pos_transaction",
      }),
    );

    await expect(
      appendReportingIngressWithCtx(ctx as never, {
        ...baseArgs,
        sourceReferences,
      }),
    ).resolves.toMatchObject({
      kind: "quarantined",
      reason: "ingress_source_reference_limit_exceeded",
    });
    expect(
      inserted.filter(
        (row) => row.table === "reportingIngressSourceReference",
      ),
    ).toEqual([]);
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("stores unknown line cost without fabricating zero COGS", async () => {
    const { ctx, inserted } = context();
    await appendReportingIngressWithCtx(ctx as never, {
      ...baseArgs,
      lines: [
        {
          costStatus: "unknown",
          discountAmountMinor: 0,
          grossAmountMinor: 5_000,
          lineKey: "line-1",
          lineKind: "merchandise",
          netAmountMinor: 5_000,
          productSkuId: "sku-1" as Id<"productSku">,
          quantity: 1,
        },
      ],
    });

    expect(inserted).toContainEqual({
      table: "reportingIngressLine",
      value: expect.objectContaining({
        costStatus: "unknown",
        lineKey: "line-1",
        productSkuId: "sku-1",
      }),
    });
    expect(
      inserted.find((row) => row.table === "reportingIngressLine")?.value,
    ).not.toHaveProperty("cogsKnownMinor");
  });

  it("accepts partial cost evidence with known and uncovered quantities", async () => {
    const { ctx, inserted } = context();
    await appendReportingIngressWithCtx(ctx as never, {
      ...baseArgs,
      currencyCode: "GHS",
      currencyMinorUnitScale: 2,
      lines: [
        {
          cogsKnownMinor: 400,
          cogsKnownQuantity: 1,
          cogsUncoveredQuantity: 4,
          costStatus: "partial",
          discountAmountMinor: 0,
          grossAmountMinor: 5_000,
          lineKey: "line-1",
          lineKind: "merchandise",
          netAmountMinor: 5_000,
          productSkuId: "sku-1" as Id<"productSku">,
          quantity: 5,
          valuationCurrencyCode: "GHS",
          valuationCurrencyMinorUnitScale: 2,
        },
      ],
    });

    expect(inserted).toContainEqual({
      table: "reportingIngressLine",
      value: expect.objectContaining({
        cogsKnownMinor: 400,
        cogsKnownQuantity: 1,
        cogsUncoveredQuantity: 4,
        costStatus: "partial",
      }),
    });
  });

  it("treats an identical identity and fingerprint as a replay", async () => {
    const { ctx, inserted } = context([
      { _id: "ingress-1", ...baseArgs, status: "pending" },
    ]);

    await expect(
      appendReportingIngressWithCtx(ctx as never, baseArgs),
    ).resolves.toEqual({ kind: "replay", ingressId: "ingress-1" });
    expect(inserted).toEqual([]);
  });

  it("quarantines conflicting key reuse with sanitized evidence", async () => {
    const { ctx, inserted, patched } = context([
      {
        _id: "ingress-1",
        ...baseArgs,
        contentFingerprint: "sha256:original",
        status: "pending",
      },
    ]);

    await expect(
      appendReportingIngressWithCtx(ctx as never, {
        ...baseArgs,
        contentFingerprint: "sha256:changed",
        materialFields: ["amountMinor", "customerEmail"],
      }),
    ).resolves.toMatchObject({ kind: "conflict", ingressId: "ingress-1" });
    expect(inserted).toContainEqual({
      table: "reportingIngressConflict",
      value: expect.objectContaining({
        expectedFingerprint: "sha256:original",
        receivedFingerprint: "sha256:changed",
        materialFields: ["amountMinor"],
      }),
    });
    expect(inserted).toContainEqual({
      table: "reportingQuarantine",
      value: expect.objectContaining({
        safeCode: "duplicate_conflict",
        sourceDomain: "pos",
        status: "open",
      }),
    });
    expect(
      inserted.filter((row) => row.table === "reportingProjectionHealth"),
    ).toHaveLength(2);
    expect(inserted).toContainEqual({
      table: "reportingFactProcessingAttempt",
      value: expect.objectContaining({
        outcome: "deferred",
        recoveryDisposition: "quarantined",
        safeCode: "duplicate_conflict",
      }),
    });
    expect(patched).toContainEqual({
      id: "ingress-1",
      value: expect.objectContaining({ status: "conflict" }),
    });
  });

  it("canonicalizes line revenue and discount without inventing missing COGS", async () => {
    const { ctx, table } = canonicalContext();
    const handler = (processPendingIngress as unknown as { _handler: Function })
      ._handler;

    await handler(ctx, { ingressId: "ingress-1" });

    const facts = Array.from(table("reportingFact").values());
    expect(facts).toHaveLength(2);
    expect(facts).toContainEqual(
      expect.objectContaining({
        amountMinor: 5_000,
        completeness: "partial",
        costStatus: "unknown",
        factType: "sale",
        allocatedDiscountMinor: 500,
        attributionKind: "pending_checkout",
        channel: "pos",
        originalProductSkuId: "sku-provisional",
        originalQuantity: 1,
        pendingCheckoutItemId: "pending-1",
        productSkuId: "sku-1",
        provisionalProductSkuId: "sku-provisional",
        recognizedNetAmountMinor: 4_500,
        recognitionCategoryId: "category-1",
        recognitionProductId: "product-1",
        recognitionProductSkuId: "sku-1",
        sourceLineKey: "line-1",
        unitPriceMinor: 5_000,
      }),
    );
    expect(facts).toContainEqual(
      expect.objectContaining({ amountMinor: 500, factType: "discount" }),
    );
    expect(facts.find((fact) => fact.factType === "sale")).not.toHaveProperty(
      "cogsKnownMinor",
    );
    expect(table("reportingIngress").get("ingress-1")).toMatchObject({
      status: "processed",
    });
  });

  it("discovers recognition-time provisional lines through their canonical SKU", async () => {
    const { ctx, table } = canonicalContext();
    table("reportingSkuAttribution").set("attribution-1", {
      _id: "attribution-1",
      canonicalProductSkuId: "sku-canonical",
      originalProductSkuId: "sku-provisional",
      pendingCheckoutItemId: "pending-1",
      status: "pending",
      storeId: "store-1",
    });
    const handler = (processPendingIngress as unknown as { _handler: Function })
      ._handler;

    await handler(ctx, { ingressId: "ingress-1" });

    const saleFact = Array.from(table("reportingFact").values()).find(
      (fact) => fact.factType === "sale",
    );
    expect(saleFact).toMatchObject({
      canonicalProductSkuId: "sku-canonical",
      originalProductSkuId: "sku-provisional",
      pendingCheckoutItemId: "pending-1",
      productSkuId: "sku-1",
      recognitionProductSkuId: "sku-1",
    });
    expect(Array.from(table("reportingSkuEvidence").values())).toContainEqual(
      expect.objectContaining({
        originalProductSkuId: "sku-provisional",
        productSkuId: "sku-canonical",
        recognitionProductSkuId: "sku-1",
      }),
    );
  });

  it("keeps canonical facts retryable when projection scheduling fails", async () => {
    const { ctx, table } = canonicalContext();
    ctx.scheduler.runAfter.mockRejectedValueOnce(
      new Error("projection scheduler unavailable"),
    );
    const handler = (processPendingIngress as unknown as { _handler: Function })
      ._handler;

    await expect(handler(ctx, { ingressId: "ingress-1" })).resolves.toHaveLength(
      2,
    );

    expect(table("reportingFact")).toHaveLength(2);
    expect(table("reportingIngress").get("ingress-1")).toMatchObject({
      attemptCount: 1,
      latestFailureCode: "projection_schedule_failed",
      recoveryDisposition: "retry_pending",
      status: "pending",
    });
    expect(
      Array.from(table("reportingFactProcessingAttempt").values()),
    ).toContainEqual(
      expect.objectContaining({
        outcome: "failed",
        safeCode: "projection_schedule_failed",
      }),
    );
  });

  it("sweeps only a bounded store-scoped pending batch", async () => {
    const { ctx, table } = canonicalContext();
    table("reportingIngress").set("ingress-other", {
      ...table("reportingIngress").get("ingress-1"),
      _id: "ingress-other",
      storeId: "store-2",
    });
    const handler = (
      resumePendingIngressForStore as unknown as { _handler: Function }
    )._handler;

    await expect(
      handler(ctx, { limit: 1, storeId: "store-1" }),
    ).resolves.toMatchObject({
      inspectedCount: 1,
      scheduledCount: 1,
      storeId: "store-1",
    });
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      expect.anything(),
      { ingressId: "ingress-1" },
    );
    expect(table("reportingIngress").get("ingress-other")).not.toHaveProperty(
      "lastRecoveryAttemptAt",
    );
  });

  it("recovers a bounded retry-pending conflict without a repeated observation", async () => {
    const { ctx, table } = canonicalContext();
    table("reportingIngress").get("ingress-1")!.status = "processed";
    table("reportingSkuAttribution").set("attribution-conflict", {
      _id: "attribution-conflict",
      attemptCount: 1,
      recoveryDisposition: "retry_pending",
      status: "conflict",
      storeId: "store-1",
      updatedAt: 90,
    });
    const handler = (
      resumePendingIngressForStore as unknown as { _handler: Function }
    )._handler;

    await expect(
      handler(ctx, { limit: 1, storeId: "store-1" }),
    ).resolves.toMatchObject({
      attributionScheduledCount: 1,
      inspectedCount: 1,
    });
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      expect.anything(),
      { attributionId: "attribution-conflict", cursor: null },
    );
    expect(table("reportingSkuAttribution").get("attribution-conflict"))
      .toMatchObject({
        recoveryDisposition: "retry_scheduled",
        status: "conflict",
      });
  });

  it("persists partial known COGS and proportional revenue coverage", async () => {
    const { ctx, table } = canonicalContext();
    table("reportingIngressLine").set("line-row-1", {
      ...table("reportingIngressLine").get("line-row-1"),
      cogsKnownMinor: 400,
      cogsKnownQuantity: 1,
      cogsUncoveredQuantity: 4,
      costStatus: "partial",
      discountAmountMinor: 0,
      grossAmountMinor: 5_000,
      netAmountMinor: 5_000,
      quantity: 5,
      valuationCurrencyCode: "GHS",
      valuationCurrencyMinorUnitScale: 2,
    });
    const handler = (processPendingIngress as unknown as { _handler: Function })
      ._handler;

    await handler(ctx, { ingressId: "ingress-1" });

    expect(Array.from(table("reportingFact").values())).toContainEqual(
      expect.objectContaining({
        cogsKnownMinor: 400,
        cogsKnownQuantity: 1,
        cogsUncoveredQuantity: 4,
        completeness: "partial",
        costStatus: "partial",
        coveredRevenueMinor: 1_000,
        limitingReason: "uncosted",
        valuationCurrencyCode: "GHS",
        valuationCurrencyMinorUnitScale: 2,
      }),
    );
  });

  it("canonicalizes a line-bearing refund with SKU and source-line attribution", async () => {
    const { ctx, table } = canonicalContext();
    table("reportingIngress").set("ingress-1", {
      ...table("reportingIngress").get("ingress-1"),
      businessEventKey: "storefront:order-1:refund:refund-1",
      linkedBusinessEventKey: "storefront:order-1:fulfilled",
      netAmountMinor: 4_500,
      settlementAmountMinor: 4_500,
      sourceDomain: "storefront",
      sourceEventType: "storefront_refund_finalized",
    });
    const handler = (processPendingIngress as unknown as { _handler: Function })
      ._handler;

    await handler(ctx, { ingressId: "ingress-1" });

    expect(Array.from(table("reportingFact").values())).toEqual([
      expect.objectContaining({
        amountMinor: -4_500,
        businessEventKey:
          "storefront:order-1:refund:refund-1:line:line-1:refund",
        factType: "refund",
        linkedBusinessEventKey: "storefront:order-1:fulfilled",
        productSkuId: "sku-1",
        sourceLineKey: "line-1",
      }),
    ]);
  });

  it("quarantines semantic canonical-fact conflicts before writing facts", async () => {
    const { ctx, table } = canonicalContext();
    table("reportingFact").set("fact-existing", {
      _id: "fact-existing",
      businessEventKey: "pos:tx-1:complete:line:line-1:sale",
      contentFingerprint: "different-semantics",
      sourceDomain: "pos",
      storeId: "store-1",
    });
    const handler = (processPendingIngress as unknown as { _handler: Function })
      ._handler;

    await expect(handler(ctx, { ingressId: "ingress-1" })).resolves.toBeNull();

    expect(table("reportingFact")).toHaveLength(1);
    expect(table("reportingIngress").get("ingress-1")).toMatchObject({
      status: "quarantined",
    });
    expect(Array.from(table("reportingQuarantine").values())).toContainEqual(
      expect.objectContaining({ safeCode: "canonical_fact_conflict" }),
    );
  });

  it.each([
    {
      expectedAmount: -4_500,
      expectedQuantity: -1,
      expectedType: "void",
      sourceEventType: "pos_transaction_voided",
    },
    {
      expectedAmount: 4_500,
      expectedQuantity: 1,
      expectedType: "correction",
      sourceEventType: "pos_item_correction",
    },
  ])(
    "canonicalizes line-bearing $expectedType events without relabeling them as sales",
    async ({
      expectedAmount,
      expectedQuantity,
      expectedType,
      sourceEventType,
    }) => {
      const { ctx, table } = canonicalContext();
      table("reportingIngress").set("ingress-1", {
        ...table("reportingIngress").get("ingress-1"),
        sourceEventType,
      });
      table("reportingIngressLine").set("line-row-1", {
        ...table("reportingIngressLine").get("line-row-1"),
        discountAmountMinor: 0,
      });
      const handler = (
        processPendingIngress as unknown as { _handler: Function }
      )._handler;

      await handler(ctx, { ingressId: "ingress-1" });

      const facts = Array.from(table("reportingFact").values());
      expect(facts).toHaveLength(1);
      expect(facts[0]).toMatchObject({
        amountMinor: expectedAmount,
        factType: expectedType,
        quantity: expectedQuantity,
        revenueKind: "merchandise",
      });
    },
  );

  it("canonicalizes purchase-order close deltas as signed commitment facts", async () => {
    const { ctx, table } = canonicalContext();
    table("reportingIngress").set("ingress-1", {
      ...table("reportingIngress").get("ingress-1"),
      sourceDomain: "procurement",
      sourceEventType: "purchase_order_commitment_released",
    });
    table("reportingIngressLine").set("line-row-1", {
      ...table("reportingIngressLine").get("line-row-1"),
      costStatus: "not_applicable",
      discountAmountMinor: 0,
      grossAmountMinor: -300,
      netAmountMinor: -300,
      quantity: -3,
    });
    const handler = (processPendingIngress as unknown as { _handler: Function })
      ._handler;

    await handler(ctx, { ingressId: "ingress-1" });

    expect(Array.from(table("reportingFact").values())).toContainEqual(
      expect.objectContaining({
        amountMinor: -300,
        factType: "procurement_commitment",
        quantity: -3,
        sourceLineKey: "line-1",
      }),
    );
  });

  it("fails closed when persisted child rows exceed the processing bound", async () => {
    const { ctx, table } = canonicalContext();
    for (let index = 1; index <= REPORTING_INGRESS_LINE_LIMIT; index += 1) {
      table("reportingIngressLine").set(`line-row-${index + 1}`, {
        _id: `line-row-${index + 1}`,
        costStatus: "unknown",
        grossAmountMinor: 100,
        ingressId: "ingress-1",
        lineKey: `line-${index + 1}`,
        lineKind: "merchandise",
        netAmountMinor: 100,
        quantity: 1,
        storeId: "store-1",
      });
    }
    const handler = (processPendingIngress as unknown as { _handler: Function })
      ._handler;

    await expect(handler(ctx, { ingressId: "ingress-1" })).resolves.toBeNull();

    expect(table("reportingFact").size).toBe(0);
    expect(table("reportingIngress").get("ingress-1")).toMatchObject({
      status: "quarantined",
    });
    expect(Array.from(table("reportingFactProcessingAttempt").values())).toContainEqual(
      expect.objectContaining({
        outcome: "deferred",
        safeReason: "ingress_line_limit_exceeded",
      }),
    );
  });
});

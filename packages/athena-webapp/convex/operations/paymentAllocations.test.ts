/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import { foldDay } from "../reports/foldDay";

const modules = import.meta.glob("../**/*.ts");

const reportingMocks = vi.hoisted(() => ({
  recordFacts: vi.fn(async (..._args: unknown[]) => undefined),
}));

// Only the emission boundary is stubbed; the rest of the module stays real so
// the integration case below can hand the mock the genuine implementation.
vi.mock("../reports/ingest", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../reports/ingest")>()),
  recordFacts: reportingMocks.recordFacts,
}));
import {
  buildPaymentAllocation,
  findSameAmountSinglePaymentAllocation,
  paymentAllocationReportingDimensions,
  recordPaymentAllocationWithCtx,
  summarizePaymentAllocations,
  voidPaymentAllocationWithCtx,
} from "./paymentAllocations";

function paymentContext(initial: Array<Record<string, unknown>> = []) {
  const rows = [...initial];
  const insert = vi.fn(async (_table: string, value: Record<string, unknown>) => {
    const id = `allocation_${rows.length + 1}`;
    rows.push({ _id: id, ...value });
    return id;
  });
  const patch = vi.fn(
    async (_table: string, id: string, value: Record<string, unknown>) => {
      const index = rows.findIndex((row) => row._id === id);
      if (index >= 0) rows[index] = { ...rows[index], ...value };
    },
  );
  return {
    insert,
    patch,
    rows,
    ctx: {
      db: {
        get: vi.fn(async (table: string, id: string) =>
          table === "store"
            ? { _id: id, currency: "GHS", organizationId: "organization_1" }
            : rows.find((row) => row._id === id) ?? null,
        ),
        insert,
        patch,
        query: vi.fn(() => ({
          withIndex: vi.fn((index: string, apply: Function) => {
            const values: unknown[] = [];
            const q = {
              eq: vi.fn((_field: string, value: unknown) => {
                values.push(value);
                return q;
              }),
            };
            apply(q);
            const matches = rows.filter((row) =>
              index === "by_storeId_businessEventKey"
                ? row.storeId === values[0] && row.businessEventKey === values[1]
                : row.storeId === values[0] &&
                  row.targetType === values[1] &&
                  row.targetId === values[2],
            );
            return {
              collect: vi.fn(async () => matches),
              take: vi.fn(async (limit: number) => matches.slice(0, limit)),
            };
          }),
        })),
      },
    },
  };
}

describe("payment allocation helpers", () => {
  it("characterizes signed aggregate reporting dimensions without tender identity", () => {
    expect(
      paymentAllocationReportingDimensions({ amount: 2_500, direction: "in", status: "recorded" }),
    ).toEqual({
      factKind: "payment",
      amountMinor: 2_500,
      paymentAllocationMinor: 2_500,
      paymentAllocationCoverage: "known",
    });
    expect(
      paymentAllocationReportingDimensions({ amount: 2_500, direction: "out", status: "recorded" }),
    ).toMatchObject({ factKind: "payment_refund", paymentAllocationMinor: -2_500 });
  });

  it("stamps a new incoming-allocation void without changing collection time", async () => {
    const recordedAt = 1_700_000_000_000;
    const voidedAt = recordedAt + 60_000;
    const now = vi.spyOn(Date, "now").mockReturnValue(voidedAt);
    const { ctx, patch } = paymentContext([
      {
        _id: "allocation_1",
        allocationType: "retail_sale",
        amount: 2_500,
        collectedInStore: true,
        direction: "in",
        method: "cash",
        recordedAt,
        status: "recorded",
        storeId: "store_1",
        targetId: "transaction_1",
        targetType: "pos_transaction",
      },
    ]);

    const allocation = await voidPaymentAllocationWithCtx(
      ctx as never,
      "allocation_1" as Id<"paymentAllocation">,
    );

    expect(patch).toHaveBeenCalledWith("paymentAllocation", "allocation_1", {
      status: "voided",
      voidedAt,
    });
    expect(allocation).toMatchObject({ recordedAt, status: "voided", voidedAt });
    expect(reportingMocks.recordFacts).toHaveBeenLastCalledWith(
      expect.anything(),
      "store_1",
      [
        expect.objectContaining({
          factKind: "payment_refund",
          occurredAt: voidedAt,
          paymentAllocationMinor: -2_500,
        }),
      ],
    );
    now.mockRestore();
  });

  it("does not invent a reversal time for a legacy voided allocation", async () => {
    reportingMocks.recordFacts.mockClear();
    const { ctx, patch } = paymentContext([
      {
        _id: "allocation_1",
        allocationType: "retail_sale",
        amount: 2_500,
        collectedInStore: true,
        direction: "in",
        method: "cash",
        recordedAt: 1_700_000_000_000,
        status: "voided",
        storeId: "store_1",
        targetId: "transaction_1",
        targetType: "pos_transaction",
      },
    ]);

    const allocation = await voidPaymentAllocationWithCtx(
      ctx as never,
      "allocation_1" as Id<"paymentAllocation">,
    );

    expect(allocation.voidedAt).toBeUndefined();
    expect(patch).not.toHaveBeenCalled();
    expect(reportingMocks.recordFacts).not.toHaveBeenCalled();
  });

  it("records a legacy voided allocation as omitted coverage, matching reseed", async () => {
    reportingMocks.recordFacts.mockClear();
    const recordedAt = 1_700_000_000_000;
    const { ctx } = paymentContext([
      {
        _id: "allocation_1",
        allocationType: "retail_sale",
        amount: 2_500,
        collectedInStore: true,
        direction: "in",
        method: "cash",
        recordedAt,
        status: "voided",
        storeId: "store_1",
        targetId: "transaction_1",
        targetType: "pos_transaction",
      },
    ]);

    await recordPaymentAllocationWithCtx(ctx as never, {
      allocationType: "retail_sale",
      amount: 2_500,
      collectedInStore: true,
      direction: "in",
      method: "cash",
      storeId: "store_1" as Id<"store">,
      targetId: "transaction_1",
      targetType: "pos_transaction",
    });

    // No reversal time exists, so the collection is disclosed at its own time
    // with unknown coverage rather than dropped from the day entirely.
    expect(reportingMocks.recordFacts).toHaveBeenLastCalledWith(
      expect.anything(),
      "store_1",
      [
        expect.objectContaining({
          factKind: "payment",
          netAmountMinor: 2_500,
          occurredAt: recordedAt,
          paymentAllocationCoverage: "unknown",
        }),
      ],
    );
    expect(
      reportingMocks.recordFacts.mock.calls.at(-1)?.[2] as Array<
        Record<string, unknown>
      >,
    ).toEqual([
      expect.not.objectContaining({ paymentAllocationMinor: expect.anything() }),
    ]);
  });

  it("preserves an outbound-refund void as omitted coverage, not a new collection", async () => {
    reportingMocks.recordFacts.mockClear();
    const voidedAt = 1_700_000_060_000;
    const now = vi.spyOn(Date, "now").mockReturnValue(voidedAt);
    const { ctx, patch } = paymentContext([
      {
        _id: "allocation_1",
        allocationType: "retail_refund",
        amount: 2_500,
        collectedInStore: true,
        direction: "out",
        method: "cash",
        recordedAt: 1_700_000_000_000,
        status: "recorded",
        storeId: "store_1",
        targetId: "transaction_1",
        targetType: "pos_transaction",
      },
    ]);

    await expect(
      voidPaymentAllocationWithCtx(
        ctx as never,
        "allocation_1" as Id<"paymentAllocation">,
      ),
    ).resolves.toMatchObject({ status: "voided", voidedAt });
    expect(patch).toHaveBeenCalledWith("paymentAllocation", "allocation_1", {
      status: "voided",
      voidedAt,
    });
    // A reversal of a refund has no fact kind of its own; reseed and the live
    // path both fall back to the refund at its own time, coverage unknown.
    expect(reportingMocks.recordFacts).toHaveBeenLastCalledWith(
      expect.anything(),
      "store_1",
      [
        expect.objectContaining({
          factKind: "payment_refund",
          occurredAt: 1_700_000_000_000,
          paymentAllocationCoverage: "unknown",
        }),
      ],
    );
    now.mockRestore();
  });
  it("builds incoming payment allocations with store-collection metadata", () => {
    const allocation = buildPaymentAllocation({
      storeId: "store_1" as Id<"store">,
      targetType: "service_intake",
      targetId: "intake_1",
      allocationType: "deposit",
      method: "cash",
      amount: 2500,
      collectedInStore: true,
    });

    expect(allocation).toMatchObject({
      storeId: "store_1",
      targetType: "service_intake",
      allocationType: "deposit",
      direction: "in",
      method: "cash",
      amount: 2500,
      collectedInStore: true,
      status: "recorded",
    });
    expect(allocation.recordedAt).toEqual(expect.any(Number));
  });

  it("stores an explicit canonical SKU evidence scope", () => {
    const allocation = buildPaymentAllocation({
      allocationType: "retail_refund",
      amount: 2500,
      evidenceProductSkuIds: [
        "sku_2" as Id<"productSku">,
        "sku_1" as Id<"productSku">,
        "sku_2" as Id<"productSku">,
      ],
      method: "cash",
      storeId: "store_1" as Id<"store">,
      targetId: "order_1",
      targetType: "online_order",
    });

    expect(allocation.evidenceProductSkuIds).toEqual(["sku_1", "sku_2"]);
  });

  it("summarizes in and out allocations into a net amount", () => {
    expect(
      summarizePaymentAllocations([
        { direction: "in", amount: 8000 },
        { direction: "out", amount: 2500 },
        { direction: "in", amount: 1000 },
      ])
    ).toEqual({
      totalIn: 9000,
      totalOut: 2500,
      netAmount: 6500,
    });
  });

  it("characterizes correction support as one recorded incoming allocation with the same amount", () => {
    expect(
      findSameAmountSinglePaymentAllocation(
        [
          {
            _id: "allocation_1" as Id<"paymentAllocation">,
            direction: "in",
            recordedAt: 1_700_000_000_000,
            method: "cash",
            amount: 2500,
            status: "recorded",
          },
        ],
        { amount: 2500 },
      ),
    ).toMatchObject({
      _id: "allocation_1",
      method: "cash",
      amount: 2500,
    });
  });

  it("does not support payment-method correction when allocation cardinality or amount changes", () => {
    expect(
      findSameAmountSinglePaymentAllocation(
        [
          {
            _id: "allocation_1" as Id<"paymentAllocation">,
            direction: "in",
            recordedAt: 1_700_000_000_000,
            method: "cash",
            amount: 1500,
            status: "recorded",
          },
          {
            _id: "allocation_2" as Id<"paymentAllocation">,
            direction: "in",
            recordedAt: 1_700_000_000_000,
            method: "card",
            amount: 1000,
            status: "recorded",
          },
        ],
        { amount: 2500 },
      ),
    ).toBeNull();

    expect(
      findSameAmountSinglePaymentAllocation(
        [
          {
            _id: "allocation_1" as Id<"paymentAllocation">,
            direction: "in",
            recordedAt: 1_700_000_000_000,
            method: "cash",
            amount: 2000,
            status: "recorded",
          },
        ],
        { amount: 2500 },
      ),
    ).toBeNull();
  });

  it("keeps equal payments distinct when their business-event keys differ", async () => {
    const { ctx, rows } = paymentContext();
    const base = {
      storeId: "store_1" as Id<"store">,
      targetType: "service_case",
      targetId: "case_1",
      allocationType: "deposit",
      method: "mobile_money",
      amount: 5000,
    };

    await recordPaymentAllocationWithCtx(ctx as never, {
      ...base,
      businessEventKey: "service:case_1:payment_1",
    });
    await recordPaymentAllocationWithCtx(ctx as never, {
      ...base,
      businessEventKey: "service:case_1:payment_2",
    });

    expect(rows).toHaveLength(2);
  });

  it("replays one keyed allocation and rejects conflicting key reuse", async () => {
    const existing = {
      _id: "allocation_1",
      storeId: "store_1",
      businessEventKey: "pos:transaction_1:sale:0",
      targetType: "pos_transaction",
      targetId: "transaction_1",
      allocationType: "retail_sale",
      direction: "in",
      method: "cash",
      amount: 5000,
      collectedInStore: true,
      status: "recorded",
    };
    const { ctx, insert } = paymentContext([existing]);
    const args = {
      storeId: "store_1" as Id<"store">,
      businessEventKey: "pos:transaction_1:sale:0",
      targetType: "pos_transaction",
      targetId: "transaction_1",
      allocationType: "retail_sale",
      direction: "in" as const,
      method: "cash",
      amount: 5000,
      collectedInStore: true,
    };

    await expect(
      recordPaymentAllocationWithCtx(ctx as never, args),
    ).resolves.toEqual(existing);
    expect(insert).not.toHaveBeenCalled();

    await expect(
      recordPaymentAllocationWithCtx(ctx as never, { ...args, amount: 6000 }),
    ).rejects.toThrow("Payment business event conflicts with an existing allocation.");
    expect(insert).not.toHaveBeenCalled();
  });

  it("enriches a legacy keyed allocation with selected refund SKU evidence", async () => {
    const existing = {
      _id: "allocation_1",
      allocationType: "retail_refund",
      amount: 5000,
      businessEventKey: "storefront:order_1:refund:refund_1",
      collectedInStore: false,
      direction: "out",
      method: "card",
      status: "recorded",
      storeId: "store_1",
      targetId: "order_1",
      targetType: "online_order",
    };
    const { ctx, insert, patch, rows } = paymentContext([existing]);

    await expect(
      recordPaymentAllocationWithCtx(ctx as never, {
        allocationType: "retail_refund",
        amount: 5000,
        businessEventKey: "storefront:order_1:refund:refund_1",
        direction: "out",
        evidenceProductSkuIds: [
          "sku_2" as Id<"productSku">,
          "sku_1" as Id<"productSku">,
          "sku_2" as Id<"productSku">,
        ],
        method: "card",
        storeId: "store_1" as Id<"store">,
        targetId: "order_1",
        targetType: "online_order",
      }),
    ).resolves.toMatchObject({
      _id: "allocation_1",
      evidenceProductSkuIds: ["sku_1", "sku_2"],
    });

    expect(insert).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith("paymentAllocation", "allocation_1", {
      evidenceProductSkuIds: ["sku_1", "sku_2"],
    });
    expect(rows[0]).toMatchObject({
      evidenceProductSkuIds: ["sku_1", "sku_2"],
    });
  });

  it("rejects keyed replay that changes an established SKU evidence scope", async () => {
    const existing = {
      _id: "allocation_1",
      allocationType: "retail_refund",
      amount: 5000,
      businessEventKey: "storefront:order_1:refund:refund_1",
      collectedInStore: false,
      direction: "out",
      evidenceProductSkuIds: ["sku_1"],
      method: "card",
      status: "recorded",
      storeId: "store_1",
      targetId: "order_1",
      targetType: "online_order",
    };
    const { ctx, insert, patch } = paymentContext([existing]);

    await expect(
      recordPaymentAllocationWithCtx(ctx as never, {
        allocationType: "retail_refund",
        amount: 5000,
        businessEventKey: "storefront:order_1:refund:refund_1",
        direction: "out",
        evidenceProductSkuIds: ["sku_2" as Id<"productSku">],
        method: "card",
        storeId: "store_1" as Id<"store">,
        targetId: "order_1",
        targetType: "online_order",
      }),
    ).rejects.toThrow(
      "Payment business event conflicts with an existing allocation.",
    );

    expect(insert).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("records a payment_refund report fact for an outgoing refund allocation", async () => {
    const { ctx } = paymentContext();
    await recordPaymentAllocationWithCtx(ctx as never, {
      amount: 2_500,
      businessEventKey: "pos:transaction_1:payment:0",
      direction: "out",
      method: "cash",
      storeId: "store_1" as Id<"store">,
      targetId: "transaction_1",
      targetType: "pos_transaction",
      allocationType: "retail_refund",
    });

    expect(reportingMocks.recordFacts).toHaveBeenLastCalledWith(
      expect.anything(),
      "store_1",
      [
        expect.objectContaining({
          sourceDomain: "payments",
          sourceId: "allocation_1",
          lineId: "",
          factKind: "payment_refund",
          currency: "GHS",
          grossAmountMinor: 2_500,
          netAmountMinor: 2_500,
          taxAmountMinor: 0,
          discountAmountMinor: 0,
          quantity: 0,
          paymentAllocationCoverage: "known",
          paymentAllocationMinor: -2_500,
        }),
      ],
    );
  });

  it("records a payment report fact for an incoming collection allocation", async () => {
    const { ctx } = paymentContext();
    await recordPaymentAllocationWithCtx(ctx as never, {
      amount: 5_000,
      businessEventKey: "pos:transaction_2:payment:0",
      direction: "in",
      method: "cash",
      storeId: "store_1" as Id<"store">,
      targetId: "transaction_2",
      targetType: "pos_transaction",
      allocationType: "retail_sale",
    });

    expect(reportingMocks.recordFacts).toHaveBeenLastCalledWith(
      expect.anything(),
      "store_1",
      [
        expect.objectContaining({
          sourceDomain: "payments",
          sourceId: "allocation_1",
          lineId: "",
          factKind: "payment",
          currency: "GHS",
          netAmountMinor: 5_000,
          paymentAllocationCoverage: "known",
          paymentAllocationMinor: 5_000,
        }),
      ],
    );
  });

  it("carries normalized method, gross mix value, and POS participation identity", async () => {
    for (const [method, normalized] of [
      ["cash", "cash"],
      ["Card", "card"],
      [" Mobile Money ", "mobile_money"],
      ["momo", "mobile_money"],
      ["mobile-money", "mobile_money"],
    ] as const) {
      const { ctx } = paymentContext();
      await recordPaymentAllocationWithCtx(ctx as never, {
        amount: 5_000,
        allocationType: "retail_sale",
        direction: "in",
        method,
        posTransactionId: "transaction_9" as Id<"posTransaction">,
        storeId: "store_1" as Id<"store">,
        targetId: "transaction_9",
        targetType: "pos_transaction",
      });

      expect(reportingMocks.recordFacts).toHaveBeenLastCalledWith(
        expect.anything(),
        "store_1",
        [
          expect.objectContaining({
            factKind: "payment",
            paymentMethod: normalized,
            paymentMixMinor: 5_000,
            // Daily Close counts the TRANSACTION, not the allocation.
            paymentParticipationId: "transaction_9",
          }),
        ],
      );
    }
  });

  it("falls back to allocation identity when no POS transaction backs the receipt", async () => {
    const { ctx } = paymentContext();
    await recordPaymentAllocationWithCtx(ctx as never, {
      amount: 5_000,
      allocationType: "service_deposit",
      direction: "in",
      method: "cash",
      storeId: "store_1" as Id<"store">,
      targetId: "work_item_1",
      targetType: "operational_work_item",
    });

    expect(reportingMocks.recordFacts).toHaveBeenLastCalledWith(
      expect.anything(),
      "store_1",
      [
        expect.objectContaining({
          paymentMethod: "cash",
          paymentParticipationId: "allocation_1",
        }),
      ],
    );
  });

  it("leaves Payments totals intact but mix evidence absent for an unsupported method", async () => {
    for (const method of ["", "   ", "cheque", "bank transfer"]) {
      const { ctx } = paymentContext();
      await recordPaymentAllocationWithCtx(ctx as never, {
        amount: 5_000,
        allocationType: "retail_sale",
        direction: "in",
        method,
        posTransactionId: "transaction_9" as Id<"posTransaction">,
        storeId: "store_1" as Id<"store">,
        targetId: "transaction_9",
        targetType: "pos_transaction",
      });

      const [fact] = reportingMocks.recordFacts.mock.calls.at(-1)?.[2] as Array<
        Record<string, unknown>
      >;
      expect(fact.netAmountMinor).toBe(5_000);
      expect(fact.paymentAllocationMinor).toBe(5_000);
      expect(fact.paymentMethod).toBeUndefined();
      expect(fact.paymentParticipationId).toBeUndefined();
      expect(fact.paymentMixMinor).toBeUndefined();
    }
  });

  it("adds no gross mix contribution from a refund or any reversal shape", async () => {
    const recordedAt = 1_700_000_000_000;
    const { ctx: refundCtx } = paymentContext();
    await recordPaymentAllocationWithCtx(refundCtx as never, {
      amount: 2_500,
      allocationType: "retail_refund",
      direction: "out",
      method: "cash",
      posTransactionId: "transaction_9" as Id<"posTransaction">,
      storeId: "store_1" as Id<"store">,
      targetId: "transaction_9",
      targetType: "pos_transaction",
    });

    const reversalShapes = [
      // timed void, undated legacy void, voided outbound refund
      { direction: "in" as const, voidedAt: recordedAt + 60_000 },
      { direction: "in" as const, voidedAt: undefined },
      { direction: "out" as const, voidedAt: recordedAt + 60_000 },
    ];
    for (const shape of reversalShapes) {
      const { ctx } = paymentContext([
        {
          _id: "allocation_1",
          allocationType: "retail_sale",
          amount: 2_500,
          direction: shape.direction,
          method: "cash",
          posTransactionId: "transaction_9",
          recordedAt,
          status: "voided",
          storeId: "store_1",
          targetId: "transaction_9",
          targetType: "pos_transaction",
          ...(shape.voidedAt === undefined ? {} : { voidedAt: shape.voidedAt }),
        },
      ]);
      await voidPaymentAllocationWithCtx(
        ctx as never,
        "allocation_1" as Id<"paymentAllocation">,
      );
    }

    for (const call of reportingMocks.recordFacts.mock.calls) {
      for (const fact of call[2] as Array<Record<string, unknown>>) {
        expect(fact.paymentMixMinor).toBeUndefined();
        expect(fact.paymentMethod).toBeUndefined();
        expect(fact.paymentParticipationId).toBeUndefined();
      }
    }
  });
});

describe("payment allocation reporting — end to end through real ingestion", () => {
  /** 23:30 UTC is already the NEXT store-local day in Tokyo. */
  const NOW = Date.parse("2026-03-10T23:30:00Z");
  const STORE_LOCAL_DATE = "2026-03-11";

  async function seedStore(ctx: MutationCtx) {
    const userId = await ctx.db.insert("athenaUser", {
      email: "admin@example.test",
    });
    const organizationId = await ctx.db.insert("organization", {
      createdByUserId: userId,
      name: "Org",
      slug: "org",
    });
    return await ctx.db.insert("store", {
      config: { timezone: "Asia/Tokyo" },
      createdByUserId: userId,
      currency: "GHS",
      name: "Store",
      organizationId,
      slug: "store",
    });
  }

  async function withRealIngestion<T>(run: () => Promise<T>): Promise<T> {
    const actual =
      await vi.importActual<typeof import("../reports/ingest")>(
        "../reports/ingest",
      );
    reportingMocks.recordFacts.mockImplementation(
      actual.recordFacts as unknown as (..._args: unknown[]) => Promise<never>,
    );
    try {
      return await run();
    } finally {
      reportingMocks.recordFacts.mockImplementation(async () => undefined);
    }
  }

  it("emits canonical payment evidence once and folds to the same posture", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    await withRealIngestion(() =>
      t.run(async (ctx) => {
        const storeId = await seedStore(ctx);
        const args = {
          allocationType: "retail_sale",
          amount: 5_000,
          businessEventKey: "pos:transaction_1:payment:0",
          direction: "in" as const,
          method: "cash",
          storeId,
          targetId: "transaction_1",
          targetType: "pos_transaction",
        };

        const allocation = await recordPaymentAllocationWithCtx(ctx, args);
        // A replayed domain write must not double-count the payment.
        await recordPaymentAllocationWithCtx(ctx, args);

        // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
        const facts = await ctx.db.query("reportFact").collect();
        expect(facts).toHaveLength(1);
        expect(facts[0]).toMatchObject({
          currency: "GHS",
          factKind: "payment",
          lineId: "",
          netAmountMinor: 5_000,
          // Dated by the store's own calendar, not UTC.
          operatingDate: STORE_LOCAL_DATE,
          paymentAllocationCoverage: "known",
          paymentAllocationMinor: 5_000,
          sourceDomain: "payments",
          sourceId: String(allocation._id),
        });

        const day = await ctx.db
          .query("reportDay")
          .withIndex("by_storeId_operatingDate", (q) =>
            q.eq("storeId", storeId).eq("operatingDate", STORE_LOCAL_DATE),
          )
          .unique();
        expect(day?.paymentPosture).toMatchObject({
          allocatedMinor: 5_000,
          allocationCoverage: "complete",
          allocationOmittedMinor: 0,
          collectedMinor: 5_000,
          unsettledMinor: 0,
        });

        // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
        const dirty = await ctx.db
          .query("reportDirtyDay")
          .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", storeId))
          .collect();
        expect(
          dirty.map((row) => ({
            operatingDate: row.operatingDate,
            reason: row.reason,
          })),
        ).toEqual([{ operatingDate: STORE_LOCAL_DATE, reason: "day_open" }]);

        // The fold is the authority: refolding the same facts reproduces the
        // preview's posture exactly, so the close replaces without moving it.
        const { day: folded } = foldDay(
          "GHS",
          facts.map((row) => ({
            ...row,
            factId: String(row._id),
            quarantined: row.quarantine !== undefined,
          })),
        );
        expect(folded.paymentPosture).toEqual(day?.paymentPosture);
        expect(folded.paymentsCollectedMinor).toBe(5_000);
      }),
    );
  });
});

import { describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";

const reportingMocks = vi.hoisted(() => ({
  recordFacts: vi.fn(async (..._args: unknown[]) => undefined),
}));

vi.mock("../reports/ingest", () => ({
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

  it("preserves an outbound-refund void while withholding unsupported reporting", async () => {
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
    expect(reportingMocks.recordFacts).not.toHaveBeenCalled();
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
            method: "cash",
            amount: 1500,
            status: "recorded",
          },
          {
            _id: "allocation_2" as Id<"paymentAllocation">,
            direction: "in",
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
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyInventoryEffectWithCtx: vi.fn(),
  resolveReportingOperatingPeriodWithCtx: vi.fn(),
}));

vi.mock("./effects", () => ({
  applyInventoryEffectWithCtx: mocks.applyInventoryEffectWithCtx,
}));

vi.mock("../operatingPeriods", () => ({
  resolveReportingOperatingPeriodWithCtx:
    mocks.resolveReportingOperatingPeriodWithCtx,
}));

import {
  applyCommerceInventoryEffectWithCtx,
  outboundBasisFromEffect,
  reportingLineCostFromEffect,
} from "./commerceEffects";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolveReportingOperatingPeriodWithCtx.mockResolvedValue({
    kind: "resolved",
    operatingDate: "2026-07-10",
    scheduleVersionId: "schedule-1",
  });
  mocks.applyInventoryEffectWithCtx.mockResolvedValue({
    disposition: "inserted",
  });
});

function context() {
  return {
    db: {
      get: vi.fn(async () => ({
        _id: "sku-1",
        inventoryCount: 3,
        productId: "product-1",
        quantityAvailable: 2,
        storeId: "store-1",
      })),
    },
  };
}

const base = {
  activityType: "stock_sale",
  businessEventKey: "pos:txn-1:line:item-1:sale",
  contentFingerprint: "fingerprint-1",
  effectType: "sale" as const,
  movementType: "sale",
  occurrenceAt: 100,
  organizationId: "org-1" as never,
  productId: "product-1" as never,
  productSkuId: "sku-1" as never,
  sourceDomain: "pos" as const,
  sourceId: "txn-1",
  sourceLineId: "item-1",
  sourceType: "posTransaction",
  storeId: "store-1" as never,
};

describe("commerce inventory effects", () => {
  it("routes deficit-safe outbound balance and source evidence through the kernel", async () => {
    const ctx = context();

    await applyCommerceInventoryEffectWithCtx(ctx as never, {
      ...base,
      customerProfileId: "customer-1" as never,
      disposition: "merchandise_sale",
      kind: "outbound",
      posTransactionId: "txn-1" as never,
      quantity: 5,
      registerSessionId: "register-1" as never,
      sellableQuantityDelta: -2,
    });

    expect(mocks.applyInventoryEffectWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        businessEventKey: base.businessEventKey,
        compatibilityBalance: {
          onHandQuantity: 0,
          sellableQuantity: 0,
        },
        customerProfileId: "customer-1",
        physicalQuantityDelta: -5,
        posTransactionId: "txn-1",
        registerSessionId: "register-1",
        valuation: {
          disposition: "merchandise_sale",
          kind: "outbound",
          quantity: 5,
        },
      }),
    );
  });

  it("keeps occurrence time separate from the later reporting acceptance time", async () => {
    const ctx = context();

    await applyCommerceInventoryEffectWithCtx(ctx as never, {
      ...base,
      disposition: "merchandise_sale",
      kind: "outbound",
      quantity: 1,
      recordedAt: 250,
      sellableQuantityDelta: -1,
    });

    expect(mocks.applyInventoryEffectWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ occurrenceAt: 100, recordedAt: 250 }),
    );
  });

  it("keeps reservation effects availability-only and replay-stable", async () => {
    const ctx = context();
    mocks.applyInventoryEffectWithCtx
      .mockResolvedValueOnce({ disposition: "inserted" })
      .mockResolvedValueOnce({ disposition: "existing" });
    const args = {
      ...base,
      activityType: "reservation_acquired",
      businessEventKey: "checkout:session-1:line:item-1:acquired",
      effectType: "adjustment" as const,
      kind: "availability_only" as const,
      movementType: "reservation_acquired",
      sellableQuantityDelta: -1,
      sourceDomain: "storefront" as const,
    };

    await applyCommerceInventoryEffectWithCtx(ctx as never, args);
    await applyCommerceInventoryEffectWithCtx(ctx as never, args);

    expect(mocks.applyInventoryEffectWithCtx).toHaveBeenCalledTimes(2);
    expect(mocks.applyInventoryEffectWithCtx).toHaveBeenLastCalledWith(
      ctx,
      expect.objectContaining({
        businessEventKey: args.businessEventKey,
        compatibilityBalance: {
          onHandQuantity: 3,
          sellableQuantity: 1,
        },
        physicalQuantityDelta: 0,
        valuation: { kind: "availability_only" },
      }),
    );
  });

  it("restores stock and original COGS only for sellable returns", async () => {
    const ctx = context();
    const originalBasis = {
      allocatedKnownCost: 400,
      basisVersion: 3,
      costedQuantity: 2,
      currency: "GHS",
      knownCostPoolBefore: 400,
      roundedWeightedAverageUnitCost: 200,
      uncostedQuantity: 0,
      unresolvedDeficitQuantity: 0,
    };

    await applyCommerceInventoryEffectWithCtx(ctx as never, {
      ...base,
      disposition: "sellable",
      effectType: "return",
      kind: "return",
      originalBasis,
      quantity: 1,
      sellableQuantityDelta: 1,
    });

    expect(mocks.applyInventoryEffectWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        compatibilityBalance: {
          onHandQuantity: 4,
          sellableQuantity: 3,
        },
        physicalQuantityDelta: 1,
        sellableQuantityDelta: 1,
        valuation: {
          disposition: "sellable",
          financialContribution: "reverse_original_lane",
          kind: "return",
          originalBasis,
          originalCostLane: "merchandise_cogs",
          quantity: 1,
        },
      }),
    );
  });

  it.each([
    "non_restocked",
    "damaged",
    "missing",
    "financial_only",
  ] as const)(
    "records %s returns without restoring stock or reversing COGS",
    async (disposition) => {
      const ctx = context();

      await applyCommerceInventoryEffectWithCtx(ctx as never, {
        ...base,
        disposition,
        effectType: "return",
        kind: "return",
        quantity: 1,
        sellableQuantityDelta: 0,
      });

      expect(mocks.applyInventoryEffectWithCtx).toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({
          compatibilityBalance: {
            onHandQuantity: 3,
            sellableQuantity: 2,
          },
          physicalQuantityDelta: 0,
          sellableQuantityDelta: 0,
          valuation: expect.objectContaining({
            disposition,
            financialContribution: "none",
            kind: "return",
            quantity: 1,
          }),
        }),
      );
    },
  );

  it("recovers an immutable known outbound basis only from reconciling evidence", () => {
    expect(
      outboundBasisFromEffect(
        {
          costedQuantityDelta: -2,
          currencyCode: "GHS",
          outboundBasisMinor: 300,
          uncostedQuantityDelta: -1,
          unresolvedDeficitDelta: 0,
        },
        3,
      ),
    ).toMatchObject({
      allocatedKnownCost: 300,
      costedQuantity: 2,
      currency: "GHS",
      uncostedQuantity: 1,
    });
    expect(
      outboundBasisFromEffect(
        {
          costedQuantityDelta: -2,
          currencyCode: undefined,
          outboundBasisMinor: 300,
          uncostedQuantityDelta: 0,
          unresolvedDeficitDelta: 0,
        },
        2,
      ),
    ).toBeNull();
  });

  it("publishes full and partial known COGS from immutable outbound basis", () => {
    expect(
      reportingLineCostFromEffect(
        {
          costedQuantityDelta: -2,
          currencyCode: "GHS",
          outboundBasisMinor: 800,
          uncostedQuantityDelta: 0,
          unresolvedDeficitDelta: 0,
        },
        2,
      ),
    ).toEqual({
      cogsKnownMinor: 800,
      costStatus: "known",
      valuationCurrencyCode: "GHS",
      valuationCurrencyMinorUnitScale: 2,
    });
    expect(
      reportingLineCostFromEffect(
        {
          costedQuantityDelta: -1,
          currencyCode: "GHS",
          outboundBasisMinor: 400,
          uncostedQuantityDelta: -4,
          unresolvedDeficitDelta: 0,
        },
        5,
      ),
    ).toEqual({
      cogsKnownMinor: 400,
      cogsKnownQuantity: 1,
      cogsUncoveredQuantity: 4,
      costStatus: "partial",
      valuationCurrencyCode: "GHS",
      valuationCurrencyMinorUnitScale: 2,
    });
  });
});

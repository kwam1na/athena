import { describe, expect, it } from "vitest";
import {
  applyInboundValuation,
  applyOutboundValuation,
  applyReturnValuation,
  applyValuationCorrection,
  createEmptyValuationPosition,
  deriveValuationBasisStatus,
  getOutboundCostTreatment,
  getReturnCostTreatment,
  getWeightedAverageUnitCost,
  knownExtendedCostBasis,
  knownUnitCostBasis,
  uncostedBasis,
} from "./valuation";
import type {
  InventoryValuationPosition,
  OutboundValuationBasisSnapshot,
  UnresolvedDeficitLot,
} from "./types";

function knownPosition(args: {
  quantity: number;
  pool: number;
  basisVersion?: number;
}): InventoryValuationPosition {
  return {
    basisVersion: args.basisVersion ?? 1,
    costedQuantity: args.quantity,
    currency: "GHS",
    knownCostPool: args.pool,
    uncostedQuantity: 0,
    unresolvedDeficitQuantity: 0,
  };
}

function deficitLot(
  remainingQuantity: number,
  overrides: Partial<UnresolvedDeficitLot> = {},
): UnresolvedDeficitLot {
  return {
    costLane: "merchandise_cogs",
    occurredAt: 100,
    outboundEffectId: "sale-line-1",
    remainingQuantity,
    ...overrides,
  };
}

function outboundBasis(
  overrides: Partial<OutboundValuationBasisSnapshot> = {},
): OutboundValuationBasisSnapshot {
  return {
    allocatedKnownCost: 5_000,
    basisVersion: 3,
    costedQuantity: 2,
    currency: "GHS",
    knownCostPoolBefore: 10_000,
    roundedWeightedAverageUnitCost: 2_500,
    uncostedQuantity: 0,
    unresolvedDeficitQuantity: 0,
    ...overrides,
  };
}

describe("inventory valuation", () => {
  it("computes moving weighted-average cost from the integer cost pool", () => {
    const firstReceipt = applyInboundValuation(createEmptyValuationPosition(), {
      costBasis: knownUnitCostBasis({
        currency: "GHS",
        quantity: 10,
        unitCost: 2_000,
      }),
      deficitLots: [],
      inboundEffectId: "receipt-1",
      quantity: 10,
    });
    const secondReceipt = applyInboundValuation(firstReceipt.position, {
      costBasis: knownUnitCostBasis({
        currency: "GHS",
        quantity: 10,
        unitCost: 3_000,
      }),
      deficitLots: [],
      inboundEffectId: "receipt-2",
      quantity: 10,
    });

    expect(secondReceipt.position).toEqual({
      basisVersion: 2,
      costedQuantity: 20,
      currency: "GHS",
      knownCostPool: 50_000,
      uncostedQuantity: 0,
      unresolvedDeficitQuantity: 0,
    });
    expect(getWeightedAverageUnitCost(secondReceipt.position)).toBe(2_500);
  });

  it("keeps legitimate zero cost distinct from unknown cost", () => {
    const zeroCost = applyInboundValuation(createEmptyValuationPosition(), {
      costBasis: knownUnitCostBasis({
        currency: "GHS",
        quantity: 2,
        unitCost: 0,
      }),
      deficitLots: [],
      inboundEffectId: "zero-cost-receipt",
      quantity: 2,
    });
    const mixed = applyInboundValuation(zeroCost.position, {
      costBasis: uncostedBasis(),
      deficitLots: [],
      inboundEffectId: "unknown-cost-receipt",
      quantity: 1,
    });

    expect(zeroCost.position).toMatchObject({
      costedQuantity: 2,
      currency: "GHS",
      knownCostPool: 0,
      uncostedQuantity: 0,
    });
    expect(deriveValuationBasisStatus(zeroCost.position)).toBe("costed");
    expect(mixed.position).toMatchObject({
      costedQuantity: 2,
      knownCostPool: 0,
      uncostedQuantity: 1,
    });
    expect(deriveValuationBasisStatus(mixed.position)).toBe("mixed");
  });

  it("consumes uncosted coverage before assigning known outbound cost", () => {
    const result = applyOutboundValuation(
      {
        ...knownPosition({ quantity: 6, pool: 6_000 }),
        uncostedQuantity: 4,
      },
      {
        disposition: "merchandise_sale",
        occurredAt: 200,
        outboundEffectId: "sale-line-2",
        quantity: 5,
      },
    );

    expect(result.consumed).toEqual({
      costedQuantity: 1,
      deficitQuantity: 0,
      knownCost: 1_000,
      uncostedQuantity: 4,
    });
    expect(result.position).toMatchObject({
      costedQuantity: 5,
      knownCostPool: 5_000,
      uncostedQuantity: 0,
    });
  });

  it("allocates rounding deterministically and drains the final residue exactly", () => {
    const first = applyOutboundValuation(knownPosition({ quantity: 3, pool: 100 }), {
      disposition: "merchandise_sale",
      occurredAt: 1,
      outboundEffectId: "sale-round-1",
      quantity: 1,
    });
    const second = applyOutboundValuation(first.position, {
      disposition: "merchandise_sale",
      occurredAt: 2,
      outboundEffectId: "sale-round-2",
      quantity: 1,
    });
    const third = applyOutboundValuation(second.position, {
      disposition: "merchandise_sale",
      occurredAt: 3,
      outboundEffectId: "sale-round-3",
      quantity: 1,
    });

    expect([
      first.consumed.knownCost,
      second.consumed.knownCost,
      third.consumed.knownCost,
    ]).toEqual([33, 34, 33]);
    expect(third.position).toEqual(createEmptyValuationPosition(4));
  });

  it("preserves quantity and pool invariants across mixed outbound boundaries", () => {
    for (let costedQuantity = 1; costedQuantity <= 6; costedQuantity += 1) {
      for (let uncostedQuantity = 0; uncostedQuantity <= 4; uncostedQuantity += 1) {
        for (const knownCostPool of [0, 1, costedQuantity * 137 + 1]) {
          const availableQuantity = costedQuantity + uncostedQuantity;
          for (let quantity = 1; quantity <= availableQuantity + 2; quantity += 1) {
            const result = applyOutboundValuation(
              {
                ...knownPosition({ quantity: costedQuantity, pool: knownCostPool }),
                uncostedQuantity,
              },
              {
                disposition: "merchandise_sale",
                occurredAt: quantity,
                outboundEffectId: `grid-${costedQuantity}-${uncostedQuantity}-${knownCostPool}-${quantity}`,
                quantity,
              },
            );

            expect(
              result.consumed.costedQuantity +
                result.consumed.uncostedQuantity +
                result.consumed.deficitQuantity,
            ).toBe(quantity);
            expect(result.position.knownCostPool).toBeGreaterThanOrEqual(0);
            expect(result.consumed.knownCost).toBeLessThanOrEqual(knownCostPool);
            expect(result.position.knownCostPool + result.consumed.knownCost).toBe(
              knownCostPool,
            );
            if (result.position.costedQuantity === 0) {
              expect(result.position.knownCostPool).toBe(0);
              expect(result.position.currency).toBeNull();
            }
            if (result.position.unresolvedDeficitQuantity > 0) {
              expect(
                result.position.costedQuantity + result.position.uncostedQuantity,
              ).toBe(0);
            }
          }
        }
      }
    }
  });

  it("preserves outbound quantity beyond stock as an explicit uncosted deficit", () => {
    const result = applyOutboundValuation(knownPosition({ quantity: 1, pool: 100 }), {
      disposition: "merchandise_sale",
      occurredAt: 200,
      outboundEffectId: "oversold-line",
      quantity: 3,
    });

    expect(result.consumed).toEqual({
      costedQuantity: 1,
      deficitQuantity: 2,
      knownCost: 100,
      uncostedQuantity: 0,
    });
    expect(result.position).toEqual({
      basisVersion: 2,
      costedQuantity: 0,
      currency: null,
      knownCostPool: 0,
      uncostedQuantity: 0,
      unresolvedDeficitQuantity: 2,
    });
    expect(result.createdDeficitLot).toEqual({
      costLane: "merchandise_cogs",
      occurredAt: 200,
      outboundEffectId: "oversold-line",
      remainingQuantity: 2,
    });
  });

  it("uses known inbound cost to resolve deficit through linked adjustments before valuing residual stock", () => {
    const result = applyInboundValuation(
      {
        basisVersion: 4,
        costedQuantity: 0,
        currency: null,
        knownCostPool: 0,
        uncostedQuantity: 0,
        unresolvedDeficitQuantity: 2,
      },
      {
        costBasis: knownUnitCostBasis({
          currency: "GHS",
          quantity: 3,
          unitCost: 100,
        }),
        deficitLots: [deficitLot(2)],
        inboundEffectId: "receipt-after-oversell",
        quantity: 3,
      },
    );

    expect(result.position).toEqual({
      basisVersion: 5,
      costedQuantity: 1,
      currency: "GHS",
      knownCostPool: 100,
      uncostedQuantity: 0,
      unresolvedDeficitQuantity: 0,
    });
    expect(result.deficitResolutions).toEqual([
      {
        costStatus: "known",
        inboundEffectId: "receipt-after-oversell",
        knownCost: 200,
        outboundEffectId: "sale-line-1",
        quantity: 2,
      },
    ]);
    expect(result.valuationAdjustments).toEqual([
      {
        costLane: "historical_merchandise_cogs",
        currency: "GHS",
        inboundEffectId: "receipt-after-oversell",
        knownCost: 200,
        outboundEffectId: "sale-line-1",
        quantity: 2,
      },
    ]);
    expect(result.costAddedToPool).toBe(100);
    expect(
      result.costAddedToPool +
        result.valuationAdjustments.reduce(
          (sum, adjustment) => sum + adjustment.knownCost,
          0,
        ),
    ).toBe(300);
  });

  it("resolves deficit with unknown inbound quantity without fabricating cost", () => {
    const result = applyInboundValuation(
      {
        basisVersion: 2,
        costedQuantity: 0,
        currency: null,
        knownCostPool: 0,
        uncostedQuantity: 0,
        unresolvedDeficitQuantity: 2,
      },
      {
        costBasis: uncostedBasis(),
        deficitLots: [deficitLot(2)],
        inboundEffectId: "uncosted-receipt",
        quantity: 3,
      },
    );

    expect(result.position).toEqual({
      basisVersion: 3,
      costedQuantity: 0,
      currency: null,
      knownCostPool: 0,
      uncostedQuantity: 1,
      unresolvedDeficitQuantity: 0,
    });
    expect(result.deficitResolutions[0]).toMatchObject({
      costStatus: "unknown",
      knownCost: null,
      quantity: 2,
    });
    expect(result.valuationAdjustments).toEqual([]);
  });

  it("resolves deficit lots in stable occurrence and effect-id order", () => {
    const result = applyInboundValuation(
      {
        basisVersion: 3,
        costedQuantity: 0,
        currency: null,
        knownCostPool: 0,
        uncostedQuantity: 0,
        unresolvedDeficitQuantity: 3,
      },
      {
        costBasis: knownUnitCostBasis({
          currency: "GHS",
          quantity: 2,
          unitCost: 50,
        }),
        deficitLots: [
          deficitLot(1, { occurredAt: 200, outboundEffectId: "later" }),
          deficitLot(1, { occurredAt: 100, outboundEffectId: "b" }),
          deficitLot(1, { occurredAt: 100, outboundEffectId: "a" }),
        ],
        inboundEffectId: "receipt-stable-order",
        quantity: 2,
      },
    );

    expect(result.deficitResolutions.map((entry) => entry.outboundEffectId)).toEqual([
      "a",
      "b",
    ]);
    expect(result.remainingDeficitLots).toEqual([
      deficitLot(1, { occurredAt: 200, outboundEffectId: "later" }),
    ]);
  });

  it("rejects a known inbound currency that conflicts with the current pool", () => {
    expect(() =>
      applyInboundValuation(knownPosition({ quantity: 2, pool: 200 }), {
        costBasis: knownUnitCostBasis({
          currency: "USD",
          quantity: 1,
          unitCost: 100,
        }),
        deficitLots: [],
        inboundEffectId: "usd-receipt",
        quantity: 1,
      }),
    ).toThrow(/currency/i);
  });

  it("keeps outbound cost snapshots immutable after later receipts", () => {
    const outbound = applyOutboundValuation(knownPosition({ quantity: 2, pool: 200 }), {
      disposition: "merchandise_sale",
      occurredAt: 100,
      outboundEffectId: "sale-immutable",
      quantity: 1,
    });
    const snapshot = structuredClone(outbound.basis);

    applyInboundValuation(outbound.position, {
      costBasis: knownUnitCostBasis({
        currency: "GHS",
        quantity: 1,
        unitCost: 500,
      }),
      deficitLots: [],
      inboundEffectId: "later-receipt",
      quantity: 1,
    });

    expect(outbound.basis).toEqual(snapshot);
    expect(outbound.basis.basisVersion).toBe(1);
  });

  it("restores a sellable return at the original known cost and reverses only restored COGS", () => {
    const result = applyReturnValuation(createEmptyValuationPosition(), {
      deficitLots: [],
      disposition: "sellable",
      occurredAt: 500,
      originalBasis: outboundBasis(),
      quantity: 2,
      returnEffectId: "return-1",
    });

    expect(result.position).toEqual({
      basisVersion: 1,
      costedQuantity: 2,
      currency: "GHS",
      knownCostPool: 5_000,
      uncostedQuantity: 0,
      unresolvedDeficitQuantity: 0,
    });
    expect(result.cogsReversalKnownCost).toBe(5_000);
    expect(result.knownCostAppliedToDeficit).toBe(0);
  });

  it("makes a sellable return resolve deficit before reversing COGS into stock", () => {
    const result = applyReturnValuation(
      {
        basisVersion: 4,
        costedQuantity: 0,
        currency: null,
        knownCostPool: 0,
        uncostedQuantity: 0,
        unresolvedDeficitQuantity: 1,
      },
      {
        deficitLots: [deficitLot(1, { outboundEffectId: "other-oversell" })],
        disposition: "sellable",
        occurredAt: 500,
        originalBasis: outboundBasis(),
        quantity: 2,
        returnEffectId: "return-2",
      },
    );

    expect(result.position).toMatchObject({
      basisVersion: 5,
      costedQuantity: 1,
      knownCostPool: 2_500,
      unresolvedDeficitQuantity: 0,
    });
    expect(result.knownCostAppliedToDeficit).toBe(2_500);
    expect(result.cogsReversalKnownCost).toBe(5_000);
    expect(result.valuationAdjustments[0]).toMatchObject({
      inboundEffectId: "return-2",
      knownCost: 2_500,
      outboundEffectId: "other-oversell",
    });
  });

  it("restores mixed original coverage conservatively with unknown quantity first", () => {
    const result = applyReturnValuation(createEmptyValuationPosition(), {
      deficitLots: [],
      disposition: "sellable",
      occurredAt: 500,
      originalBasis: outboundBasis({
        allocatedKnownCost: 1_000,
        costedQuantity: 1,
        knownCostPoolBefore: 6_000,
        roundedWeightedAverageUnitCost: 1_000,
        uncostedQuantity: 4,
      }),
      quantity: 5,
      returnEffectId: "return-mixed",
    });

    expect(result.position).toMatchObject({
      costedQuantity: 1,
      knownCostPool: 1_000,
      uncostedQuantity: 4,
    });
    expect(result.restored).toEqual({
      costedQuantity: 1,
      uncostedQuantity: 4,
    });
  });

  it.each(["financial_only", "damaged", "missing", "non_restocked"] as const)(
    "does not restore inventory or reverse COGS for a %s return",
    (disposition) => {
      const position = knownPosition({ quantity: 2, pool: 200 });
      const result = applyReturnValuation(position, {
        deficitLots: [],
        disposition,
        occurredAt: 500,
        originalBasis: outboundBasis(),
        quantity: 1,
        returnEffectId: `return-${disposition}`,
      });

      expect(result.position).toEqual(position);
      expect(result.cogsReversalKnownCost).toBe(0);
      expect(result.restored).toEqual({ costedQuantity: 0, uncostedQuantity: 0 });
      expect(result.treatment.restoresSellableInventory).toBe(false);
      expect(result.treatment.reversesCogs).toBe(false);
    },
  );

  it("classifies merchandise, exchange, consumption, and loss cost without creating revenue", () => {
    expect(getOutboundCostTreatment("merchandise_sale")).toEqual({
      costLane: "merchandise_cogs",
      recognizesRevenue: false,
    });
    expect(getOutboundCostTreatment("exchange_replacement")).toEqual({
      costLane: "exchange_merchandise_cogs",
      recognizesRevenue: false,
    });
    expect(getOutboundCostTreatment("service_consumption").costLane).toBe(
      "inventory_consumed",
    );
    expect(getOutboundCostTreatment("inventory_expense").costLane).toBe(
      "inventory_consumed",
    );
    expect(getOutboundCostTreatment("damage").costLane).toBe("inventory_loss");
    expect(getOutboundCostTreatment("writeoff").costLane).toBe("inventory_loss");
  });

  it("exposes return treatments without treating financial or damaged returns as restocks", () => {
    expect(getReturnCostTreatment("sellable")).toMatchObject({
      outcome: "sellable_restock",
      restoresSellableInventory: true,
      reversesCogs: true,
    });
    expect(getReturnCostTreatment("financial_only").outcome).toBe("financial_only");
    expect(getReturnCostTreatment("damaged").outcome).toBe("inventory_loss");
  });

  it("records a prospective manual correction without changing physical quantity", () => {
    const before: InventoryValuationPosition = {
      ...knownPosition({ quantity: 2, pool: 200, basisVersion: 5 }),
      uncostedQuantity: 1,
    };
    const result = applyValuationCorrection(before, {
      actorId: "athena-user-1",
      costedQuantity: 3,
      currency: "GHS",
      effectId: "manual-cost-correction-1",
      knownCostPool: 450,
      occurredAt: 600,
      reason: "Confirmed opening valuation",
    });

    expect(result.position).toEqual({
      basisVersion: 6,
      costedQuantity: 3,
      currency: "GHS",
      knownCostPool: 450,
      uncostedQuantity: 0,
      unresolvedDeficitQuantity: 0,
    });
    expect(result.evidence).toMatchObject({
      actorId: "athena-user-1",
      effectId: "manual-cost-correction-1",
      occurredAt: 600,
      reason: "Confirmed opening valuation",
    });
    expect(result.evidence.priorBasis).toEqual(before);
  });

  it("rejects invalid quantities, pools, deficit coverage, and unsafe integer money", () => {
    expect(() =>
      applyOutboundValuation(knownPosition({ quantity: 1, pool: 100 }), {
        disposition: "merchandise_sale",
        occurredAt: 1,
        outboundEffectId: "fractional",
        quantity: 0.5,
      }),
    ).toThrow(/quantity/i);

    expect(() =>
      applyInboundValuation(
        {
          basisVersion: 0,
          costedQuantity: 1,
          currency: "GHS",
          knownCostPool: -1,
          uncostedQuantity: 0,
          unresolvedDeficitQuantity: 0,
        },
        {
          costBasis: uncostedBasis(),
          deficitLots: [],
          inboundEffectId: "invalid-position",
          quantity: 1,
        },
      ),
    ).toThrow(/known cost pool/i);

    expect(() =>
      applyInboundValuation(
        {
          basisVersion: 0,
          costedQuantity: 0,
          currency: null,
          knownCostPool: 0,
          uncostedQuantity: 0,
          unresolvedDeficitQuantity: 2,
        },
        {
          costBasis: uncostedBasis(),
          deficitLots: [deficitLot(1)],
          inboundEffectId: "missing-deficit-evidence",
          quantity: 1,
        },
      ),
    ).toThrow(/deficit lots/i);

    expect(() =>
      knownExtendedCostBasis({
        currency: "GHS",
        quantity: 1,
        totalCost: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow(/safe integer/i);
  });
});

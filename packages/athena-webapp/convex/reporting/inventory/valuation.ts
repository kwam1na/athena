import type {
  DeficitResolution,
  HistoricalValuationCostLane,
  InboundCostBasis,
  InboundValuationInput,
  InboundValuationResult,
  InventoryOutboundDisposition,
  InventoryReturnDisposition,
  InventoryValuationPosition,
  KnownInboundCostBasis,
  LinkedValuationAdjustment,
  OutboundCostTreatment,
  OutboundValuationBasisSnapshot,
  OutboundValuationInput,
  OutboundValuationResult,
  ReturnCostTreatment,
  ReturnValuationInput,
  ReturnValuationResult,
  UnresolvedDeficitLot,
  ValuationBasisStatus,
  ValuationCorrectionInput,
  ValuationCorrectionResult,
  ValuationCostLane,
} from "./types";

const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function assertNonnegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative safe integer.`);
  }
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
}

function assertNonemptyString(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} must not be empty.`);
  }
}

function normalizeCurrency(currency: string): string {
  assertNonemptyString(currency, "Currency");
  return currency.trim().toUpperCase();
}

function compareStableStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function addSafeIntegers(left: number, right: number, label: string): number {
  const result = BigInt(left) + BigInt(right);
  if (result > MAX_SAFE_INTEGER_BIGINT) {
    throw new Error(`${label} must remain a safe integer.`);
  }
  return Number(result);
}

function multiplySafeIntegers(left: number, right: number, label: string): number {
  const result = BigInt(left) * BigInt(right);
  if (result > MAX_SAFE_INTEGER_BIGINT) {
    throw new Error(`${label} must remain a safe integer.`);
  }
  return Number(result);
}

function roundProportion(total: number, part: number, whole: number): number {
  assertNonnegativeSafeInteger(total, "Proportional cost total");
  assertNonnegativeSafeInteger(part, "Proportional cost part");
  assertPositiveSafeInteger(whole, "Proportional cost whole");

  if (part > whole) {
    throw new Error("Proportional cost part cannot exceed the whole quantity.");
  }
  if (part === 0 || total === 0) {
    return 0;
  }
  if (part === whole) {
    return total;
  }

  const numerator = BigInt(total) * BigInt(part);
  const denominator = BigInt(whole);
  return Number((numerator * 2n + denominator) / (denominator * 2n));
}

function allocateCostParts(totalCost: number, quantities: number[]): number[] {
  const totalQuantity = quantities.reduce(
    (sum, quantity) => addSafeIntegers(sum, quantity, "Allocation quantity"),
    0,
  );
  if (totalQuantity === 0) {
    if (totalCost !== 0) {
      throw new Error("Known cost cannot be allocated without quantity.");
    }
    return quantities.map(() => 0);
  }

  let remainingCost = totalCost;
  let remainingQuantity = totalQuantity;
  return quantities.map((quantity, index) => {
    assertNonnegativeSafeInteger(quantity, "Allocation quantity");
    const allocated =
      index === quantities.length - 1
        ? remainingCost
        : roundProportion(remainingCost, quantity, remainingQuantity);
    remainingCost -= allocated;
    remainingQuantity -= quantity;
    return allocated;
  });
}

function copyPosition(
  position: InventoryValuationPosition,
): InventoryValuationPosition {
  return { ...position };
}

function normalizeAndValidatePosition(
  position: InventoryValuationPosition,
): InventoryValuationPosition {
  assertNonnegativeSafeInteger(position.basisVersion, "Basis version");
  assertNonnegativeSafeInteger(position.costedQuantity, "Costed quantity");
  assertNonnegativeSafeInteger(position.knownCostPool, "Known cost pool");
  assertNonnegativeSafeInteger(position.uncostedQuantity, "Uncosted quantity");
  assertNonnegativeSafeInteger(
    position.unresolvedDeficitQuantity,
    "Unresolved deficit quantity",
  );

  if (
    position.unresolvedDeficitQuantity > 0 &&
    (position.costedQuantity > 0 || position.uncostedQuantity > 0)
  ) {
    throw new Error(
      "A valuation position cannot hold on-hand quantity while a deficit remains unresolved.",
    );
  }

  if (position.costedQuantity === 0) {
    if (position.knownCostPool !== 0) {
      throw new Error("Known cost pool must be zero without costed quantity.");
    }
    if (position.currency !== null) {
      throw new Error("Valuation currency must be null without costed quantity.");
    }
    return copyPosition(position);
  }

  if (position.currency === null) {
    throw new Error("Valuation currency is required for costed quantity.");
  }

  return {
    ...position,
    currency: normalizeCurrency(position.currency),
  };
}

function incrementBasisVersion(current: number): number {
  return addSafeIntegers(current, 1, "Basis version");
}

function normalizeCostBasis(
  costBasis: InboundCostBasis,
  inboundQuantity: number,
): InboundCostBasis {
  if (costBasis.kind === "uncosted") {
    return costBasis;
  }

  assertPositiveSafeInteger(costBasis.quantity, "Known cost basis quantity");
  assertNonnegativeSafeInteger(costBasis.totalCost, "Known extended cost");
  if (costBasis.unitCost !== null) {
    assertNonnegativeSafeInteger(costBasis.unitCost, "Known unit cost");
    if (
      multiplySafeIntegers(
        costBasis.quantity,
        costBasis.unitCost,
        "Known extended cost",
      ) !== costBasis.totalCost
    ) {
      throw new Error("Known unit cost must reconcile to the extended cost.");
    }
  }
  if (costBasis.quantity !== inboundQuantity) {
    throw new Error("Known cost basis quantity must equal inbound quantity.");
  }

  return {
    ...costBasis,
    currency: normalizeCurrency(costBasis.currency),
  };
}

function validateDeficitLots(
  position: InventoryValuationPosition,
  deficitLots: UnresolvedDeficitLot[],
  deferredDeficitQuantity = 0,
): UnresolvedDeficitLot[] {
  assertNonnegativeSafeInteger(
    deferredDeficitQuantity,
    "Deferred deficit quantity",
  );
  const normalized = deficitLots.map((lot) => {
    assertNonemptyString(lot.outboundEffectId, "Outbound effect id");
    assertNonnegativeSafeInteger(lot.occurredAt, "Deficit occurrence time");
    assertPositiveSafeInteger(lot.remainingQuantity, "Deficit lot quantity");
    return { ...lot };
  });
  const total = normalized.reduce(
    (sum, lot) => addSafeIntegers(sum, lot.remainingQuantity, "Deficit lot total"),
    0,
  );
  if (total + deferredDeficitQuantity !== position.unresolvedDeficitQuantity) {
    throw new Error(
      "Deficit lots must exactly equal the unresolved deficit quantity.",
    );
  }

  return normalized.sort(
    (left, right) =>
      left.occurredAt - right.occurredAt ||
      compareStableStrings(left.outboundEffectId, right.outboundEffectId),
  );
}

function normalizeOutboundBasis(
  basis: OutboundValuationBasisSnapshot,
): OutboundValuationBasisSnapshot {
  assertNonnegativeSafeInteger(
    basis.allocatedKnownCost,
    "Allocated known cost",
  );
  assertNonnegativeSafeInteger(basis.basisVersion, "Basis version");
  assertNonnegativeSafeInteger(basis.costedQuantity, "Costed quantity");
  assertNonnegativeSafeInteger(
    basis.knownCostPoolBefore,
    "Known cost pool before outbound",
  );
  assertNonnegativeSafeInteger(basis.uncostedQuantity, "Uncosted quantity");
  assertNonnegativeSafeInteger(
    basis.unresolvedDeficitQuantity,
    "Outbound deficit quantity",
  );
  if (basis.allocatedKnownCost > basis.knownCostPoolBefore) {
    throw new Error("Allocated known cost cannot exceed the source cost pool.");
  }
  if (basis.costedQuantity === 0) {
    if (basis.allocatedKnownCost !== 0 || basis.currency !== null) {
      throw new Error(
        "An outbound basis without costed quantity cannot carry known cost or currency.",
      );
    }
  } else if (basis.currency === null) {
    throw new Error("Outbound basis currency is required for costed quantity.");
  }
  if (basis.roundedWeightedAverageUnitCost !== null) {
    assertNonnegativeSafeInteger(
      basis.roundedWeightedAverageUnitCost,
      "Rounded weighted-average unit cost",
    );
  }

  return {
    ...basis,
    currency:
      basis.currency === null ? null : normalizeCurrency(basis.currency),
  };
}

function historicalCostLane(
  costLane: ValuationCostLane,
): HistoricalValuationCostLane {
  switch (costLane) {
    case "merchandise_cogs":
      return "historical_merchandise_cogs";
    case "exchange_merchandise_cogs":
      return "historical_exchange_merchandise_cogs";
    case "inventory_consumed":
      return "historical_inventory_consumed";
    case "inventory_loss":
      return "historical_inventory_loss";
    case "inventory_adjustment":
      return "historical_inventory_adjustment";
  }
}

type InboundPartResult = Omit<InboundValuationResult, "position"> & {
  position: InventoryValuationPosition;
};

function applyInboundPart(
  positionInput: InventoryValuationPosition,
  input: InboundValuationInput,
): InboundPartResult {
  const position = normalizeAndValidatePosition(positionInput);
  assertPositiveSafeInteger(input.quantity, "Inbound quantity");
  assertNonemptyString(input.inboundEffectId, "Inbound effect id");
  const deferredDeficitQuantity = input.deferredDeficitQuantity ?? 0;
  const deficitLots = validateDeficitLots(
    position,
    input.deficitLots,
    deferredDeficitQuantity,
  );
  const costBasis = normalizeCostBasis(input.costBasis, input.quantity);

  if (costBasis.kind === "known") {
    if (position.currency !== null && position.currency !== costBasis.currency) {
      throw new Error("Inbound currency must match the current valuation currency.");
    }
  }

  const quantityResolvingDeficit = Math.min(
    position.unresolvedDeficitQuantity,
    input.quantity,
  );
  const loadedDeficitQuantity = deficitLots.reduce(
    (sum, lot) =>
      addSafeIntegers(sum, lot.remainingQuantity, "Loaded deficit quantity"),
    0,
  );
  if (loadedDeficitQuantity < quantityResolvingDeficit) {
    throw new Error(
      "Bounded FIFO prefix must cover the quantity resolving deficit.",
    );
  }
  const residualQuantity = input.quantity - quantityResolvingDeficit;
  let quantityToResolve = quantityResolvingDeficit;
  const resolutionParts: Array<{
    costLane: ValuationCostLane;
    outboundEffectId: string;
    quantity: number;
  }> = [];
  const remainingDeficitLots: UnresolvedDeficitLot[] = [];

  for (const lot of deficitLots) {
    const resolvedQuantity = Math.min(lot.remainingQuantity, quantityToResolve);
    if (resolvedQuantity > 0) {
      resolutionParts.push({
        costLane: lot.costLane,
        outboundEffectId: lot.outboundEffectId,
        quantity: resolvedQuantity,
      });
      quantityToResolve -= resolvedQuantity;
    }
    const remainingQuantity = lot.remainingQuantity - resolvedQuantity;
    if (remainingQuantity > 0) {
      remainingDeficitLots.push({ ...lot, remainingQuantity });
    }
  }

  const costParts =
    costBasis.kind === "known"
      ? allocateCostParts(costBasis.totalCost, [
          ...resolutionParts.map((part) => part.quantity),
          residualQuantity,
        ])
      : resolutionParts.map(() => 0).concat(0);
  const residualCost = costParts[costParts.length - 1] ?? 0;
  const deficitResolutions: DeficitResolution[] = resolutionParts.map(
    (part, index) => ({
      costStatus: costBasis.kind === "known" ? "known" : "unknown",
      inboundEffectId: input.inboundEffectId,
      knownCost: costBasis.kind === "known" ? costParts[index] : null,
      outboundEffectId: part.outboundEffectId,
      quantity: part.quantity,
    }),
  );
  const valuationAdjustments: LinkedValuationAdjustment[] =
    costBasis.kind === "known"
      ? resolutionParts.map((part, index) => ({
          costLane: historicalCostLane(part.costLane),
          currency: costBasis.currency,
          inboundEffectId: input.inboundEffectId,
          knownCost: costParts[index] ?? 0,
          outboundEffectId: part.outboundEffectId,
          quantity: part.quantity,
        }))
      : [];

  const residualCostedQuantity =
    costBasis.kind === "known" ? residualQuantity : 0;
  const residualUncostedQuantity =
    costBasis.kind === "uncosted" ? residualQuantity : 0;
  const nextCostedQuantity = addSafeIntegers(
    position.costedQuantity,
    residualCostedQuantity,
    "Costed quantity",
  );
  const nextKnownCostPool = addSafeIntegers(
    position.knownCostPool,
    residualCost,
    "Known cost pool",
  );
  const nextPosition = normalizeAndValidatePosition({
    basisVersion: position.basisVersion,
    costedQuantity: nextCostedQuantity,
    currency:
      nextCostedQuantity > 0
        ? position.currency ??
          (costBasis.kind === "known" ? costBasis.currency : null)
        : null,
    knownCostPool: nextKnownCostPool,
    uncostedQuantity: addSafeIntegers(
      position.uncostedQuantity,
      residualUncostedQuantity,
      "Uncosted quantity",
    ),
    unresolvedDeficitQuantity:
      position.unresolvedDeficitQuantity - quantityResolvingDeficit,
  });

  return {
    costAddedToPool: residualCost,
    deferredDeficitQuantity,
    deficitResolutions,
    position: nextPosition,
    remainingDeficitLots,
    residualCostedQuantity,
    residualUncostedQuantity,
    valuationAdjustments,
  };
}

export function createEmptyValuationPosition(
  basisVersion = 0,
): InventoryValuationPosition {
  assertNonnegativeSafeInteger(basisVersion, "Basis version");
  return {
    basisVersion,
    costedQuantity: 0,
    currency: null,
    knownCostPool: 0,
    uncostedQuantity: 0,
    unresolvedDeficitQuantity: 0,
  };
}

export function deriveValuationBasisStatus(
  positionInput: InventoryValuationPosition,
): ValuationBasisStatus {
  const position = normalizeAndValidatePosition(positionInput);
  if (position.unresolvedDeficitQuantity > 0) {
    return "deficit";
  }
  if (position.costedQuantity > 0 && position.uncostedQuantity > 0) {
    return "mixed";
  }
  if (position.costedQuantity > 0) {
    return "costed";
  }
  if (position.uncostedQuantity > 0) {
    return "uncosted";
  }
  return "empty";
}

export function getWeightedAverageUnitCost(
  positionInput: InventoryValuationPosition,
): number | null {
  const position = normalizeAndValidatePosition(positionInput);
  if (position.costedQuantity === 0) {
    return null;
  }
  return roundProportion(
    position.knownCostPool,
    1,
    position.costedQuantity,
  );
}

export function knownUnitCostBasis(args: {
  currency: string;
  quantity: number;
  unitCost: number;
}): KnownInboundCostBasis {
  assertPositiveSafeInteger(args.quantity, "Known cost basis quantity");
  assertNonnegativeSafeInteger(args.unitCost, "Known unit cost");
  return {
    kind: "known",
    currency: normalizeCurrency(args.currency),
    quantity: args.quantity,
    totalCost: multiplySafeIntegers(
      args.quantity,
      args.unitCost,
      "Known extended cost",
    ),
    unitCost: args.unitCost,
  };
}

export function knownExtendedCostBasis(args: {
  currency: string;
  quantity: number;
  totalCost: number;
}): KnownInboundCostBasis {
  assertPositiveSafeInteger(args.quantity, "Known cost basis quantity");
  assertNonnegativeSafeInteger(args.totalCost, "Known extended cost");
  return {
    kind: "known",
    currency: normalizeCurrency(args.currency),
    quantity: args.quantity,
    totalCost: args.totalCost,
    unitCost: null,
  };
}

export function uncostedBasis(): InboundCostBasis {
  return { kind: "uncosted" };
}

export function getOutboundCostTreatment(
  disposition: InventoryOutboundDisposition,
): OutboundCostTreatment {
  switch (disposition) {
    case "merchandise_sale":
      return { costLane: "merchandise_cogs", recognizesRevenue: false };
    case "exchange_replacement":
      return {
        costLane: "exchange_merchandise_cogs",
        recognizesRevenue: false,
      };
    case "service_consumption":
    case "inventory_expense":
      return { costLane: "inventory_consumed", recognizesRevenue: false };
    case "damage":
    case "writeoff":
      return { costLane: "inventory_loss", recognizesRevenue: false };
    case "stock_correction":
      return { costLane: "inventory_adjustment", recognizesRevenue: false };
  }
}

export function getReturnCostTreatment(
  disposition: InventoryReturnDisposition,
): ReturnCostTreatment {
  switch (disposition) {
    case "sellable":
      return {
        outcome: "sellable_restock",
        restoresSellableInventory: true,
        reversesCogs: true,
      };
    case "financial_only":
      return {
        outcome: "financial_only",
        restoresSellableInventory: false,
        reversesCogs: false,
      };
    case "damaged":
    case "missing":
      return {
        outcome: "inventory_loss",
        restoresSellableInventory: false,
        reversesCogs: false,
      };
    case "non_restocked":
      return {
        outcome: "non_restocked",
        restoresSellableInventory: false,
        reversesCogs: false,
      };
  }
}

export function applyInboundValuation(
  position: InventoryValuationPosition,
  input: InboundValuationInput,
): InboundValuationResult {
  const result = applyInboundPart(position, input);
  return {
    ...result,
    position: {
      ...result.position,
      basisVersion: incrementBasisVersion(result.position.basisVersion),
    },
  };
}

export function applyOutboundValuation(
  positionInput: InventoryValuationPosition,
  input: OutboundValuationInput,
): OutboundValuationResult {
  const position = normalizeAndValidatePosition(positionInput);
  assertPositiveSafeInteger(input.quantity, "Outbound quantity");
  assertNonemptyString(input.outboundEffectId, "Outbound effect id");
  assertNonnegativeSafeInteger(input.occurredAt, "Outbound occurrence time");

  const uncostedQuantity = Math.min(
    position.uncostedQuantity,
    input.quantity,
  );
  const quantityAfterUncosted = input.quantity - uncostedQuantity;
  const costedQuantity = Math.min(
    position.costedQuantity,
    quantityAfterUncosted,
  );
  const deficitQuantity = quantityAfterUncosted - costedQuantity;
  const knownCost =
    costedQuantity === position.costedQuantity
      ? position.knownCostPool
      : costedQuantity === 0
        ? 0
        : roundProportion(
            position.knownCostPool,
            costedQuantity,
            position.costedQuantity,
          );
  const nextCostedQuantity = position.costedQuantity - costedQuantity;
  const nextKnownCostPool = position.knownCostPool - knownCost;
  const treatment = getOutboundCostTreatment(input.disposition);
  const createdDeficitLot =
    deficitQuantity > 0
      ? {
          costLane: treatment.costLane,
          occurredAt: input.occurredAt,
          outboundEffectId: input.outboundEffectId,
          remainingQuantity: deficitQuantity,
        }
      : null;
  const nextPosition = normalizeAndValidatePosition({
    basisVersion: incrementBasisVersion(position.basisVersion),
    costedQuantity: nextCostedQuantity,
    currency: nextCostedQuantity > 0 ? position.currency : null,
    knownCostPool: nextKnownCostPool,
    uncostedQuantity: position.uncostedQuantity - uncostedQuantity,
    unresolvedDeficitQuantity: addSafeIntegers(
      position.unresolvedDeficitQuantity,
      deficitQuantity,
      "Unresolved deficit quantity",
    ),
  });

  return {
    basis: {
      allocatedKnownCost: knownCost,
      basisVersion: position.basisVersion,
      costedQuantity,
      currency: costedQuantity > 0 ? position.currency : null,
      knownCostPoolBefore: position.knownCostPool,
      roundedWeightedAverageUnitCost: getWeightedAverageUnitCost(position),
      uncostedQuantity,
      unresolvedDeficitQuantity: deficitQuantity,
    },
    consumed: {
      costedQuantity,
      deficitQuantity,
      knownCost,
      uncostedQuantity,
    },
    createdDeficitLot,
    position: nextPosition,
    treatment,
  };
}

export function applyReturnValuation(
  positionInput: InventoryValuationPosition,
  input: ReturnValuationInput,
): ReturnValuationResult {
  const position = normalizeAndValidatePosition(positionInput);
  const originalBasis = normalizeOutboundBasis(input.originalBasis);
  assertPositiveSafeInteger(input.quantity, "Return quantity");
  assertNonemptyString(input.returnEffectId, "Return effect id");
  assertNonnegativeSafeInteger(input.occurredAt, "Return occurrence time");
  const treatment = getReturnCostTreatment(input.disposition);

  if (!treatment.restoresSellableInventory) {
    return {
      cogsReversalKnownCost: 0,
      deferredDeficitQuantity: input.deferredDeficitQuantity ?? 0,
      deficitResolutions: [],
      knownCostAppliedToDeficit: 0,
      position,
      remainingDeficitLots: input.deficitLots.map((lot) => ({ ...lot })),
      restored: { costedQuantity: 0, uncostedQuantity: 0 },
      treatment,
      valuationAdjustments: [],
    };
  }

  const originalQuantity = addSafeIntegers(
    originalBasis.costedQuantity,
    originalBasis.uncostedQuantity,
    "Original outbound quantity",
  );
  if (input.quantity > originalQuantity) {
    throw new Error("Return quantity cannot exceed the original outbound basis.");
  }

  const restoredUncostedQuantity = Math.min(
    originalBasis.uncostedQuantity,
    input.quantity,
  );
  const restoredCostedQuantity = input.quantity - restoredUncostedQuantity;
  const restoredKnownCost =
    restoredCostedQuantity === 0
      ? 0
      : roundProportion(
          originalBasis.allocatedKnownCost,
          restoredCostedQuantity,
          originalBasis.costedQuantity,
        );

  let currentPosition = position;
  let currentDeficitLots = input.deficitLots.map((lot) => ({ ...lot }));
  let currentDeferredDeficitQuantity = input.deferredDeficitQuantity ?? 0;
  const deficitResolutions: DeficitResolution[] = [];
  const valuationAdjustments: LinkedValuationAdjustment[] = [];
  let residualUncostedQuantity = 0;
  let residualCostedQuantity = 0;
  let costAddedToPool = 0;

  if (restoredUncostedQuantity > 0) {
    const unknownResult = applyInboundPart(currentPosition, {
      costBasis: uncostedBasis(),
      deferredDeficitQuantity: currentDeferredDeficitQuantity,
      deficitLots: currentDeficitLots,
      inboundEffectId: input.returnEffectId,
      quantity: restoredUncostedQuantity,
    });
    currentPosition = unknownResult.position;
    currentDeficitLots = unknownResult.remainingDeficitLots;
    currentDeferredDeficitQuantity = unknownResult.deferredDeficitQuantity;
    deficitResolutions.push(...unknownResult.deficitResolutions);
    residualUncostedQuantity += unknownResult.residualUncostedQuantity;
  }

  if (restoredCostedQuantity > 0) {
    if (originalBasis.currency === null) {
      throw new Error("Original outbound currency is required for known return cost.");
    }
    const knownResult = applyInboundPart(currentPosition, {
      costBasis: knownExtendedCostBasis({
        currency: originalBasis.currency,
        quantity: restoredCostedQuantity,
        totalCost: restoredKnownCost,
      }),
      deferredDeficitQuantity: currentDeferredDeficitQuantity,
      deficitLots: currentDeficitLots,
      inboundEffectId: input.returnEffectId,
      quantity: restoredCostedQuantity,
    });
    currentPosition = knownResult.position;
    currentDeficitLots = knownResult.remainingDeficitLots;
    currentDeferredDeficitQuantity = knownResult.deferredDeficitQuantity;
    deficitResolutions.push(...knownResult.deficitResolutions);
    valuationAdjustments.push(...knownResult.valuationAdjustments);
    residualCostedQuantity += knownResult.residualCostedQuantity;
    costAddedToPool += knownResult.costAddedToPool;
  }

  return {
    cogsReversalKnownCost: restoredKnownCost,
    deferredDeficitQuantity: currentDeferredDeficitQuantity,
    deficitResolutions,
    knownCostAppliedToDeficit: valuationAdjustments.reduce(
      (sum, adjustment) =>
        addSafeIntegers(sum, adjustment.knownCost, "Deficit adjustment cost"),
      0,
    ),
    position: {
      ...currentPosition,
      basisVersion: incrementBasisVersion(position.basisVersion),
    },
    remainingDeficitLots: currentDeficitLots,
    restored: {
      costedQuantity: residualCostedQuantity,
      uncostedQuantity: residualUncostedQuantity,
    },
    treatment,
    valuationAdjustments,
  };
}

export function applyValuationCorrection(
  positionInput: InventoryValuationPosition,
  input: ValuationCorrectionInput,
): ValuationCorrectionResult {
  const position = normalizeAndValidatePosition(positionInput);
  assertNonemptyString(input.actorId, "Correction actor id");
  assertNonemptyString(input.effectId, "Correction effect id");
  assertNonemptyString(input.reason, "Correction reason");
  assertNonnegativeSafeInteger(input.occurredAt, "Correction occurrence time");
  assertNonnegativeSafeInteger(input.costedQuantity, "Corrected costed quantity");
  assertNonnegativeSafeInteger(input.knownCostPool, "Corrected known cost pool");

  if (position.unresolvedDeficitQuantity > 0) {
    throw new Error("Manual valuation correction cannot cost unresolved deficit.");
  }
  const onHandQuantity = addSafeIntegers(
    position.costedQuantity,
    position.uncostedQuantity,
    "On-hand quantity",
  );
  if (input.costedQuantity > onHandQuantity) {
    throw new Error("Corrected costed quantity cannot exceed on-hand quantity.");
  }

  const nextPosition = normalizeAndValidatePosition({
    basisVersion: incrementBasisVersion(position.basisVersion),
    costedQuantity: input.costedQuantity,
    currency:
      input.costedQuantity > 0 && input.currency !== null
        ? normalizeCurrency(input.currency)
        : input.currency,
    knownCostPool: input.knownCostPool,
    uncostedQuantity: onHandQuantity - input.costedQuantity,
    unresolvedDeficitQuantity: position.unresolvedDeficitQuantity,
  });

  return {
    evidence: {
      actorId: input.actorId.trim(),
      effectId: input.effectId.trim(),
      newBasis: copyPosition(nextPosition),
      occurredAt: input.occurredAt,
      priorBasis: copyPosition(position),
      reason: input.reason.trim(),
    },
    position: nextPosition,
  };
}

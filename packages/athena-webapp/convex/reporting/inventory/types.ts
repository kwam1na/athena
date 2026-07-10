export type ValuationBasisStatus =
  | "empty"
  | "costed"
  | "uncosted"
  | "mixed"
  | "deficit";

export type InventoryValuationPosition = {
  basisVersion: number;
  costedQuantity: number;
  currency: string | null;
  knownCostPool: number;
  uncostedQuantity: number;
  unresolvedDeficitQuantity: number;
};

export type KnownInboundCostBasis = {
  kind: "known";
  currency: string;
  quantity: number;
  totalCost: number;
  unitCost: number | null;
};

export type UncostedInboundCostBasis = {
  kind: "uncosted";
};

export type InboundCostBasis =
  | KnownInboundCostBasis
  | UncostedInboundCostBasis;

export type InventoryOutboundDisposition =
  | "merchandise_sale"
  | "exchange_replacement"
  | "service_consumption"
  | "inventory_expense"
  | "damage"
  | "writeoff"
  | "stock_correction";

export type ValuationCostLane =
  | "merchandise_cogs"
  | "exchange_merchandise_cogs"
  | "inventory_consumed"
  | "inventory_loss"
  | "inventory_adjustment";

export type HistoricalValuationCostLane =
  | "historical_merchandise_cogs"
  | "historical_exchange_merchandise_cogs"
  | "historical_inventory_consumed"
  | "historical_inventory_loss"
  | "historical_inventory_adjustment";

export type OutboundCostTreatment = {
  costLane: ValuationCostLane;
  recognizesRevenue: false;
};

export type InventoryReturnDisposition =
  | "sellable"
  | "financial_only"
  | "damaged"
  | "missing"
  | "non_restocked";

export type ReturnCostOutcome =
  | "sellable_restock"
  | "financial_only"
  | "inventory_loss"
  | "non_restocked";

export type ReturnCostTreatment = {
  outcome: ReturnCostOutcome;
  restoresSellableInventory: boolean;
  reversesCogs: boolean;
};

export type OutboundValuationBasisSnapshot = {
  allocatedKnownCost: number;
  basisVersion: number;
  costedQuantity: number;
  currency: string | null;
  knownCostPoolBefore: number;
  roundedWeightedAverageUnitCost: number | null;
  uncostedQuantity: number;
  unresolvedDeficitQuantity: number;
};

export type UnresolvedDeficitLot = {
  costLane: ValuationCostLane;
  occurredAt: number;
  outboundEffectId: string;
  remainingQuantity: number;
};

export type DeficitResolution = {
  costStatus: "known" | "unknown";
  inboundEffectId: string;
  knownCost: number | null;
  outboundEffectId: string;
  quantity: number;
};

export type LinkedValuationAdjustment = {
  costLane: HistoricalValuationCostLane;
  currency: string;
  inboundEffectId: string;
  knownCost: number;
  outboundEffectId: string;
  quantity: number;
};

export type InboundValuationInput = {
  costBasis: InboundCostBasis;
  deferredDeficitQuantity?: number;
  deficitLots: UnresolvedDeficitLot[];
  inboundEffectId: string;
  quantity: number;
};

export type InboundValuationResult = {
  costAddedToPool: number;
  deferredDeficitQuantity: number;
  deficitResolutions: DeficitResolution[];
  position: InventoryValuationPosition;
  remainingDeficitLots: UnresolvedDeficitLot[];
  residualCostedQuantity: number;
  residualUncostedQuantity: number;
  valuationAdjustments: LinkedValuationAdjustment[];
};

export type OutboundValuationInput = {
  disposition: InventoryOutboundDisposition;
  occurredAt: number;
  outboundEffectId: string;
  quantity: number;
};

export type OutboundValuationResult = {
  basis: OutboundValuationBasisSnapshot;
  consumed: {
    costedQuantity: number;
    deficitQuantity: number;
    knownCost: number;
    uncostedQuantity: number;
  };
  createdDeficitLot: UnresolvedDeficitLot | null;
  position: InventoryValuationPosition;
  treatment: OutboundCostTreatment;
};

export type ReturnValuationInput = {
  deferredDeficitQuantity?: number;
  deficitLots: UnresolvedDeficitLot[];
  disposition: InventoryReturnDisposition;
  occurredAt: number;
  originalBasis: OutboundValuationBasisSnapshot;
  quantity: number;
  returnEffectId: string;
};

export type ReturnValuationResult = {
  cogsReversalKnownCost: number;
  deferredDeficitQuantity: number;
  deficitResolutions: DeficitResolution[];
  knownCostAppliedToDeficit: number;
  position: InventoryValuationPosition;
  remainingDeficitLots: UnresolvedDeficitLot[];
  restored: {
    costedQuantity: number;
    uncostedQuantity: number;
  };
  treatment: ReturnCostTreatment;
  valuationAdjustments: LinkedValuationAdjustment[];
};

export type ValuationCorrectionInput = {
  actorId: string;
  costedQuantity: number;
  currency: string | null;
  effectId: string;
  knownCostPool: number;
  occurredAt: number;
  reason: string;
};

export type ValuationCorrectionEvidence = {
  actorId: string;
  effectId: string;
  newBasis: InventoryValuationPosition;
  occurredAt: number;
  priorBasis: InventoryValuationPosition;
  reason: string;
};

export type ValuationCorrectionResult = {
  evidence: ValuationCorrectionEvidence;
  position: InventoryValuationPosition;
};

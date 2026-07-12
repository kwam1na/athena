export function buildInventoryExposure(input: {
  knownInventoryValueMinor: number | null;
  onHandQuantity: number;
  sellableQuantity: number;
  uncostedOnHandQuantity: number;
}) {
  return {
    ...input,
    exposureSort: input.knownInventoryValueMinor ?? Number.NEGATIVE_INFINITY,
    inventoryCostCoverage:
      input.uncostedOnHandQuantity > 0 ? ("partial" as const) : ("known" as const),
  };
}

export function buildInventoryMovement(input: {
  adjustmentUnits?: number;
  commitmentUnits?: number;
  consumedUnits?: number;
  receiptUnits?: number;
  returnUnits?: number;
  saleUnits?: number;
}) {
  return {
    adjustmentsQuantity: input.adjustmentUnits ?? 0,
    commitmentQuantity: input.commitmentUnits ?? 0,
    consumedQuantity: input.consumedUnits ?? 0,
    receiptsQuantity: input.receiptUnits ?? 0,
    returnsQuantity: input.returnUnits ?? 0,
    salesQuantity: input.saleUnits ?? 0,
  };
}

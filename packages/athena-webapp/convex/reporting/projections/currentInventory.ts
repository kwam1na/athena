export type CurrentInventoryProjectionInput = {
  costedQuantity: number;
  currency: string | null;
  knownCostPoolMinor: number;
  onHandQuantity: number;
  sellableQuantity: number;
  skuId: string;
  storeId: string;
  uncostedQuantity: number;
  unresolvedDeficitQuantity: number;
};

export function buildCurrentInventoryProjection(
  input: CurrentInventoryProjectionInput,
) {
  for (const [field, value] of Object.entries(input)) {
    if (
      typeof value === "number" &&
      (!Number.isSafeInteger(value) || value < 0)
    ) {
      throw new Error(`${field} must be a nonnegative safe integer`);
    }
  }
  if (input.knownCostPoolMinor > 0 && input.currency === null) {
    throw new Error("known value requires currency");
  }
  return {
    averageKnownUnitCostMinor:
      input.costedQuantity > 0
        ? Math.floor(input.knownCostPoolMinor / input.costedQuantity)
        : null,
    costStatus:
      input.uncostedQuantity > 0
        ? input.costedQuantity > 0
          ? ("partial" as const)
          : ("unknown" as const)
        : ("known" as const),
    ...input,
    signedBookPosition:
      input.onHandQuantity - input.unresolvedDeficitQuantity,
  };
}

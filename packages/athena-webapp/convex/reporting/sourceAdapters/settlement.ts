export type SettlementEvidence = {
  amountMinor: number;
  businessEventKey: string;
  currency: string;
  factKind: "settlement";
  occurredAt: number;
  paymentAllocationId: string;
  recordedAt: number;
  revenueMinor: 0;
  status: string;
  storeId: string;
};

export function adaptSettlement(input: Omit<SettlementEvidence, "factKind" | "revenueMinor">) {
  return {
    ...input,
    factKind: "settlement" as const,
    revenueMinor: 0 as const,
  };
}

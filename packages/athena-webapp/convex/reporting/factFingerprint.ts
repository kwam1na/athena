export type ReportingFactCloseSnapshotSemantic = {
  acceptedDeficitAdjustmentMinor: number;
  acceptedNetSalesMinor: number;
  acceptedRefundsMinor: number;
  completeness: "complete" | "partial";
  snapshotVersion: number;
  supersedesCloseId?: string;
};

export type ReportingFactSemanticInput = {
  amountMinor?: number;
  allocatedDiscountMinor?: number;
  attributionKind?: string;
  attributionVersion?: number;
  businessEventKey: string;
  categoryId?: string;
  channel?: string;
  closeSnapshot?: ReportingFactCloseSnapshotSemantic;
  cogsKnownMinor?: number;
  cogsKnownQuantity?: number;
  cogsUncoveredQuantity?: number;
  commitmentConfirmed?: boolean;
  completeness: string;
  costStatus?: string;
  coveredRevenueMinor?: number;
  currencyCode?: string;
  currencyMinorUnitScale?: number;
  expectedInboundAt?: number;
  factType: string;
  inventoryEffectId?: string;
  inventoryImportProvisionalSkuId?: string;
  linkedBusinessEventKey?: string;
  occurrenceAt: number;
  operatingDate: string;
  organizationId: string;
  originalProductSkuId?: string;
  originalQuantity?: number;
  pendingCheckoutItemId?: string;
  productId?: string;
  procurementSignal?: string;
  priorSettlementMethod?: string;
  correctedSettlementMethod?: string;
  productSkuId?: string;
  provisionalProductSkuId?: string;
  quantity?: number;
  recognizedNetAmountMinor?: number;
  recognitionCategoryId?: string;
  recognitionProductId?: string;
  recognitionProductSkuId?: string;
  revenueKind?: string;
  scheduleVersionId?: string;
  historicalInterpretationPolicyId?: string;
  historicalInterpretationPolicyHash?: string;
  serviceCaseId?: string;
  sourceDomain: string;
  sourceLineKey?: string;
  storeId: string;
  unitPriceMinor?: number;
  valuationCurrencyCode?: string;
  valuationCurrencyMinorUnitScale?: number;
};

function normalizedOptionalString(value: string | null | undefined) {
  return value === undefined || value === null ? null : String(value);
}

function normalizedCurrency(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase();
  return normalized || null;
}

function normalizedCloseSnapshot(
  value: ReportingFactCloseSnapshotSemantic | null | undefined,
) {
  if (!value) return null;
  return {
    acceptedDeficitAdjustmentMinor: value.acceptedDeficitAdjustmentMinor,
    acceptedNetSalesMinor: value.acceptedNetSalesMinor,
    acceptedRefundsMinor: value.acceptedRefundsMinor,
    completeness: value.completeness,
    snapshotVersion: value.snapshotVersion,
    supersedesCloseId: value.supersedesCloseId ?? null,
  };
}

export function normalizeReportingFactSemantics(
  input: ReportingFactSemanticInput,
) {
  const lineage = reportingPeriodLineage(input);
  return {
    amountMinor: input.amountMinor ?? null,
    allocatedDiscountMinor: input.allocatedDiscountMinor ?? null,
    attributionKind: input.attributionKind ?? null,
    attributionVersion: input.attributionVersion ?? null,
    businessEventKey: input.businessEventKey,
    categoryId: normalizedOptionalString(input.categoryId),
    channel: input.channel ?? null,
    closeSnapshot: normalizedCloseSnapshot(input.closeSnapshot),
    cogsKnownMinor: input.cogsKnownMinor ?? null,
    cogsKnownQuantity: input.cogsKnownQuantity ?? null,
    cogsUncoveredQuantity: input.cogsUncoveredQuantity ?? null,
    commitmentConfirmed: input.commitmentConfirmed ?? null,
    completeness: input.completeness,
    costStatus: input.costStatus ?? null,
    coveredRevenueMinor: input.coveredRevenueMinor ?? null,
    currencyCode: normalizedCurrency(input.currencyCode),
    currencyMinorUnitScale: input.currencyMinorUnitScale ?? null,
    expectedInboundAt: input.expectedInboundAt ?? null,
    factType: input.factType,
    inventoryEffectId: normalizedOptionalString(input.inventoryEffectId),
    inventoryImportProvisionalSkuId: normalizedOptionalString(
      input.inventoryImportProvisionalSkuId,
    ),
    linkedBusinessEventKey: input.linkedBusinessEventKey ?? null,
    occurrenceAt: input.occurrenceAt,
    operatingDate: input.operatingDate,
    organizationId: String(input.organizationId),
    originalProductSkuId: normalizedOptionalString(input.originalProductSkuId),
    originalQuantity: input.originalQuantity ?? null,
    pendingCheckoutItemId: normalizedOptionalString(
      input.pendingCheckoutItemId,
    ),
    productId: normalizedOptionalString(input.productId),
    procurementSignal: input.procurementSignal ?? null,
    priorSettlementMethod: input.priorSettlementMethod ?? null,
    correctedSettlementMethod: input.correctedSettlementMethod ?? null,
    productSkuId: normalizedOptionalString(input.productSkuId),
    provisionalProductSkuId: normalizedOptionalString(
      input.provisionalProductSkuId,
    ),
    quantity: input.quantity ?? null,
    recognizedNetAmountMinor: input.recognizedNetAmountMinor ?? null,
    recognitionCategoryId: normalizedOptionalString(
      input.recognitionCategoryId,
    ),
    recognitionProductId: normalizedOptionalString(input.recognitionProductId),
    recognitionProductSkuId: normalizedOptionalString(
      input.recognitionProductSkuId,
    ),
    revenueKind: input.revenueKind ?? null,
    periodLineageKind: lineage.kind,
    periodLineageId: lineage.id,
    periodLineageHash:
      lineage.kind === "historical_policy" ? lineage.hash : null,
    serviceCaseId: normalizedOptionalString(input.serviceCaseId),
    sourceDomain: input.sourceDomain,
    sourceLineKey: input.sourceLineKey ?? null,
    storeId: String(input.storeId),
    unitPriceMinor: input.unitPriceMinor ?? null,
    valuationCurrencyCode: normalizedCurrency(input.valuationCurrencyCode),
    valuationCurrencyMinorUnitScale:
      input.valuationCurrencyMinorUnitScale ?? null,
  };
}

export type ReportingFactSemanticField = keyof ReturnType<
  typeof normalizeReportingFactSemantics
>;

const REPORTING_FACT_SEMANTIC_FIELD_ORDER = [
  "organizationId",
  "storeId",
  "sourceDomain",
  "businessEventKey",
  "factType",
  "amountMinor",
  "allocatedDiscountMinor",
  "attributionKind",
  "attributionVersion",
  "categoryId",
  "channel",
  "cogsKnownMinor",
  "cogsKnownQuantity",
  "cogsUncoveredQuantity",
  "completeness",
  "costStatus",
  "coveredRevenueMinor",
  "currencyCode",
  "currencyMinorUnitScale",
  "valuationCurrencyCode",
  "valuationCurrencyMinorUnitScale",
  "occurrenceAt",
  "operatingDate",
  "periodLineageKind",
  "periodLineageId",
  "periodLineageHash",
  "productId",
  "productSkuId",
  "recognitionProductId",
  "recognitionCategoryId",
  "recognitionProductSkuId",
  "originalProductSkuId",
  "provisionalProductSkuId",
  "pendingCheckoutItemId",
  "inventoryImportProvisionalSkuId",
  "quantity",
  "originalQuantity",
  "unitPriceMinor",
  "recognizedNetAmountMinor",
  "revenueKind",
  "serviceCaseId",
  "sourceLineKey",
  "inventoryEffectId",
  "linkedBusinessEventKey",
  "expectedInboundAt",
  "procurementSignal",
  "priorSettlementMethod",
  "correctedSettlementMethod",
  "commitmentConfirmed",
  "closeSnapshot",
] as const satisfies readonly ReportingFactSemanticField[];

export function canonicalReportingFactSemanticFingerprint(
  input: ReportingFactSemanticInput,
) {
  const normalized = normalizeReportingFactSemantics(input);
  return JSON.stringify([
    "reporting-fact-semantic-v3",
    ...REPORTING_FACT_SEMANTIC_FIELD_ORDER.map((field) => normalized[field]),
  ]);
}

export function reportingPeriodLineage(input: {
  scheduleVersionId?: string | null;
  historicalInterpretationPolicyId?: string | null;
  historicalInterpretationPolicyHash?: string | null;
}) {
  const hasSchedule = input.scheduleVersionId !== undefined && input.scheduleVersionId !== null;
  const hasPolicy =
    input.historicalInterpretationPolicyId !== undefined &&
    input.historicalInterpretationPolicyId !== null;
  if (hasSchedule === hasPolicy) {
    throw new Error("Reporting period lineage requires exactly one source");
  }
  if (hasSchedule) {
    if (input.historicalInterpretationPolicyHash) {
      throw new Error("Store Schedule lineage cannot carry a policy hash");
    }
    return {
      kind: "store_schedule" as const,
      id: String(input.scheduleVersionId),
    };
  }
  if (!input.historicalInterpretationPolicyHash) {
    throw new Error("Historical policy lineage requires its immutable hash");
  }
  return {
    kind: "historical_policy" as const,
    id: String(input.historicalInterpretationPolicyId),
    hash: input.historicalInterpretationPolicyHash,
  };
}

export function reportingFactKnownMaterialMatches(input: {
  candidate: ReportingFactSemanticInput;
  existing: ReportingFactSemanticInput;
  unknownCandidateFields?: readonly ReportingFactSemanticField[];
}) {
  const candidate = normalizeReportingFactSemantics(input.candidate);
  const existing = normalizeReportingFactSemantics(input.existing);
  const unknownFields = new Set(input.unknownCandidateFields ?? []);
  return REPORTING_FACT_SEMANTIC_FIELD_ORDER.every(
    (field) =>
      unknownFields.has(field) ||
      JSON.stringify(candidate[field]) === JSON.stringify(existing[field]),
  );
}

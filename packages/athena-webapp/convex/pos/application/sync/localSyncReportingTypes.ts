import type { Id } from "../../../_generated/dataModel";

/**
 * The call shape `LocalSyncRepository.appendReportingIngress` still speaks.
 *
 * These types previously lived in the legacy `convex/reporting/ingress.ts`,
 * which was deleted with the rest of the legacy reporting layer. The offline
 * sale-completion projection in `projectLocalEvents.ts` is the only producer,
 * and `infrastructure/repositories/localSyncRepository.ts` is the only
 * consumer — it translates this shape into `NewReportFact`s for the rebuilt
 * `convex/reports` ingestion API. They are kept verbatim (rather than narrowed
 * to the fields the bridge reads) so the projection code is untouched by the
 * legacy deletion; narrowing them is a separate, independent cleanup.
 */

export type LocalSyncReportingSourceDomain =
  | "pos"
  | "storefront"
  | "service"
  | "payments"
  | "inventory"
  | "procurement"
  | "daily_close";

export type LocalSyncReportingRecognitionChannel =
  | "pos"
  | "storefront"
  | "service";

export type LocalSyncReportingSkuAttributionKind =
  | "direct"
  | "pending_checkout"
  | "inventory_import";

export type LocalSyncReportingSourceReference = {
  sourceType: string;
  sourceId: string;
  relation: "owns" | "supports" | "corrects" | "reverses" | "supersedes";
};

export type ReportingIngressLineInput = {
  allocatedDiscountMinor?: number;
  attributionKind?: LocalSyncReportingSkuAttributionKind;
  canonicalProductSkuId?: Id<"productSku">;
  categoryId?: Id<"category">;
  channel?: LocalSyncReportingRecognitionChannel;
  cogsKnownMinor?: number;
  cogsKnownQuantity?: number;
  cogsUncoveredQuantity?: number;
  costStatus: "known" | "partial" | "unknown" | "not_applicable";
  coveredRevenueMinor?: number;
  discountAmountMinor?: number;
  grossAmountMinor?: number;
  lineKey: string;
  lineKind: "merchandise" | "service" | "delivery" | "tax";
  netAmountMinor?: number;
  productSkuId?: Id<"productSku">;
  quantity: number;
  serviceCaseId?: Id<"serviceCase">;
  sourceLabel?: string;
  inventoryEffectId?: Id<"reportingInventoryEffect">;
  inventoryImportProvisionalSkuId?: Id<"inventoryImportProvisionalSku">;
  originalProductSkuId?: Id<"productSku">;
  originalQuantity?: number;
  pendingCheckoutItemId?: Id<"posPendingCheckoutItem">;
  productId?: Id<"product">;
  provisionalProductSkuId?: Id<"productSku">;
  recognizedNetAmountMinor?: number;
  recognitionCategoryId?: Id<"category">;
  recognitionProductId?: Id<"product">;
  recognitionProductSkuId?: Id<"productSku">;
  valuationCurrencyCode?: string;
  valuationCurrencyMinorUnitScale?: number;
  expectedInboundAt?: number;
  procurementSignal?: "commitment" | "receipt" | "short_receipt";
  commitmentConfirmed?: boolean;
  taxAmountMinor?: number;
  unitPriceMinor?: number;
};

export type ReportingIngressArgs = {
  organizationId: Id<"organization">;
  storeId: Id<"store">;
  sourceDomain: LocalSyncReportingSourceDomain;
  sourceEventType: string;
  businessEventKey: string;
  linkedBusinessEventKey?: string;
  adapterVersion: number;
  factContractVersion?: number;
  occurredAt: number;
  acceptedAt: number;
  synchronizedAt?: number;
  currencyCode?: string;
  currencyMinorUnitScale?: number;
  grossAmountMinor?: number;
  discountAmountMinor?: number;
  netAmountMinor?: number;
  taxAmountMinor?: number;
  settlementAmountMinor?: number;
  priorSettlementMethod?: string;
  correctedSettlementMethod?: string;
  quantity?: number;
  closeSnapshot?: {
    acceptedDeficitAdjustmentMinor: number;
    acceptedNetSalesMinor: number;
    acceptedRefundsMinor: number;
    completeness: "complete" | "partial";
    snapshotVersion: number;
    supersedesCloseId?: string;
  };
  contentFingerprint: string;
  materialFields: string[];
  sourceReferences: LocalSyncReportingSourceReference[];
  lines?: ReportingIngressLineInput[];
};

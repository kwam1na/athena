export type CommerceLine = {
  allocatedDiscountMinor?: number;
  canonicalSkuId?: string;
  categoryId?: string;
  cogsKnownMinor?: number | null;
  kind: "merchandise" | "service" | "delivery" | "tax";
  lineId: string;
  netRevenueMinor: number;
  inventoryImportProvisionalSkuId?: string;
  originalSkuId?: string;
  pendingCheckoutItemId?: string;
  productId?: string;
  provisionalSkuId?: string;
  quantity: number;
  serviceCaseId?: string;
  skuId?: string;
  unitPriceMinor?: number;
};

type SourceEventBase = {
  currency: string;
  eventKey: string;
  occurredAt: number;
  recordedAt: number;
  storeId: string;
};

export type PosCompletedEvent = SourceEventBase & {
  kind: "pos_completed";
  lines: CommerceLine[];
  sourceId: string;
};

export type StorefrontStatusEvent = SourceEventBase & {
  kind: "storefront_status_changed";
  lines: CommerceLine[];
  previousStatus: string;
  sourceId: string;
  status: string;
};

export type ServiceCompletedEvent = SourceEventBase & {
  kind: "service_completed";
  netRevenueMinor: number;
  posTransactionId?: string;
  serviceCaseId: string;
};

export type RefundFinalizedEvent = SourceEventBase & {
  kind: "refund_finalized";
  lineId?: string;
  netRevenueMinor: number;
  originalEventKey: string;
  quantity: number;
  sourceId: string;
};

export type CommerceSourceEvent =
  | PosCompletedEvent
  | StorefrontStatusEvent
  | ServiceCompletedEvent
  | RefundFinalizedEvent;

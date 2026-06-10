export const POS_LOCAL_SYNC_EVENT_TYPES = [
  "register_opened",
  "pending_checkout_item_defined",
  "sale_completed",
  "register_closed",
  "register_reopened",
  "sale_cleared",
] as const;

export const POS_LOCAL_SYNC_EVENT_STATUSES = [
  "accepted",
  "projected",
  "conflicted",
  "held",
  "rejected",
] as const;

export type PosLocalSyncEventType =
  (typeof POS_LOCAL_SYNC_EVENT_TYPES)[number];

export type PosLocalSyncEventStatus =
  (typeof POS_LOCAL_SYNC_EVENT_STATUSES)[number];

export type PosLocalSyncRegisterOpenedPayload = {
  openingFloat: number;
  registerNumber?: string;
  notes?: string;
};

export type PosLocalSyncPendingCheckoutItemSearchContext = {
  query?: string;
  source?: "barcode" | "lookup_code" | "manual" | "catalog_search" | "unknown";
  matched?: "existing_product" | "pending_checkout_item" | "none" | "unknown";
};

export type PosLocalSyncPendingCheckoutItemLocalMetadata = {
  schema: "pos_pending_checkout_item_local_metadata_v1";
  source?: "offline_search" | "online_search" | "manual_entry" | "unknown";
  reusedExistingPendingItem?: boolean;
  createdOffline?: boolean;
  appSessionValidation?: "supported" | "unverified";
  cloudValidation?: "uncertain";
};

export type PosLocalSyncPendingCheckoutItemDefinedPayload = {
  localPendingCheckoutItemId: string;
  name: string;
  lookupCode?: string;
  searchContext?: PosLocalSyncPendingCheckoutItemSearchContext;
  price: number;
  quantitySold: number;
  localMetadata?: PosLocalSyncPendingCheckoutItemLocalMetadata;
};

export type PosLocalSyncSaleItemPayload = {
  localTransactionItemId?: string;
  productId: string;
  productSkuId: string;
  pendingCheckoutItemId?: string;
  inventoryImportProvisionalSkuId?: string;
  productName: string;
  productSku: string;
  barcode?: string;
  quantity: number;
  unitPrice: number;
  image?: string;
};

export type PosLocalSyncServiceLinePayload = {
  localServiceLineId?: string;
  localServiceCaseId?: string;
  existingServiceCaseId?: string;
  serviceCatalogId: string;
  serviceCatalogName: string;
  serviceMode: "same_day" | "consultation" | "repair" | "revamp";
  pricingModel: "fixed" | "starting_at" | "quote_after_consultation";
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  catalogUpdatedAt?: number;
  customerProfileId?: string;
};

export type PosLocalSyncPaymentPayload = {
  localPaymentId?: string;
  method: string;
  amount: number;
  timestamp: number;
};

export type PosLocalSyncSaleCompletedPayload = {
  localPosSessionId: string;
  localTransactionId: string;
  localReceiptNumber: string;
  receiptNumber: string;
  registerNumber?: string;
  customerProfileId?: string;
  customerInfo?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  totals: {
    subtotal: number;
    tax: number;
    total: number;
  };
  items: PosLocalSyncSaleItemPayload[];
  serviceLines?: PosLocalSyncServiceLinePayload[];
  payments: PosLocalSyncPaymentPayload[];
};

export type PosLocalSyncRegisterClosedPayload = {
  countedCash?: number;
  notes?: string;
};

export type PosLocalSyncSaleClearedPayload = {
  localPosSessionId: string;
  reason?: string;
};

export type PosLocalSyncRegisterReopenedPayload = {
  reason?: string;
};

export type PosLocalSyncPayloadByEventType = {
  register_opened: PosLocalSyncRegisterOpenedPayload;
  pending_checkout_item_defined: PosLocalSyncPendingCheckoutItemDefinedPayload;
  sale_completed: PosLocalSyncSaleCompletedPayload;
  sale_cleared: PosLocalSyncSaleClearedPayload;
  register_closed: PosLocalSyncRegisterClosedPayload;
  register_reopened: PosLocalSyncRegisterReopenedPayload;
};

export type PosLocalSyncUploadEventBase<
  EventType extends PosLocalSyncEventType,
> = {
  localEventId: string;
  localRegisterSessionId: string;
  sequence: number;
  eventType: EventType;
  occurredAt: number;
  staffProfileId: string;
  staffProofToken?: string;
  payload: PosLocalSyncPayloadByEventType[EventType];
};

export type PosLocalSyncUploadEvent = {
  [EventType in PosLocalSyncEventType]: PosLocalSyncUploadEventBase<EventType>;
}[PosLocalSyncEventType];

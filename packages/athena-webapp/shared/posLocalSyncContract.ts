export const POS_LOCAL_SYNC_EVENT_TYPES = [
  "register_opened",
  "sale_completed",
  "register_closed",
  "register_reopened",
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

export type PosLocalSyncSaleItemPayload = {
  localTransactionItemId?: string;
  productId: string;
  productSkuId: string;
  productName: string;
  productSku: string;
  barcode?: string;
  quantity: number;
  unitPrice: number;
  image?: string;
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
  payments: PosLocalSyncPaymentPayload[];
};

export type PosLocalSyncRegisterClosedPayload = {
  countedCash?: number;
  notes?: string;
};

export type PosLocalSyncRegisterReopenedPayload = {
  reason?: string;
};

export type PosLocalSyncPayloadByEventType = {
  register_opened: PosLocalSyncRegisterOpenedPayload;
  sale_completed: PosLocalSyncSaleCompletedPayload;
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
  staffProofToken: string;
  payload: PosLocalSyncPayloadByEventType[EventType];
};

export type PosLocalSyncUploadEvent = {
  [EventType in PosLocalSyncEventType]: PosLocalSyncUploadEventBase<EventType>;
}[PosLocalSyncEventType];

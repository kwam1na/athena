export const POS_LOCAL_SYNC_EVENT_CONTRACT = [
  {
    eventType: "register_opened",
    localEventType: "register.opened",
    syncScope: "pos",
    browserUploadable: true,
  },
  {
    eventType: "store_day_started",
    localEventType: "store_day.started",
    syncScope: "pos",
    browserUploadable: true,
  },
  {
    eventType: "pending_checkout_item_defined",
    localEventType: "pending_checkout_item.defined",
    syncScope: "pos",
    browserUploadable: true,
  },
  {
    eventType: "sale_completed",
    localEventType: "transaction.completed",
    syncScope: "pos",
    browserUploadable: true,
  },
  {
    eventType: "register_closed",
    localEventType: "register.closeout_started",
    syncScope: "pos",
    browserUploadable: true,
  },
  {
    eventType: "register_reopened",
    localEventType: "register.reopened",
    syncScope: "pos",
    browserUploadable: false,
  },
  {
    eventType: "sale_cleared",
    localEventType: "cart.cleared",
    syncScope: "pos",
    browserUploadable: true,
  },
  {
    eventType: "expense_recorded",
    localEventType: "expense.completed",
    syncScope: "expense",
    browserUploadable: true,
  },
] as const;

type PosLocalSyncContractEventTypes<
  Contract extends readonly unknown[],
> = Contract extends readonly [infer First, ...infer Rest]
  ? First extends { readonly eventType: infer EventType }
    ? readonly [EventType, ...PosLocalSyncContractEventTypes<Rest>]
    : PosLocalSyncContractEventTypes<Rest>
  : readonly [];

function eventTypesFromContract<
  const Contract extends readonly { readonly eventType: string }[],
>(
  contract: Contract,
): PosLocalSyncContractEventTypes<Contract> {
  return contract.map(
    (entry) => entry.eventType,
  ) as unknown as PosLocalSyncContractEventTypes<Contract>;
}

export const POS_LOCAL_SYNC_EVENT_TYPES = eventTypesFromContract(
  POS_LOCAL_SYNC_EVENT_CONTRACT,
);

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

export type PosLocalSyncEventContract =
  (typeof POS_LOCAL_SYNC_EVENT_CONTRACT)[number];

export type PosLocalSyncLocalEventType =
  PosLocalSyncEventContract["localEventType"];

export type PosLocalSyncBrowserUploadableLocalEventType = Extract<
  PosLocalSyncEventContract,
  { browserUploadable: true }
>["localEventType"];

export type PosLocalSyncScope = PosLocalSyncEventContract["syncScope"];

const POS_LOCAL_SYNC_EVENT_TYPE_SET = new Set<string>(
  POS_LOCAL_SYNC_EVENT_TYPES,
);

const POS_LOCAL_SYNC_EVENT_CONTRACT_BY_LOCAL_EVENT_TYPE = Object.fromEntries(
  POS_LOCAL_SYNC_EVENT_CONTRACT.map((contract) => [
    contract.localEventType,
    contract,
  ]),
) as {
  [LocalEventType in PosLocalSyncLocalEventType]: Extract<
    PosLocalSyncEventContract,
    { localEventType: LocalEventType }
  >;
};

export function isPosLocalSyncEventType(
  eventType: string,
): eventType is PosLocalSyncEventType {
  return POS_LOCAL_SYNC_EVENT_TYPE_SET.has(eventType);
}

export function getPosLocalSyncEventContractForLocalEventType(
  localEventType: string,
): PosLocalSyncEventContract | null {
  return Object.prototype.hasOwnProperty.call(
    POS_LOCAL_SYNC_EVENT_CONTRACT_BY_LOCAL_EVENT_TYPE,
    localEventType,
  )
    ? POS_LOCAL_SYNC_EVENT_CONTRACT_BY_LOCAL_EVENT_TYPE[
        localEventType as PosLocalSyncLocalEventType
      ]
    : null;
}

export function getPosLocalSyncEventTypeForLocalEventType(
  localEventType: string,
): PosLocalSyncEventType | null {
  return getPosLocalSyncEventContractForLocalEventType(localEventType)
    ?.eventType ?? null;
}

export function canUploadPosLocalSyncLocalEventType(
  localEventType: string,
): localEventType is PosLocalSyncBrowserUploadableLocalEventType {
  return (
    getPosLocalSyncEventContractForLocalEventType(localEventType)
      ?.browserUploadable === true
  );
}

export type PosLocalSyncRegisterOpenedPayload = {
  openingFloat: number;
  registerNumber?: string;
  notes?: string;
};

export type PosLocalSyncStoreDayStartedPayload = {
  operatingDate: string;
  startAt: number;
  endAt: number;
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
  pendingCheckoutAliasState?: "linked_to_catalog";
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

export type PosLocalSyncExpenseRecordedPayload = {
  localExpenseSessionId: string;
  localExpenseEventId: string;
  reason?: string;
  notes?: string;
  totals: {
    subtotal: number;
    tax: number;
    total: number;
  };
  items: PosLocalSyncSaleItemPayload[];
};

export type PosLocalSyncPayloadByEventType = {
  register_opened: PosLocalSyncRegisterOpenedPayload;
  store_day_started: PosLocalSyncStoreDayStartedPayload;
  pending_checkout_item_defined: PosLocalSyncPendingCheckoutItemDefinedPayload;
  sale_completed: PosLocalSyncSaleCompletedPayload;
  sale_cleared: PosLocalSyncSaleClearedPayload;
  register_closed: PosLocalSyncRegisterClosedPayload;
  register_reopened: PosLocalSyncRegisterReopenedPayload;
  expense_recorded: PosLocalSyncExpenseRecordedPayload;
};

export type PosLocalSyncUploadEventBase<
  EventType extends PosLocalSyncEventType,
> = {
  syncScope?: "pos";
  localEventId: string;
  localRegisterSessionId: string;
  sequence: number;
  eventType: EventType;
  occurredAt: number;
  staffProfileId: string;
  staffProofToken?: string;
  payload: PosLocalSyncPayloadByEventType[EventType];
};

export type PosLocalSyncPosUploadEvent = {
  [EventType in Exclude<PosLocalSyncEventType, "expense_recorded">]:
    PosLocalSyncUploadEventBase<EventType>;
}[Exclude<PosLocalSyncEventType, "expense_recorded">];

export type PosLocalSyncExpenseUploadEvent = Omit<
  PosLocalSyncUploadEventBase<"expense_recorded">,
  "localRegisterSessionId" | "syncScope"
> & {
  syncScope: "expense";
  localExpenseSessionId: string;
};

export type PosLocalSyncUploadEvent =
  | PosLocalSyncPosUploadEvent
  | PosLocalSyncExpenseUploadEvent;

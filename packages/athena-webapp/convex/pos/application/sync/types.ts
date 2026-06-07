import type { Doc, Id, TableNames } from "../../../_generated/dataModel";
import type { RegisterSessionTraceableSession } from "../../../operations/registerSessionTracing";
import type { PosSessionTraceableSession } from "../commands/posSessionTracing";
import type {
  PosLocalSyncEventStatus,
  PosLocalSyncEventType,
  PosLocalSyncUploadEvent,
} from "../../../../shared/posLocalSyncContract";

export type { PosLocalSyncEventStatus, PosLocalSyncEventType };

export type PosLocalSyncConflictType =
  | "duplicate_local_id"
  | "inventory"
  | "payment"
  | "permission";

export type PosLocalSyncMappingKind =
  | "registerSession"
  | "posSession"
  | "pendingCheckoutItem"
  | "transaction"
  | "transactionItem"
  | "payment"
  | "receipt"
  | "serviceCase"
  | "serviceLine"
  | "closeout";

export type PosLocalPaymentInput = {
  localPaymentId?: string;
  method: string;
  amount: number;
  timestamp: number;
};

export type PosLocalSaleItemInput = {
  localTransactionItemId?: string;
  productId: Id<"product"> | string;
  productSkuId: Id<"productSku"> | string;
  pendingCheckoutItemId?: Id<"posPendingCheckoutItem"> | string;
  productName: string;
  productSku: string;
  barcode?: string;
  quantity: number;
  unitPrice: number;
  image?: string;
};

export type PosLocalServiceLineInput = {
  localServiceLineId?: string;
  localServiceCaseId?: string;
  existingServiceCaseId?: Id<"serviceCase">;
  serviceCatalogId: Id<"serviceCatalog">;
  serviceCatalogName: string;
  serviceMode: "same_day" | "consultation" | "repair" | "revamp";
  pricingModel: "fixed" | "starting_at" | "quote_after_consultation";
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  catalogUpdatedAt?: number;
  customerProfileId?: Id<"customerProfile">;
};

export type PosLocalPendingCheckoutItemDefinedPayload = {
  localPendingCheckoutItemId: string;
  name: string;
  lookupCode?: string;
  searchContext?: {
    query?: string;
    source?: "barcode" | "lookup_code" | "manual" | "catalog_search" | "unknown";
    matched?: "existing_product" | "pending_checkout_item" | "none" | "unknown";
  };
  price: number;
  quantitySold: number;
  localMetadata?: {
    schema: "pos_pending_checkout_item_local_metadata_v1";
    source?: "offline_search" | "online_search" | "manual_entry" | "unknown";
    reusedExistingPendingItem?: boolean;
    createdOffline?: boolean;
    appSessionValidation?: "supported" | "unverified";
    cloudValidation?: "uncertain";
  };
};

export type PosLocalSalePayload = {
  localPosSessionId: string;
  localTransactionId: string;
  localReceiptNumber: string;
  receiptNumber: string;
  registerNumber?: string;
  customerProfileId?: Id<"customerProfile">;
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
  items: PosLocalSaleItemInput[];
  serviceLines?: PosLocalServiceLineInput[];
  payments: PosLocalPaymentInput[];
};

export type PosLocalRegisterOpenedPayload = {
  openingFloat: number;
  registerNumber?: string;
  notes?: string;
};

export type PosLocalRegisterClosedPayload = {
  countedCash?: number;
  notes?: string;
};

export type PosLocalSaleClearedPayload = {
  localPosSessionId: string;
  reason?: string;
};

export type PosLocalRegisterReopenedPayload = {
  reason?: string;
};

export type PosLocalSyncEventInput = Omit<
  PosLocalSyncUploadEvent,
  "payload" | "staffProfileId"
> & {
  staffProfileId: Id<"staffProfile">;
  staffProofToken?: string;
  payload: Record<string, unknown>;
};

type ParsedPosLocalSyncEventBase<
  EventType extends PosLocalSyncEventType,
  Payload,
> = Omit<PosLocalSyncEventInput, "eventType" | "payload"> & {
  eventType: EventType;
  payload: Payload;
};

export type ParsedPosLocalSyncEventInput =
  | ParsedPosLocalSyncEventBase<"register_opened", PosLocalRegisterOpenedPayload>
  | ParsedPosLocalSyncEventBase<
      "pending_checkout_item_defined",
      PosLocalPendingCheckoutItemDefinedPayload
    >
  | ParsedPosLocalSyncEventBase<"sale_completed", PosLocalSalePayload>
  | ParsedPosLocalSyncEventBase<"sale_cleared", PosLocalSaleClearedPayload>
  | ParsedPosLocalSyncEventBase<"register_closed", PosLocalRegisterClosedPayload>
  | ParsedPosLocalSyncEventBase<"register_reopened", PosLocalRegisterReopenedPayload>;

export type LocalSyncEventRecord = {
  _id: string;
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
  localEventId: string;
  localRegisterSessionId: string;
  sequence: number;
  eventType: PosLocalSyncEventType;
  occurredAt: number;
  staffProfileId: Id<"staffProfile">;
  staffProofTokenHash?: string;
  payload: Record<string, unknown>;
  status: PosLocalSyncEventStatus;
  submittedAt: number;
  acceptedAt?: number;
  projectedAt?: number;
  heldReason?: string;
  rejectionCode?: string;
  rejectionMessage?: string;
};

type LocalSyncMappingRecordBase = {
  _id: string;
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
  localRegisterSessionId: string;
  localEventId: string;
  localId: string;
  createdAt: number;
};

export type LocalSyncMappingRecord =
  LocalSyncMappingRecordBase & {
    localIdKind: PosLocalSyncMappingKind;
    cloudTable: string;
    cloudId: string;
  };

export type LocalSyncMappingRecordInput = Omit<LocalSyncMappingRecord, "_id">;

export type LocalSyncMappingProjectionInput = Omit<
  LocalSyncMappingRecord,
  | "_id"
  | "storeId"
  | "terminalId"
  | "localRegisterSessionId"
  | "localEventId"
  | "createdAt"
>;

export type LocalSyncConflictRecord = {
  _id: string;
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
  localRegisterSessionId: string;
  localEventId: string;
  sequence: number;
  conflictType: PosLocalSyncConflictType;
  status: "needs_review" | "resolved";
  summary: string;
  details: Record<string, unknown>;
  createdAt: number;
  resolvedAt?: number;
  resolvedByStaffProfileId?: Id<"staffProfile">;
};

export type LocalSyncCursorRecord = {
  _id: string;
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
  localRegisterSessionId: string;
  acceptedThroughSequence: number;
  updatedAt: number;
};

export type PosSyncOperationalRole = "cashier" | "manager";

export type PosSyncWorkflowTraceResult = {
  traceCreated: boolean;
  traceId: string;
};

export type SyncProjectionRepository = {
  getTerminal(terminalId: Id<"posTerminal">): Promise<Doc<"posTerminal"> | null>;
  getStaffProfile(
    staffProfileId: Id<"staffProfile">,
  ): Promise<Doc<"staffProfile"> | null>;
  hasActivePosRole(args: {
    staffProfileId: Id<"staffProfile">;
    storeId: Id<"store">;
    allowedRoles: PosSyncOperationalRole[];
  }): Promise<boolean>;
  validateLocalStaffProof(args: {
    staffProfileId: Id<"staffProfile">;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    token: string;
    now: number;
  }): Promise<boolean>;
  getStore(storeId: Id<"store">): Promise<Doc<"store"> | null>;
  getRegisterSession(
    registerSessionId: Id<"registerSession">,
  ): Promise<Doc<"registerSession"> | null>;
  getCustomerProfile(
    customerProfileId: Id<"customerProfile">,
  ): Promise<Doc<"customerProfile"> | null>;
  getProduct(productId: Id<"product">): Promise<Doc<"product"> | null>;
  getProductSku(productSkuId: Id<"productSku">): Promise<Doc<"productSku"> | null>;
  getPendingCheckoutItem(
    pendingCheckoutItemId: Id<"posPendingCheckoutItem">,
  ): Promise<Doc<"posPendingCheckoutItem"> | null>;
  getServiceCatalog(
    serviceCatalogId: Id<"serviceCatalog">,
  ): Promise<Doc<"serviceCatalog"> | null>;
  getServiceCase(
    serviceCaseId: Id<"serviceCase">,
  ): Promise<Doc<"serviceCase"> | null>;
  getActiveHeldQuantity(args: {
    excludeSessionId?: Id<"posSession">;
    productSkuId: Id<"productSku">;
    storeId: Id<"store">;
    now: number;
  }): Promise<number>;
  readActiveInventoryHoldQuantitiesForSession(args: {
    sessionId: Id<"posSession">;
    now: number;
  }): Promise<Map<Id<"productSku">, number>>;
  consumeInventoryHoldsForSession(args: {
    sessionId: Id<"posSession">;
    items: Array<{ productSkuId: Id<"productSku">; quantity: number }>;
    now: number;
  }): Promise<Map<Id<"productSku">, number>>;
  releaseActiveInventoryHoldsForSession(args: {
    sessionId: Id<"posSession">;
    now: number;
  }): Promise<{
    releasedHoldCount: number;
    releasedHolds: Array<{
      holdId: Id<"inventoryHold">;
      productSkuId: Id<"productSku">;
      quantity: number;
    }>;
  }>;
  normalizeCloudId<TableName extends TableNames>(
    tableName: TableName,
    value: string,
  ): Id<TableName> | null;
  findMapping(args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    localRegisterSessionId: string;
    localIdKind: PosLocalSyncMappingKind;
    localId: string;
  }): Promise<LocalSyncMappingRecord | null>;
  findMappingForTerminal(args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    localIdKind: PosLocalSyncMappingKind;
    localId: string;
  }): Promise<LocalSyncMappingRecord | null>;
  createMapping(input: LocalSyncMappingRecordInput): Promise<LocalSyncMappingRecord>;
  createConflict(
    input: Omit<LocalSyncConflictRecord, "_id">,
  ): Promise<LocalSyncConflictRecord>;
  listConflictsForEvent(args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    localEventId: string;
  }): Promise<LocalSyncConflictRecord[]>;
  createRegisterSession(input: {
    storeId: Id<"store">;
    organizationId?: Id<"organization">;
    terminalId: Id<"posTerminal">;
    registerNumber?: string;
    openedByStaffProfileId: Id<"staffProfile">;
    openedAt: number;
    openingFloat: number;
    expectedCash: number;
    notes?: string;
  }): Promise<Id<"registerSession">>;
  findBlockingRegisterSession(args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    registerNumber?: string;
  }): Promise<Doc<"registerSession"> | null>;
  getRegisterSessionByLocalId(args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    localRegisterSessionId: string;
  }): Promise<Doc<"registerSession"> | null>;
  getPosSessionByLocalId(args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    localRegisterSessionId: string;
    localPosSessionId: string;
    registerSessionId?: Id<"registerSession">;
  }): Promise<Doc<"posSession"> | null>;
  patchRegisterSession(
    registerSessionId: Id<"registerSession">,
    patch: Partial<Omit<Doc<"registerSession">, "_id" | "_creationTime">>,
  ): Promise<void>;
  createPosSession(input: {
    localPosSessionId?: string;
    sessionNumber: string;
    storeId: Id<"store">;
    staffProfileId: Id<"staffProfile">;
    registerNumber?: string;
    registerSessionId: Id<"registerSession">;
    terminalId: Id<"posTerminal">;
    transactionId?: Id<"posTransaction">;
    createdAt: number;
    updatedAt: number;
  }): Promise<Id<"posSession">>;
  createPosSessionItem(input: {
    sessionId: Id<"posSession">;
    storeId: Id<"store">;
    productId: Id<"product">;
    productSkuId: Id<"productSku">;
    pendingCheckoutItemId?: Id<"posPendingCheckoutItem">;
    productSku: string;
    productName: string;
    barcode?: string;
    quantity: number;
    price: number;
    image?: string;
    createdAt: number;
    updatedAt: number;
  }): Promise<Id<"posSessionItem">>;
  createServiceWorkItem(input: {
    storeId: Id<"store">;
    organizationId: Id<"organization">;
    type: string;
    status: string;
    priority: string;
    approvalState?: string;
    title: string;
    notes?: string;
    metadata?: Record<string, unknown>;
    createdByStaffProfileId?: Id<"staffProfile">;
    customerProfileId?: Id<"customerProfile">;
  }): Promise<Id<"operationalWorkItem">>;
  createServiceCase(input: {
    customerProfileId: Id<"customerProfile">;
    operationalWorkItemId: Id<"operationalWorkItem">;
    organizationId?: Id<"organization">;
    quotedAmount?: number;
    serviceCatalogId?: Id<"serviceCatalog">;
    serviceMode: "same_day" | "consultation" | "repair" | "revamp";
    storeId: Id<"store">;
  }): Promise<Id<"serviceCase">>;
  createServiceCaseLineItem(input: {
    serviceCaseId: Id<"serviceCase">;
    lineType: "labor" | "material" | "adjustment";
    description: string;
    quantity: number;
    unitPrice: number;
    amount: number;
    notes?: string;
    createdAt: number;
  }): Promise<Id<"serviceCaseLineItem">>;
  syncServiceCaseFinancials(
    serviceCaseId: Id<"serviceCase">,
  ): Promise<void>;
  createTransaction(input: {
    transactionNumber: string;
    storeId: Id<"store">;
    sessionId?: Id<"posSession">;
    registerSessionId: Id<"registerSession">;
    staffProfileId: Id<"staffProfile">;
    registerNumber?: string;
    terminalId: Id<"posTerminal">;
    subtotal: number;
    tax: number;
    total: number;
    customerProfileId?: Id<"customerProfile">;
    payments: PosLocalPaymentInput[];
    totalPaid: number;
    changeGiven?: number;
    paymentMethod?: string;
    completedAt: number;
    customerInfo?: PosLocalSalePayload["customerInfo"];
  }): Promise<Id<"posTransaction">>;
  createTransactionItem(input: {
    transactionId: Id<"posTransaction">;
    productId: Id<"product">;
    productSkuId: Id<"productSku">;
    pendingCheckoutItemId?: Id<"posPendingCheckoutItem">;
    productName: string;
    productSku: string;
    barcode?: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    image?: string;
  }): Promise<Id<"posTransactionItem">>;
  recordPendingCheckoutItemSaleEvidence(input: {
    pendingCheckoutItemId: Id<"posPendingCheckoutItem">;
    storeId: Id<"store">;
    actorUserId?: Id<"athenaUser">;
    actorStaffProfileId?: Id<"staffProfile">;
    lookupCode?: string;
    price: number;
    quantitySold: number;
    posTransactionId?: Id<"posTransaction">;
    registerSessionId?: Id<"registerSession">;
    terminalId?: Id<"posTerminal">;
    localEventId?: string;
    source: "offline_sync";
    timestamp: number;
  }): Promise<Doc<"posPendingCheckoutItem"> | null>;
  createOrReusePendingCheckoutItem(input: {
    storeId: Id<"store">;
    createdByUserId?: Id<"athenaUser">;
    createdByStaffProfileId?: Id<"staffProfile">;
    name: string;
    lookupCode?: string;
    price: number;
    quantitySold: number;
    registerSessionId?: Id<"registerSession">;
    terminalId?: Id<"posTerminal">;
    localEventId?: string;
    source: "offline_sync";
    timestamp: number;
  }): Promise<{
    pendingCheckoutItemId: Id<"posPendingCheckoutItem">;
    productId: Id<"product">;
    productSkuId: Id<"productSku">;
  }>;
  createTransactionServiceLine(input: {
    transactionId: Id<"posTransaction">;
    serviceCaseId: Id<"serviceCase">;
    serviceCatalogId?: Id<"serviceCatalog">;
    serviceName: string;
    serviceMode: "same_day" | "consultation" | "repair" | "revamp";
    pricingSource:
      | "catalog_base_price"
      | "pos_entered"
      | "service_case_quote"
      | "deposit_rule";
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    notes?: string;
  }): Promise<Id<"posTransactionServiceLine">>;
	  patchProductSku(
	    productSkuId: Id<"productSku">,
	    patch: Partial<Omit<Doc<"productSku">, "_id" | "_creationTime">>,
	  ): Promise<void>;
	  recordSaleInventoryMovement(input: {
	    storeId: Id<"store">;
	    organizationId?: Id<"organization">;
	    productId: Id<"product">;
	    productSkuId: Id<"productSku">;
	    quantity: number;
	    posTransactionId: Id<"posTransaction">;
	    registerSessionId: Id<"registerSession">;
	    staffProfileId: Id<"staffProfile">;
	    customerProfileId?: Id<"customerProfile">;
	    transactionNumber: string;
	  }): Promise<"inserted" | "existing">;
	  patchPosSession(
    posSessionId: Id<"posSession">,
    patch: Partial<Omit<Doc<"posSession">, "_id" | "_creationTime">>,
  ): Promise<void>;
  createPaymentAllocation(input: {
    storeId: Id<"store">;
    organizationId?: Id<"organization">;
    targetType: string;
    targetId: string;
    allocationType: string;
    direction: "in" | "out";
    method: string;
    amount: number;
    status: "recorded" | "voided";
    collectedInStore: boolean;
    recordedAt: number;
    actorStaffProfileId: Id<"staffProfile">;
    customerProfileId?: Id<"customerProfile">;
    workItemId?: Id<"operationalWorkItem">;
    registerSessionId?: Id<"registerSession">;
    posTransactionId: Id<"posTransaction">;
    externalReference?: string;
    notes?: string;
  }): Promise<Id<"paymentAllocation">>;
  createOperationalEvent(input: {
    storeId: Id<"store">;
    organizationId?: Id<"organization">;
    eventType: string;
    subjectType: string;
    subjectId: string;
    message: string;
    metadata?: Record<string, unknown>;
    createdAt: number;
    actorStaffProfileId?: Id<"staffProfile">;
    registerSessionId?: Id<"registerSession">;
    paymentAllocationId?: Id<"paymentAllocation">;
    posTransactionId?: Id<"posTransaction">;
  }): Promise<Id<"operationalEvent">>;
  recordPosSessionWorkflowTrace?(input: {
    stage: "completed" | "voided";
    session: PosSessionTraceableSession;
    occurredAt: number;
    transactionId?: Id<"posTransaction">;
    voidReason?: string;
    paymentMethod?: string;
    amount?: number;
    paymentCount?: number;
  }): Promise<PosSyncWorkflowTraceResult>;
  recordRegisterSessionWorkflowTrace?(input: {
    stage: "opened" | "sale_recorded" | "closed" | "closeout_reopened";
    session: RegisterSessionTraceableSession;
    occurredAt?: number;
    amount?: number;
    actorStaffProfileId?: Id<"staffProfile">;
    actorUserId?: Id<"athenaUser">;
    countedCash?: number;
    reason?: string;
    variance?: number;
  }): Promise<PosSyncWorkflowTraceResult>;
};

export type LocalSyncIngestionRepository = {
  getTerminal(terminalId: Id<"posTerminal">): Promise<Doc<"posTerminal"> | null>;
  getStaffProfile(
    staffProfileId: Id<"staffProfile">,
  ): Promise<Doc<"staffProfile"> | null>;
  findEvent(args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    localEventId: string;
  }): Promise<LocalSyncEventRecord | null>;
  getAcceptedThroughSequence(args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    localRegisterSessionId: string;
  }): Promise<number>;
  updateAcceptedThroughSequence(args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    localRegisterSessionId: string;
    acceptedThroughSequence: number;
    updatedAt: number;
  }): Promise<void>;
  hasActivePosRole(args: {
    staffProfileId: Id<"staffProfile">;
    storeId: Id<"store">;
    allowedRoles: PosSyncOperationalRole[];
  }): Promise<boolean>;
  createEvent(
    input: Omit<LocalSyncEventRecord, "_id">,
  ): Promise<LocalSyncEventRecord>;
  patchEvent(
    eventId: string,
    patch: Partial<Omit<LocalSyncEventRecord, "_id">>,
  ): Promise<void>;
  normalizeCloudId<TableName extends TableNames>(
    tableName: TableName,
    value: string,
  ): Id<TableName> | null;
  createConflict(
    input: Omit<LocalSyncConflictRecord, "_id">,
  ): Promise<LocalSyncConflictRecord>;
  resolveConflictsForEvent(args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    localEventId: string;
    resolvedAt: number;
  }): Promise<void>;
  listMappingsForEvent(args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    localEventId: string;
  }): Promise<LocalSyncMappingRecord[]>;
  listConflictsForEvent(args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    localEventId: string;
  }): Promise<LocalSyncConflictRecord[]>;
};

export type LocalSyncRepository = LocalSyncIngestionRepository &
  SyncProjectionRepository;

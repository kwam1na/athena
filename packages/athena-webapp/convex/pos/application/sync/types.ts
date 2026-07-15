import type { Doc, Id, TableNames } from "../../../_generated/dataModel";
import type { RegisterSessionTraceableSession } from "../../../operations/registerSessionTracing";
import type { PosSessionTraceableSession } from "../commands/posSessionTracing";
import type {
  PosLocalSyncExpenseRecordedPayload,
  PosLocalSyncEventStatus,
  PosLocalSyncEventType,
  PosLocalSyncPaymentPayload,
  PosLocalSyncPendingCheckoutItemDefinedPayload,
  PosLocalSyncPayloadByEventType,
  PosLocalSyncRegisterClosedPayload,
  PosLocalSyncRegisterOpenedPayload,
  PosLocalSyncRegisterReopenedPayload,
  PosLocalSyncSaleClearedPayload,
  PosLocalSyncSaleCompletedPayload,
  PosLocalSyncSaleItemPayload,
  PosLocalSyncServiceLinePayload,
} from "../../../../shared/posLocalSyncContract";
import type { RegisterSessionCloseoutHold } from "./registerSessionCloseoutHolds";
import type { ReportingIngressArgs } from "../../../reporting/ingress";
import type { CommerceInventoryEffectArgs } from "../../../reporting/inventory/commerceEffects";
import type { CommandResult } from "../../../../shared/commandResult";

export type { PosLocalSyncEventStatus, PosLocalSyncEventType };

export type PosLocalSyncConflictType =
  "duplicate_local_id" | "inventory" | "payment" | "permission";

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
  | "inventoryReviewWorkItem"
  | "closeout"
  | "expenseSession"
  | "expenseTransaction";

export type PosLocalPaymentInput = PosLocalSyncPaymentPayload;

export type PosLocalSaleItemInput = Omit<
  PosLocalSyncSaleItemPayload,
  "pendingCheckoutItemId" | "productId" | "productSkuId"
> & {
  productId: Id<"product"> | string;
  productSkuId: Id<"productSku"> | string;
  pendingCheckoutItemId?: Id<"posPendingCheckoutItem"> | string;
};

export type PosLocalServiceLineInput = Omit<
  PosLocalSyncServiceLinePayload,
  "customerProfileId" | "existingServiceCaseId" | "serviceCatalogId"
> & {
  existingServiceCaseId?: Id<"serviceCase">;
  serviceCatalogId: Id<"serviceCatalog">;
  customerProfileId?: Id<"customerProfile">;
};

export type PosLocalPendingCheckoutItemDefinedPayload =
  PosLocalSyncPendingCheckoutItemDefinedPayload;

export type PosLocalSalePayload = Omit<
  PosLocalSyncSaleCompletedPayload,
  "customerProfileId" | "items" | "payments" | "serviceLines"
> & {
  customerProfileId?: Id<"customerProfile">;
  items: PosLocalSaleItemInput[];
  serviceLines?: PosLocalServiceLineInput[];
  payments: PosLocalPaymentInput[];
};

export type PosLocalRegisterOpenedPayload =
  PosLocalSyncRegisterOpenedPayload;

export type PosLocalRegisterClosedPayload =
  PosLocalSyncRegisterClosedPayload;

export type PosLocalSaleClearedPayload = PosLocalSyncSaleClearedPayload;

export type PosLocalRegisterReopenedPayload =
  PosLocalSyncRegisterReopenedPayload;

export type PosLocalExpenseRecordedPayload = Omit<
  PosLocalSyncExpenseRecordedPayload,
  "items"
> & {
  items: PosLocalSaleItemInput[];
};

export type PosLocalSyncEventInput = {
  syncScope?: "pos" | "expense";
  localEventId: string;
  localRegisterSessionId?: string;
  localExpenseSessionId?: string;
  sequence: number;
  eventType: PosLocalSyncEventType;
  occurredAt: number;
  staffProfileId: Id<"staffProfile">;
  staffProofToken?: string;
  payload: Record<string, unknown>;
};

type ConvexPosLocalSyncPayloadByEventType = Omit<
  PosLocalSyncPayloadByEventType,
  "expense_recorded" | "sale_completed"
> & {
  sale_completed: PosLocalSalePayload;
  expense_recorded: PosLocalExpenseRecordedPayload;
};

type ParsedPosLocalSyncPosEventBase<
  EventType extends Exclude<PosLocalSyncEventType, "expense_recorded">,
> = Omit<
  PosLocalSyncEventInput,
  "eventType" | "payload" | "syncScope" | "localRegisterSessionId"
> & {
  syncScope?: "pos";
  localRegisterSessionId: string;
  eventType: EventType;
  payload: ConvexPosLocalSyncPayloadByEventType[EventType];
};

type ParsedPosLocalSyncExpenseEventBase<
  EventType extends "expense_recorded",
> = Omit<
  PosLocalSyncEventInput,
  "eventType" | "payload" | "syncScope" | "localExpenseSessionId"
> & {
  syncScope: "expense";
  localExpenseSessionId: string;
  eventType: EventType;
  payload: ConvexPosLocalSyncPayloadByEventType[EventType];
};

export type ParsedPosLocalSyncEventInput =
  | {
      [EventType in Exclude<PosLocalSyncEventType, "expense_recorded">]:
        ParsedPosLocalSyncPosEventBase<EventType>;
    }[Exclude<PosLocalSyncEventType, "expense_recorded">]
  | ParsedPosLocalSyncExpenseEventBase<"expense_recorded">;

export type LocalSyncEventRecord = {
  _id: string;
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
  syncScope?: "pos" | "expense";
  localEventId: string;
  localRegisterSessionId: string;
  localExpenseSessionId?: string;
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
  // U9: server-derived clock attribution (see posLocalSyncEvent schema). Stored
  // once at first ingest; excluded from `isSameLocalEvent` so it is retry-safe.
  serverOccurredAt?: number;
  serverOperatingDate?: string;
  clockObservation?: {
    serverTimeAt: number;
    occurredAtStatus: "in_bounds" | "future_skew_clamped";
    operatingDateStatus?:
      | "terminal_matched"
      | "server_corrected"
      | "missing_timezone_authority";
    terminalOperatingDate?: string;
  };
};

type LocalSyncMappingRecordBase = {
  _id: string;
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
  syncScope?: "pos" | "expense";
  localRegisterSessionId: string;
  localExpenseSessionId?: string;
  localEventId: string;
  sourceEventType?: PosLocalSyncEventType | "repair";
  localId: string;
  createdAt: number;
};

export type LocalSyncMappingRecord = LocalSyncMappingRecordBase & {
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
  resolvedByUserId?: Id<"athenaUser">;
};

export type LocalSyncRegisterReviewConflictFact = {
  conflict: LocalSyncConflictRecord;
  directRegisterSession: Pick<
    Doc<"registerSession">,
    "_id" | "storeId" | "terminalId"
  > | null;
  registerSessionMapping: LocalSyncMappingRecord | null;
};

export type LocalSyncCursorRecord = {
  _id: string;
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
  syncScope?: "pos" | "expense";
  localSyncCursorId?: string;
  localRegisterSessionId: string;
  localExpenseSessionId?: string;
  acceptedThroughSequence: number;
  updatedAt: number;
};

export type LocalSyncCursorIdentity = {
  syncScope: "pos" | "expense";
  localSyncCursorId: string;
  localRegisterSessionId?: string;
  localExpenseSessionId?: string;
};

export type PosSyncOperationalRole = "cashier" | "manager";

export type PosSyncWorkflowTraceResult = {
  traceCreated: boolean;
  traceId: string;
};

export type SyncProjectionRepository = {
  appendReportingIngress?(input: ReportingIngressArgs): Promise<unknown>;
  getTerminal(
    terminalId: Id<"posTerminal">,
  ): Promise<Doc<"posTerminal"> | null>;
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
  startStoreDayFromLocalSync?(input: {
    actorStaffProfileId: Id<"staffProfile">;
    endAt: number;
    operatingDate: string;
    startAt: number;
    storeId: Id<"store">;
  }): Promise<
    CommandResult<{
      action: "started" | "already_started";
      dailyOpeningId: Id<"dailyOpening">;
    }>
  >;
  getRegisterSession(
    registerSessionId: Id<"registerSession">,
  ): Promise<Doc<"registerSession"> | null>;
  listCloseoutHoldsForRegisterSession?(args: {
    registerSessionId: Id<"registerSession">;
    storeId: Id<"store">;
  }): Promise<RegisterSessionCloseoutHold[]>;
  getCustomerProfile(
    customerProfileId: Id<"customerProfile">,
  ): Promise<Doc<"customerProfile"> | null>;
  getProduct(productId: Id<"product">): Promise<Doc<"product"> | null>;
  getProductSku(
    productSkuId: Id<"productSku">,
  ): Promise<Doc<"productSku"> | null>;
  getPendingCheckoutItem(
    pendingCheckoutItemId: Id<"posPendingCheckoutItem">,
  ): Promise<Doc<"posPendingCheckoutItem"> | null>;
  getInventoryImportProvisionalSku(
    inventoryImportProvisionalSkuId: string,
  ): Promise<{
    _id: string;
    storeId: Id<"store">;
    status: "active" | "finalized" | "rejected" | "closed";
    posExposureStatus?: "available" | "hidden";
    productId: Id<"product">;
    productSkuId: Id<"productSku">;
    importedBarcode?: string;
    importedPrice: number;
    finalizedAt?: number;
    closedAt?: number;
  } | null>;
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
  createMapping(
    input: LocalSyncMappingRecordInput,
  ): Promise<LocalSyncMappingRecord>;
  markRegisterSessionMappingAmbiguous?(args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    localRegisterSessionId: string;
  }): Promise<void>;
  markRegisterSessionMappingMapped?(args: {
    cloudRegisterSessionId: string;
    localRegisterSessionId: string;
    mappingId: Id<"posLocalSyncMapping">;
    sourceEventType?: string;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  }): Promise<void>;
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
  listOpenRegisterReviewConflictFacts(args: {
    registerSessionId: Id<"registerSession">;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  }): Promise<LocalSyncRegisterReviewConflictFact[]>;
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
  getApprovalRequest(
    approvalRequestId: Id<"approvalRequest">,
  ): Promise<Doc<"approvalRequest"> | null>;
  createOrReuseRegisterSessionVarianceReview(input: {
    closeoutOccurredAt: number;
    countedCash: number;
    expectedCash: number;
    gateDecisionReason?: string;
    localEventId: string;
    localRegisterSessionId?: string;
    notes?: string;
    organizationId?: Id<"organization">;
    registerNumber?: string;
    registerSessionId: Id<"registerSession">;
    requestedByStaffProfileId?: Id<"staffProfile">;
    requestedByUserId?: Id<"athenaUser">;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    variance: number;
  }): Promise<
    | {
        approvalRequest: Doc<"approvalRequest">;
        created: boolean;
        status: "ready";
      }
    | {
        details: Record<string, unknown>;
        status: "conflict";
        summary: string;
      }
  >;
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
    inventoryImportProvisionalSkuId?: string;
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
    createdByUserId?: Id<"athenaUser">;
    createdByStaffProfileId?: Id<"staffProfile">;
    customerProfileId?: Id<"customerProfile">;
    productId?: Id<"product">;
    productSkuId?: Id<"productSku">;
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
  syncServiceCaseFinancials(serviceCaseId: Id<"serviceCase">): Promise<void>;
  createTransaction(input: {
    localSyncEventId: Id<"posLocalSyncEvent">;
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
    inventoryImportProvisionalSkuId?: string;
    productName: string;
    productSku: string;
    barcode?: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    image?: string;
  }): Promise<Id<"posTransactionItem">>;
  getExpenseSessionByLocalId(args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    localExpenseSessionId: string;
  }): Promise<Doc<"expenseSession"> | null>;
  createExpenseSession(input: {
    localExpenseSessionId?: string;
    sessionNumber: string;
    storeId: Id<"store">;
    staffProfileId: Id<"staffProfile">;
    registerNumber?: string;
    terminalId: Id<"posTerminal">;
    createdAt: number;
    updatedAt: number;
    expiresAt: number;
    completedAt?: number;
    notes?: string;
  }): Promise<Id<"expenseSession">>;
  createExpenseSessionItem(input: {
    sessionId: Id<"expenseSession">;
    storeId: Id<"store">;
    productId: Id<"product">;
    productSkuId: Id<"productSku">;
    pendingCheckoutItemId?: Id<"posPendingCheckoutItem">;
    inventoryImportProvisionalSkuId?: Id<"inventoryImportProvisionalSku">;
    inventoryHoldApplied?: boolean;
    productSku: string;
    barcode?: string;
    productName: string;
    price: number;
    quantity: number;
    image?: string;
    size?: string;
    length?: number;
    color?: string;
    createdAt: number;
    updatedAt: number;
  }): Promise<Id<"expenseSessionItem">>;
  createExpenseTransaction(input: {
    transactionNumber: string;
    storeId: Id<"store">;
    sessionId: Id<"expenseSession">;
    staffProfileId: Id<"staffProfile">;
    registerNumber?: string;
    totalValue: number;
    completedAt: number;
    notes?: string;
  }): Promise<Id<"expenseTransaction">>;
  createExpenseTransactionItem(input: {
    transactionId: Id<"expenseTransaction">;
    productId: Id<"product">;
    productSkuId: Id<"productSku">;
    pendingCheckoutItemId?: Id<"posPendingCheckoutItem">;
    inventoryImportProvisionalSkuId?: Id<"inventoryImportProvisionalSku">;
    inventoryHoldApplied?: boolean;
    productName: string;
    productSku: string;
    quantity: number;
    costPrice: number;
    image?: string;
    size?: string;
    length?: number;
    color?: string;
  }): Promise<Id<"expenseTransactionItem">>;
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
  recordInventoryImportProvisionalSkuSaleEvidence(input: {
    inventoryImportProvisionalSkuId: string;
    quantitySold: number;
    posTransactionId: Id<"posTransaction">;
    registerSessionId?: Id<"registerSession">;
    timestamp: number;
  }): Promise<void>;
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
  applyCommerceInventoryEffect?(
    input: CommerceInventoryEffectArgs,
  ): Promise<"conflict" | "inserted" | "existing">;
  flushCatalogSummaryRefreshes?(): Promise<void>;
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
    occurrenceAt: number;
    recordedAt: number;
    transactionNumber: string;
  }): Promise<"conflict" | "inserted" | "existing">;
  getReportingInventoryEffectByBusinessEventKey?(input: {
    businessEventKey: string;
    sourceDomain: "pos";
    storeId: Id<"store">;
  }): Promise<Doc<"reportingInventoryEffect"> | null>;
  patchPosSession(
    posSessionId: Id<"posSession">,
    patch: Partial<Omit<Doc<"posSession">, "_id" | "_creationTime">>,
  ): Promise<void>;
  createPaymentAllocation(input: {
    storeId: Id<"store">;
    businessEventKey: string;
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
    actorUserId?: Id<"athenaUser">;
    actorStaffProfileId?: Id<"staffProfile">;
    registerSessionId?: Id<"registerSession">;
    terminalId?: Id<"posTerminal">;
    localEventId?: string;
    approvalRequestId?: Id<"approvalRequest">;
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
    cashDelta?: number;
    countedCash?: number;
    paymentCount?: number;
    paymentMethodLabels?: string[];
    reason?: string;
    saleTotal?: number;
    syncOrigin?: "online" | "local_sync";
    transactionId?: Id<"posTransaction">;
    transactionNumber?: string;
    variance?: number;
  }): Promise<PosSyncWorkflowTraceResult>;
};

export type LocalSyncIngestionRepository = {
  getTerminal(
    terminalId: Id<"posTerminal">,
  ): Promise<Doc<"posTerminal"> | null>;
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
    cursor: LocalSyncCursorIdentity;
  }): Promise<number>;
  updateAcceptedThroughSequence(args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    cursor: LocalSyncCursorIdentity;
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

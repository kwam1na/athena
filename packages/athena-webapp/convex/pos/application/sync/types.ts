import type { Doc, Id, TableNames } from "../../../_generated/dataModel";
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
  | "transaction"
  | "transactionItem"
  | "payment"
  | "receipt"
  | "closeout";

export type PosLocalPaymentInput = {
  localPaymentId?: string;
  method: string;
  amount: number;
  timestamp: number;
};

export type PosLocalSaleItemInput = {
  localTransactionItemId?: string;
  productId: Id<"product">;
  productSkuId: Id<"productSku">;
  productName: string;
  productSku: string;
  barcode?: string;
  quantity: number;
  unitPrice: number;
  image?: string;
};

export type PosLocalSalePayload = {
  localPosSessionId: string;
  localTransactionId: string;
  localReceiptNumber: string;
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

export type PosLocalRegisterReopenedPayload = {
  reason?: string;
};

export type PosLocalSyncEventInput = Omit<
  PosLocalSyncUploadEvent,
  "payload" | "staffProfileId"
> & {
  staffProfileId: Id<"staffProfile">;
  staffProofToken: string;
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
  | ParsedPosLocalSyncEventBase<"sale_completed", PosLocalSalePayload>
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
    registerSessionId: Id<"registerSession">;
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
    productSku: string;
    productName: string;
    barcode?: string;
    quantity: number;
    price: number;
    image?: string;
    createdAt: number;
    updatedAt: number;
  }): Promise<Id<"posSessionItem">>;
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
    productName: string;
    productSku: string;
    barcode?: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    image?: string;
  }): Promise<Id<"posTransactionItem">>;
  patchProductSku(
    productSkuId: Id<"productSku">,
    patch: Partial<Omit<Doc<"productSku">, "_id" | "_creationTime">>,
  ): Promise<void>;
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
    registerSessionId: Id<"registerSession">;
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

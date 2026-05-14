import type { Id } from "../../../_generated/dataModel";
import { normalizeInStorePayments } from "../../../cashControls/paymentAllocationAttribution";
import type {
  LocalSyncConflictRecord,
  LocalSyncMappingRecord,
  LocalSyncMappingRecordInput,
  LocalSyncMappingProjectionInput,
  ParsedPosLocalSyncEventInput,
  PosLocalSalePayload,
  PosLocalSyncEventType,
  PosLocalSyncMappingKind,
  PosSyncOperationalRole,
  SyncProjectionRepository,
} from "./types";

type ProjectionStatus = "projected" | "conflicted";

type ProjectionResult = {
  status: ProjectionStatus;
  mappings: LocalSyncMappingRecord[];
  conflicts: LocalSyncConflictRecord[];
};

type ProjectEventArgs = {
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
  event: ParsedPosLocalSyncEventInput;
  syncEventId: string;
  submittedByUserId?: Id<"athenaUser">;
  now: number;
};

type SaleCompletedArgs = ProjectEventArgsFor<"sale_completed">;
type SaleClearedArgs = ProjectEventArgsFor<"sale_cleared">;

type StoreRecord = Awaited<ReturnType<SyncProjectionRepository["getStore"]>>;
type TerminalRecord = Awaited<
  ReturnType<SyncProjectionRepository["getTerminal"]>
>;
type RegisterSessionRecord = NonNullable<
  Awaited<ReturnType<SyncProjectionRepository["getRegisterSessionByLocalId"]>>
>;
type PosSessionRecord = Awaited<
  ReturnType<SyncProjectionRepository["getPosSessionByLocalId"]>
>;

type CanonicalSaleItem = {
  barcode?: string;
  image?: string;
  productName: string;
  productSku: string;
};

type SaleValidationContext = {
  payload: PosLocalSalePayload;
  store: StoreRecord;
  terminal: TerminalRecord;
  catalogValidation: {
    conflict: LocalSyncConflictRecord | null;
    itemsByLocalId: Map<string, CanonicalSaleItem>;
  };
};

type SaleSessionResolution = {
  registerSession: RegisterSessionRecord;
  existingPosSession: PosSessionRecord;
  existingPosSessionMapping: LocalSyncMappingRecord | null;
  resolvedRegisterNumber: string;
};

type SalePaymentCalculation = {
  changeGiven?: number;
  expectedCashDelta: number;
  paymentConflict: LocalSyncConflictRecord | null;
  primaryPaymentMethod?: string;
  totalPaid: number;
  transactionPayments: PosLocalSalePayload["payments"];
  validPayments: PosLocalSalePayload["payments"];
};

type PersistedSaleSession = {
  posSessionId: Id<"posSession">;
  posSessionMappings: LocalSyncMappingRecord[];
  reusedExistingSession: boolean;
};

type PersistedSale = {
  receiptMapping: LocalSyncMappingRecord;
  transactionId: Id<"posTransaction">;
  transactionMapping: LocalSyncMappingRecord;
};

const POS_USABLE_REGISTER_SESSION_STATUSES = new Set(["open", "active"]);

const INVENTORY_CONFLICT_SUMMARY =
  "Inventory needs manager review for a synced offline sale.";
const PAYMENT_CONFLICT_SUMMARY =
  "Payment needs manager review for a synced offline sale.";
const PERMISSION_DRIFT_SUMMARY =
  "Staff access changed before this POS history synced.";

const POS_SYNC_ALLOWED_ROLES_BY_EVENT = {
  register_opened: ["manager"],
  sale_completed: ["cashier", "manager"],
  sale_cleared: ["cashier", "manager"],
  register_closed: ["cashier", "manager"],
  register_reopened: ["manager"],
} satisfies Record<PosLocalSyncEventType, PosSyncOperationalRole[]>;

export async function projectLocalSyncEvent(
  repository: SyncProjectionRepository,
  args: ProjectEventArgs,
): Promise<ProjectionResult> {
  const permissionConflict = await validateProjectionPermission(
    repository,
    args,
  );
  if (permissionConflict) {
    return {
      status: "conflicted",
      mappings: [],
      conflicts: [permissionConflict],
    };
  }

  if (args.event.eventType === "register_opened") {
    return projectRegisterOpened(
      repository,
      args as ProjectEventArgsFor<"register_opened">,
    );
  }

  if (args.event.eventType === "sale_completed") {
    return projectSaleCompleted(
      repository,
      args as ProjectEventArgsFor<"sale_completed">,
    );
  }

  if (args.event.eventType === "sale_cleared") {
    return projectSaleCleared(
      repository,
      args as ProjectEventArgsFor<"sale_cleared">,
    );
  }

  if (args.event.eventType === "register_closed") {
    return projectRegisterClosed(
      repository,
      args as ProjectEventArgsFor<"register_closed">,
    );
  }

  if (args.event.eventType === "register_reopened") {
    return projectRegisterReopened(
      repository,
      args as ProjectEventArgsFor<"register_reopened">,
    );
  }

  assertNever(args.event);
}

function assertNever(value: never): never {
  throw new Error(`Unsupported POS sync event type: ${JSON.stringify(value)}`);
}

async function validateProjectionPermission(
  repository: SyncProjectionRepository,
  args: ProjectEventArgs,
): Promise<LocalSyncConflictRecord | null> {
  const terminal = await repository.getTerminal(args.terminalId);
  const staff = await repository.getStaffProfile(args.event.staffProfileId);
  const allowedRoles = POS_SYNC_ALLOWED_ROLES_BY_EVENT[args.event.eventType];
  const hasActivePosRole = staff
    ? await repository.hasActivePosRole({
        staffProfileId: args.event.staffProfileId,
        storeId: args.storeId,
        allowedRoles,
      })
    : false;
  const hasTerminalAccess =
    terminal?.storeId === args.storeId && terminal.status === "active";
  const hasValidStaffProof = args.event.staffProofToken
    ? await repository.validateLocalStaffProof({
        staffProfileId: args.event.staffProfileId,
        storeId: args.storeId,
        terminalId: args.terminalId,
        token: args.event.staffProofToken,
        now: args.now,
      })
    : false;
  const hasTerminalStaffProof =
    Boolean(staff) &&
    staff?.storeId === args.storeId &&
    staff?.status === "active" &&
    hasActivePosRole &&
    hasTerminalAccess &&
    hasValidStaffProof;
  const requiresManagerProof =
    args.event.eventType === "register_reopened" &&
    allowedRoles.length === 1 &&
    allowedRoles[0] === "manager";
  const canProjectManagerOnlyOfflineEvent = !requiresManagerProof;

  if (hasTerminalStaffProof && canProjectManagerOnlyOfflineEvent) {
    return null;
  }

  const hasActiveCashierOrManagerRole =
    args.event.eventType === "register_opened" && staff
      ? await repository.hasActivePosRole({
          staffProfileId: args.event.staffProfileId,
          storeId: args.storeId,
          allowedRoles: ["cashier", "manager"],
        })
      : false;
  const hasTerminalCashierOrManagerProof =
    Boolean(staff) &&
    staff?.storeId === args.storeId &&
    staff?.status === "active" &&
    hasActiveCashierOrManagerRole &&
    hasTerminalAccess &&
    hasValidStaffProof;
  if (
    hasTerminalCashierOrManagerProof &&
    args.event.eventType === "register_opened" &&
    (await canMapExistingCloudRegisterSession(
      repository,
      args as ProjectEventArgsFor<"register_opened">,
    ))
  ) {
    return null;
  }

  return createConflict(repository, args, {
    conflictType: "permission",
    summary: PERMISSION_DRIFT_SUMMARY,
    details: {
      staffProfileId: args.event.staffProfileId,
      eventType: args.event.eventType,
      hasStaffProof: Boolean(args.event.staffProofToken),
      ...(requiresManagerProof
        ? {
            reason:
              "Manager-only offline POS events require server-side review before projection.",
          }
        : {}),
    },
  });
}

async function canMapExistingCloudRegisterSession(
  repository: SyncProjectionRepository,
  args: ProjectEventArgsFor<"register_opened">,
) {
  const directRegisterSessionId = repository.normalizeCloudId(
    "registerSession",
    args.event.localRegisterSessionId,
  );
  if (!directRegisterSessionId) {
    return false;
  }

  const registerSession = await repository.getRegisterSession(
    directRegisterSessionId,
  );
  return Boolean(
    registerSession &&
      registerSession.storeId === args.storeId &&
      registerSession.terminalId === args.terminalId &&
      isPosUsableRegisterSession(registerSession),
  );
}

type ProjectEventArgsFor<EventType extends PosLocalSyncEventType> = Omit<
  ProjectEventArgs,
  "event"
> & {
  event: Extract<ParsedPosLocalSyncEventInput, { eventType: EventType }>;
};

async function projectRegisterOpened(
  repository: SyncProjectionRepository,
  args: ProjectEventArgsFor<"register_opened">,
): Promise<ProjectionResult> {
  const existing = await findMapping(repository, args, {
    localIdKind: "registerSession",
    localId: args.event.localRegisterSessionId,
  });
  if (existing) {
    return { status: "projected", mappings: [existing], conflicts: [] };
  }

  const store = await repository.getStore(args.storeId);
  const terminal = await repository.getTerminal(args.terminalId);
  const directRegisterSessionId = repository.normalizeCloudId(
    "registerSession",
    args.event.localRegisterSessionId,
  );
  if (directRegisterSessionId) {
    const registerSession = await repository.getRegisterSession(
      directRegisterSessionId,
    );
    if (
      registerSession &&
      registerSession.storeId === args.storeId &&
      registerSession.terminalId === args.terminalId &&
      isPosUsableRegisterSession(registerSession)
    ) {
      const mapping = await createMapping(repository, args, {
        localIdKind: "registerSession",
        localId: args.event.localRegisterSessionId,
        cloudTable: "registerSession",
        cloudId: registerSession._id,
      });
      return { status: "projected", mappings: [mapping], conflicts: [] };
    }
  }
  const payload = args.event.payload;
  const terminalRegisterNumber = normalizeOptionalString(
    terminal?.registerNumber,
  );
  const payloadRegisterNumber = normalizeOptionalString(payload.registerNumber);
  if (
    !terminal ||
    terminal.storeId !== args.storeId ||
    terminal.status !== "active" ||
    !terminalRegisterNumber ||
    (payloadRegisterNumber && payloadRegisterNumber !== terminalRegisterNumber)
  ) {
    const conflict = await createConflict(repository, args, {
      conflictType: "permission",
      summary:
        "Terminal register assignment does not match synced POS history.",
      details: {
        localRegisterSessionId: args.event.localRegisterSessionId,
        payloadRegisterNumber,
        terminalRegisterNumber,
      },
    });
    return { status: "conflicted", mappings: [], conflicts: [conflict] };
  }

  const blockingRegisterSession = await repository.findBlockingRegisterSession({
    storeId: args.storeId,
    terminalId: args.terminalId,
    registerNumber: terminalRegisterNumber,
  });
  if (blockingRegisterSession) {
    const conflict = await createConflict(repository, args, {
      conflictType: "permission",
      summary: "A register session is already open for this terminal.",
      details: {
        blockingRegisterSessionId: blockingRegisterSession._id,
        localRegisterSessionId: args.event.localRegisterSessionId,
        registerNumber: terminalRegisterNumber,
      },
    });
    return { status: "conflicted", mappings: [], conflicts: [conflict] };
  }

  const openingFloat = payload.openingFloat ?? 0;
  const registerSessionId = await repository.createRegisterSession({
    storeId: args.storeId,
    organizationId: store?.organizationId,
    terminalId: args.terminalId,
    registerNumber: terminalRegisterNumber,
    openedByStaffProfileId: args.event.staffProfileId,
    openedAt: args.event.occurredAt,
    openingFloat,
    expectedCash: openingFloat,
    notes: payload.notes,
  });
  const mapping = await createMapping(repository, args, {
    localIdKind: "registerSession",
    localId: args.event.localRegisterSessionId,
    cloudTable: "registerSession",
    cloudId: registerSessionId,
  });

  await repository.createOperationalEvent({
    storeId: args.storeId,
    organizationId: store?.organizationId,
    eventType: "pos_local_sync.register_opened",
    subjectType: "registerSession",
    subjectId: registerSessionId,
    message: "Offline POS register opened.",
    createdAt: args.event.occurredAt,
    actorStaffProfileId: args.event.staffProfileId,
    registerSessionId,
  });

  return { status: "projected", mappings: [mapping], conflicts: [] };
}

async function projectSaleCompleted(
  repository: SyncProjectionRepository,
  args: SaleCompletedArgs,
): Promise<ProjectionResult> {
  const existingProjection = await resolveExistingSaleProjection(
    repository,
    args,
  );
  if (existingProjection) {
    return existingProjection;
  }

  const validation = await validateSaleCompletedInputs(repository, args);
  if ("status" in validation) {
    return validation;
  }

  const sessionResolution = await resolveSaleRegisterAndSession(
    repository,
    args,
    validation,
  );
  if ("status" in sessionResolution) {
    return sessionResolution;
  }

  const inventoryConflict = await validateSaleInventory(
    repository,
    args,
    validation.payload,
    sessionResolution.existingPosSession?._id,
  );
  const payments = await calculateSalePayments(
    repository,
    args,
    validation.payload,
  );
  const saleSession = await persistSaleSession(repository, args, {
    payload: validation.payload,
    session: sessionResolution,
  });
  const sale = await persistSaleRecord(repository, args, {
    payments,
    payload: validation.payload,
    saleSession,
    session: sessionResolution,
  });
  const itemMappings = await persistSaleItemsAndInventory(repository, args, {
    catalogItemsByLocalId: validation.catalogValidation.itemsByLocalId,
    payload: validation.payload,
    sale,
    saleSession,
  });
  const paymentMappings = await persistPaymentAllocations(repository, args, {
    payments,
    sale,
    session: sessionResolution,
    store: validation.store,
  });

  await recordSaleProjectedEvent(repository, args, {
    payload: validation.payload,
    sale,
    session: sessionResolution,
    store: validation.store,
  });

  const conflicts: LocalSyncConflictRecord[] = [
    ...(validation.catalogValidation.conflict
      ? [validation.catalogValidation.conflict]
      : []),
    ...(inventoryConflict ? [inventoryConflict] : []),
    ...(payments.paymentConflict ? [payments.paymentConflict] : []),
  ];

  return {
    status: conflicts.length > 0 ? "conflicted" : "projected",
    mappings: [
      ...saleSession.posSessionMappings,
      sale.transactionMapping,
      sale.receiptMapping,
      ...itemMappings,
      ...paymentMappings,
    ],
    conflicts,
  };
}

async function resolveExistingSaleProjection(
  repository: SyncProjectionRepository,
  args: SaleCompletedArgs,
): Promise<ProjectionResult | null> {
  const payload = getSalePayload(args.event);
  const existingTransaction = await findMappingForTerminal(repository, args, {
    localIdKind: "transaction",
    localId: payload.localTransactionId,
  });
  if (!existingTransaction) {
    return null;
  }

  if (existingTransaction.localEventId !== args.event.localEventId) {
    const conflict = await createConflict(repository, args, {
      conflictType: "duplicate_local_id",
      summary: "Local transaction id was reused by a different synced sale.",
      details: {
        localTransactionId: payload.localTransactionId,
        originalLocalEventId: existingTransaction.localEventId,
      },
    });
    return { status: "conflicted", mappings: [], conflicts: [conflict] };
  }

  return {
    status: "projected",
    mappings: await collectExistingSaleMappings(repository, args),
    conflicts: [],
  };
}

async function validateSaleCompletedInputs(
  repository: SyncProjectionRepository,
  args: SaleCompletedArgs,
): Promise<SaleValidationContext | ProjectionResult> {
  const payload = getSalePayload(args.event);
  const store = await repository.getStore(args.storeId);
  const terminal = await repository.getTerminal(args.terminalId);

  const customerReferenceConflict = await validateSaleCustomerReference(
    repository,
    args,
    payload,
  );
  if (customerReferenceConflict) {
    return conflictResult(customerReferenceConflict);
  }

  const localIdConflict = await validateSaleLocalIds(repository, args, payload);
  if (localIdConflict) {
    return conflictResult(localIdConflict);
  }

  const catalogValidation = await validateSaleCatalogReferences(
    repository,
    args,
    payload,
  );
  if (catalogValidation.conflict?.details.blocksProjection === true) {
    return conflictResult(catalogValidation.conflict);
  }

  return { payload, store, terminal, catalogValidation };
}

async function resolveSaleRegisterAndSession(
  repository: SyncProjectionRepository,
  args: SaleCompletedArgs,
  validation: SaleValidationContext,
): Promise<SaleSessionResolution | ProjectionResult> {
  const { payload, terminal } = validation;
  const registerSession = await repository.getRegisterSessionByLocalId({
    storeId: args.storeId,
    terminalId: args.terminalId,
    localRegisterSessionId: args.event.localRegisterSessionId,
  });

  if (!registerSession) {
    const conflict = await createConflict(repository, args, {
      conflictType: "permission",
      summary: "Register session mapping is missing for synced POS history.",
      details: {
        localRegisterSessionId: args.event.localRegisterSessionId,
      },
    });
    return conflictResult(conflict);
  }

  if (!isPosUsableRegisterSession(registerSession)) {
    const conflict = await createConflict(repository, args, {
      conflictType: "permission",
      summary: "Register was not open before this sale synced.",
      details: {
        localRegisterSessionId: args.event.localRegisterSessionId,
        localTransactionId: payload.localTransactionId,
        status: registerSession.status,
      },
    });
    return conflictResult(conflict);
  }

  const existingPosSessionMapping = await findMapping(repository, args, {
    localIdKind: "posSession",
    localId: payload.localPosSessionId,
  });
  const existingPosSession = await repository.getPosSessionByLocalId({
    storeId: args.storeId,
    terminalId: args.terminalId,
    localRegisterSessionId: args.event.localRegisterSessionId,
    localPosSessionId: payload.localPosSessionId,
    registerSessionId: registerSession._id,
  });

  if (
    !existingPosSession &&
    repository.normalizeCloudId("posSession", payload.localPosSessionId)
  ) {
    const conflict = await createConflict(repository, args, {
      conflictType: "permission",
      summary: "POS session does not belong to this synced register history.",
      details: {
        localPosSessionId: payload.localPosSessionId,
        localRegisterSessionId: args.event.localRegisterSessionId,
      },
    });
    return conflictResult(conflict);
  }

  if (
    existingPosSession &&
    existingPosSession.staffProfileId !== args.event.staffProfileId
  ) {
    const conflict = await createConflict(repository, args, {
      conflictType: "permission",
      summary: "POS session does not belong to the synced staff proof.",
      details: {
        localPosSessionId: payload.localPosSessionId,
        localTransactionId: payload.localTransactionId,
        posSessionStaffProfileId: existingPosSession.staffProfileId,
        eventStaffProfileId: args.event.staffProfileId,
      },
    });
    return conflictResult(conflict);
  }

  if (existingPosSession?.status === "void") {
    const conflict = await createConflict(repository, args, {
      conflictType: "permission",
      summary: "Cleared POS sessions cannot be completed from synced local history.",
      details: {
        localPosSessionId: payload.localPosSessionId,
        localTransactionId: payload.localTransactionId,
        posSessionId: existingPosSession._id,
        status: existingPosSession.status,
      },
    });
    return conflictResult(conflict);
  }

  if (existingPosSession?.transactionId) {
    const conflict = await createConflict(repository, args, {
      conflictType: "duplicate_local_id",
      summary: "Local POS session id was reused by a different synced sale.",
      details: {
        localIdKind: "posSession",
        localId: payload.localPosSessionId,
        localTransactionId: payload.localTransactionId,
        originalTransactionId: existingPosSession.transactionId,
      },
    });
    return conflictResult(conflict);
  }

  const terminalRegisterNumber = normalizeOptionalString(
    terminal?.registerNumber,
  );
  const payloadRegisterNumber = normalizeOptionalString(payload.registerNumber);
  const registerSessionNumber = normalizeOptionalString(
    registerSession.registerNumber,
  );
  const resolvedRegisterNumber =
    registerSessionNumber ?? terminalRegisterNumber;

  if (
    !terminal ||
    terminal.storeId !== args.storeId ||
    terminal.status !== "active" ||
    !resolvedRegisterNumber ||
    (terminalRegisterNumber &&
      terminalRegisterNumber !== resolvedRegisterNumber) ||
    (payloadRegisterNumber && payloadRegisterNumber !== resolvedRegisterNumber)
  ) {
    const conflict = await createConflict(repository, args, {
      conflictType: "permission",
      summary: "Sale register assignment does not match synced POS history.",
      details: {
        localRegisterSessionId: args.event.localRegisterSessionId,
        localTransactionId: payload.localTransactionId,
        payloadRegisterNumber,
        registerSessionNumber,
        terminalRegisterNumber,
      },
    });
    return conflictResult(conflict);
  }

  return {
    existingPosSession,
    existingPosSessionMapping,
    registerSession,
    resolvedRegisterNumber,
  };
}

async function projectSaleCleared(
  repository: SyncProjectionRepository,
  args: SaleClearedArgs,
): Promise<ProjectionResult> {
  const registerSession = await repository.getRegisterSessionByLocalId({
    storeId: args.storeId,
    terminalId: args.terminalId,
    localRegisterSessionId: args.event.localRegisterSessionId,
  });
  if (!registerSession) {
    const conflict = await createConflict(repository, args, {
      conflictType: "permission",
      summary: "Register session mapping is missing for synced POS history.",
      details: {
        localRegisterSessionId: args.event.localRegisterSessionId,
        localPosSessionId: args.event.payload.localPosSessionId,
      },
    });
    return conflictResult(conflict);
  }

  const existingPosSession = await repository.getPosSessionByLocalId({
    storeId: args.storeId,
    terminalId: args.terminalId,
    localRegisterSessionId: args.event.localRegisterSessionId,
    localPosSessionId: args.event.payload.localPosSessionId,
    registerSessionId: registerSession._id,
  });
  if (!existingPosSession) {
    if (
      repository.normalizeCloudId(
        "posSession",
        args.event.payload.localPosSessionId,
      )
    ) {
      const conflict = await createConflict(repository, args, {
        conflictType: "permission",
        summary: "POS session does not belong to this synced register history.",
        details: {
          localPosSessionId: args.event.payload.localPosSessionId,
          localRegisterSessionId: args.event.localRegisterSessionId,
        },
      });
      return conflictResult(conflict);
    }

    return { status: "projected", mappings: [], conflicts: [] };
  }

  if (existingPosSession.staffProfileId !== args.event.staffProfileId) {
    const conflict = await createConflict(repository, args, {
      conflictType: "permission",
      summary: "POS session does not belong to the synced staff proof.",
      details: {
        localPosSessionId: args.event.payload.localPosSessionId,
        posSessionStaffProfileId: existingPosSession.staffProfileId,
        eventStaffProfileId: args.event.staffProfileId,
      },
    });
    return conflictResult(conflict);
  }

  if (
    existingPosSession.transactionId ||
    existingPosSession.status === "completed"
  ) {
    const conflict = await createConflict(repository, args, {
      conflictType: "permission",
      summary: "Completed POS sessions cannot be cleared from synced local history.",
      details: {
        localPosSessionId: args.event.payload.localPosSessionId,
        posSessionId: existingPosSession._id,
        status: existingPosSession.status,
        transactionId: existingPosSession.transactionId,
      },
    });
    return conflictResult(conflict);
  }

  const existingPosSessionMapping = await findMapping(repository, args, {
    localIdKind: "posSession",
    localId: args.event.payload.localPosSessionId,
  });
  if (existingPosSessionMapping) {
    return {
      status: "projected",
      mappings: [existingPosSessionMapping],
      conflicts: [],
    };
  }

  await repository.releaseActiveInventoryHoldsForSession({
    sessionId: existingPosSession._id,
    now: args.event.occurredAt,
  });
  await repository.patchPosSession(existingPosSession._id, {
    notes: args.event.payload.reason,
    status: "void",
    updatedAt: args.event.occurredAt,
  });
  const mapping = await createMapping(repository, args, {
    localIdKind: "posSession",
    localId: args.event.payload.localPosSessionId,
    cloudTable: "posSession",
    cloudId: existingPosSession._id,
  });

  return { status: "projected", mappings: [mapping], conflicts: [] };
}

async function calculateSalePayments(
  repository: SyncProjectionRepository,
  args: SaleCompletedArgs,
  payload: PosLocalSalePayload,
): Promise<SalePaymentCalculation> {
  const validPayments = payload.payments.filter(isValidPayment);
  const totalPaid = validPayments.reduce(
    (sum, payment) => sum + Math.max(0, payment.amount),
    0,
  );
  const nonCashPaid = validPayments
    .filter((payment) => payment.method !== "cash")
    .reduce((sum, payment) => sum + payment.amount, 0);
  const paymentConflict =
    validPayments.length !== payload.payments.length ||
    totalPaid < payload.totals.total ||
    nonCashPaid > payload.totals.total
      ? await createConflict(repository, args, {
          conflictType: "payment",
          summary: PAYMENT_CONFLICT_SUMMARY,
          details: {
            localTransactionId: payload.localTransactionId,
            localReceiptNumber: payload.localReceiptNumber,
            totalPaid,
            total: payload.totals.total,
          },
        })
      : null;
  const changeGiven =
    totalPaid > payload.totals.total
      ? totalPaid - payload.totals.total
      : undefined;
  const cashCollected = validPayments
    .filter((payment) => payment.method === "cash")
    .reduce((sum, payment) => sum + payment.amount, 0);

  return {
    changeGiven,
    expectedCashDelta: Math.max(0, cashCollected - (changeGiven ?? 0)),
    paymentConflict,
    primaryPaymentMethod: validPayments[0]?.method,
    totalPaid,
    transactionPayments: validPayments.map(({ method, amount, timestamp }) => ({
      method,
      amount,
      timestamp,
    })),
    validPayments,
  };
}

async function persistSaleSession(
  repository: SyncProjectionRepository,
  args: SaleCompletedArgs,
  input: {
    payload: PosLocalSalePayload;
    session: SaleSessionResolution;
  },
): Promise<PersistedSaleSession> {
  const { payload, session } = input;
  const posSessionId =
    session.existingPosSession?._id ??
    (await repository.createPosSession({
      localPosSessionId: payload.localPosSessionId,
      sessionNumber: payload.localPosSessionId,
      storeId: args.storeId,
      staffProfileId: args.event.staffProfileId,
      registerNumber: session.resolvedRegisterNumber,
      registerSessionId: session.registerSession._id,
      terminalId: args.terminalId,
      createdAt: args.event.occurredAt,
      updatedAt: args.event.occurredAt,
    }));
  const posSessionMapping =
    session.existingPosSessionMapping ??
    (await createMapping(repository, args, {
      localIdKind: "posSession",
      localId: payload.localPosSessionId,
      cloudTable: "posSession",
      cloudId: posSessionId,
    }));

  return {
    posSessionId,
    posSessionMappings: session.existingPosSessionMapping
      ? []
      : [posSessionMapping],
    reusedExistingSession: Boolean(session.existingPosSession),
  };
}

async function persistSaleRecord(
  repository: SyncProjectionRepository,
  args: SaleCompletedArgs,
  input: {
    payments: SalePaymentCalculation;
    payload: PosLocalSalePayload;
    saleSession: PersistedSaleSession;
    session: SaleSessionResolution;
  },
): Promise<PersistedSale> {
  const { payments, payload, saleSession, session } = input;
  const transactionId = await repository.createTransaction({
    transactionNumber: payload.localReceiptNumber,
    storeId: args.storeId,
    sessionId: saleSession.posSessionId,
    registerSessionId: session.registerSession._id,
    staffProfileId: args.event.staffProfileId,
    registerNumber: session.resolvedRegisterNumber,
    terminalId: args.terminalId,
    subtotal: payload.totals.subtotal,
    tax: payload.totals.tax,
    total: payload.totals.total,
    customerProfileId: payload.customerProfileId,
    payments: payments.transactionPayments,
    totalPaid: payments.totalPaid,
    changeGiven: payments.changeGiven,
    paymentMethod: payments.primaryPaymentMethod,
    completedAt: args.event.occurredAt,
    customerInfo: payload.customerInfo,
  });
  await repository.patchPosSession(saleSession.posSessionId, {
    completedAt: args.event.occurredAt,
    customerInfo: payload.customerInfo,
    customerProfileId: payload.customerProfileId,
    payments: payments.transactionPayments,
    status: "completed",
    subtotal: payload.totals.subtotal,
    tax: payload.totals.tax,
    total: payload.totals.total,
    transactionId,
    updatedAt: args.event.occurredAt,
  });

  const transactionMapping = await createMapping(repository, args, {
    localIdKind: "transaction",
    localId: payload.localTransactionId,
    cloudTable: "posTransaction",
    cloudId: transactionId,
  });
  const receiptMapping = await createMapping(repository, args, {
    localIdKind: "receipt",
    localId: payload.localReceiptNumber,
    cloudTable: "posTransaction",
    cloudId: transactionId,
  });

  return { receiptMapping, transactionId, transactionMapping };
}

async function persistSaleItemsAndInventory(
  repository: SyncProjectionRepository,
  args: SaleCompletedArgs,
  input: {
    catalogItemsByLocalId: Map<string, CanonicalSaleItem>;
    payload: PosLocalSalePayload;
    sale: PersistedSale;
    saleSession: PersistedSaleSession;
  },
): Promise<LocalSyncMappingRecord[]> {
  const { catalogItemsByLocalId, payload, sale, saleSession } = input;
  const itemMappings: LocalSyncMappingRecord[] = [];
  const consumedHoldQuantities = saleSession.reusedExistingSession
    ? await repository.consumeInventoryHoldsForSession({
        sessionId: saleSession.posSessionId,
        items: payload.items.map((item) => ({
          productSkuId: item.productSkuId,
          quantity: item.quantity,
        })),
        now: args.event.occurredAt,
      })
    : new Map<Id<"productSku">, number>();

  for (const item of payload.items) {
    const canonicalItem = catalogItemsByLocalId.get(
      item.localTransactionItemId ?? item.productSkuId,
    );
    if (!saleSession.reusedExistingSession) {
      await repository.createPosSessionItem({
        sessionId: saleSession.posSessionId,
        storeId: args.storeId,
        productId: item.productId,
        productSkuId: item.productSkuId,
        productSku: canonicalItem?.productSku ?? item.productSku,
        productName: canonicalItem?.productName ?? item.productName,
        barcode: canonicalItem?.barcode,
        quantity: item.quantity,
        price: item.unitPrice,
        image: canonicalItem?.image,
        createdAt: args.event.occurredAt,
        updatedAt: args.event.occurredAt,
      });
    }
    const transactionItemId = await repository.createTransactionItem({
      transactionId: sale.transactionId,
      productId: item.productId,
      productSkuId: item.productSkuId,
      productName: canonicalItem?.productName ?? item.productName,
      productSku: canonicalItem?.productSku ?? item.productSku,
      barcode: canonicalItem?.barcode,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.quantity * item.unitPrice,
      image: canonicalItem?.image,
    });

    if (item.localTransactionItemId) {
      itemMappings.push(
        await createMapping(repository, args, {
          localIdKind: "transactionItem",
          localId: item.localTransactionItemId,
          cloudTable: "posTransactionItem",
          cloudId: transactionItemId,
        }),
      );
    }
  }

  for (const [productSkuId, requestedQuantity] of collectSaleSkuQuantities(
    payload,
  )) {
    const sku = await repository.getProductSku(productSkuId);
    if (!sku) continue;

    await repository.patchProductSku(productSkuId, {
      inventoryCount: Math.max(0, sku.inventoryCount - requestedQuantity),
      quantityAvailable: Math.max(
        0,
        sku.quantityAvailable - requestedQuantity,
      ),
    });
  }

  return itemMappings;
}

async function persistPaymentAllocations(
  repository: SyncProjectionRepository,
  args: SaleCompletedArgs,
  input: {
    payments: SalePaymentCalculation;
    sale: PersistedSale;
    session: SaleSessionResolution;
    store: StoreRecord;
  },
): Promise<LocalSyncMappingRecord[]> {
  const { payments, sale, session, store } = input;
  const paymentMappings: LocalSyncMappingRecord[] = [];

  for (const payment of normalizeLocalSalePayments({
    changeGiven: payments.changeGiven,
    payments: payments.validPayments,
  })) {
    const allocationId = await repository.createPaymentAllocation({
      storeId: args.storeId,
      organizationId: store?.organizationId,
      targetType: "pos_transaction",
      targetId: sale.transactionId,
      allocationType: "retail_sale",
      direction: "in",
      method: payment.method,
      amount: payment.amount,
      status: "recorded",
      collectedInStore: true,
      recordedAt: payment.timestamp,
      actorStaffProfileId: args.event.staffProfileId,
      registerSessionId: session.registerSession._id,
      posTransactionId: sale.transactionId,
      externalReference: payment.localPaymentId,
      notes: "Synced from offline POS sale.",
    });

    if (payment.localPaymentId) {
      paymentMappings.push(
        await createMapping(repository, args, {
          localIdKind: "payment",
          localId: payment.localPaymentId,
          cloudTable: "paymentAllocation",
          cloudId: allocationId,
        }),
      );
    }
  }

  if (payments.expectedCashDelta > 0) {
    await repository.patchRegisterSession(session.registerSession._id, {
      expectedCash:
        session.registerSession.expectedCash + payments.expectedCashDelta,
    });
  }

  return paymentMappings;
}

function recordSaleProjectedEvent(
  repository: SyncProjectionRepository,
  args: SaleCompletedArgs,
  input: {
    payload: PosLocalSalePayload;
    sale: PersistedSale;
    session: SaleSessionResolution;
    store: StoreRecord;
  },
) {
  return repository.createOperationalEvent({
    storeId: args.storeId,
    organizationId: input.store?.organizationId,
    eventType: "pos_local_sync.sale_projected",
    subjectType: "posTransaction",
    subjectId: input.sale.transactionId,
    message: "Offline POS sale synced.",
    metadata: {
      localEventId: args.event.localEventId,
      localReceiptNumber: input.payload.localReceiptNumber,
    },
    createdAt: args.event.occurredAt,
    actorStaffProfileId: args.event.staffProfileId,
    registerSessionId: input.session.registerSession._id,
    posTransactionId: input.sale.transactionId,
  });
}

function conflictResult(conflict: LocalSyncConflictRecord): ProjectionResult {
  return { status: "conflicted", mappings: [], conflicts: [conflict] };
}

async function validateSaleInventory(
  repository: SyncProjectionRepository,
  args: ProjectEventArgs,
  payload: PosLocalSalePayload,
  excludeSessionId?: Id<"posSession">,
) {
  const existingSessionHoldQuantities = excludeSessionId
    ? await repository.readActiveInventoryHoldQuantitiesForSession({
        sessionId: excludeSessionId,
        now: args.event.occurredAt,
      })
    : null;

  for (const [productSkuId, requestedQuantity] of collectSaleSkuQuantities(
    payload,
  )) {
    const item = payload.items.find(
      (candidate) => candidate.productSkuId === productSkuId,
    );
    const sku = await repository.getProductSku(productSkuId);
    const heldQuantity = sku
      ? await repository.getActiveHeldQuantity({
          excludeSessionId,
          productSkuId,
          storeId: args.storeId,
          now: args.now,
        })
      : 0;
    const quantityAvailableAfterHolds = Math.max(
      0,
      (sku?.quantityAvailable ?? 0) - heldQuantity,
    );

    if (
      !sku ||
      sku.storeId !== args.storeId ||
      (item && sku.productId !== item.productId) ||
      sku.inventoryCount < requestedQuantity ||
      quantityAvailableAfterHolds < requestedQuantity
    ) {
      return createConflict(repository, args, {
        conflictType: "inventory",
        summary: INVENTORY_CONFLICT_SUMMARY,
        details: {
          localTransactionId: payload.localTransactionId,
          productSkuId,
          requestedQuantity,
          activeHeldQuantity: heldQuantity,
          availableInventoryCount: sku?.inventoryCount ?? null,
          quantityAvailable: sku?.quantityAvailable ?? null,
          quantityAvailableAfterHolds,
        },
      });
    }

    if (existingSessionHoldQuantities) {
      const heldForSession =
        existingSessionHoldQuantities.get(productSkuId) ?? 0;
      if (heldForSession < requestedQuantity) {
        return createConflict(repository, args, {
          conflictType: "inventory",
          summary: INVENTORY_CONFLICT_SUMMARY,
          details: {
            localTransactionId: payload.localTransactionId,
            productSkuId,
            requestedQuantity,
            heldForSession,
            reason: "existing_pos_session_hold_expired",
          },
        });
      }
    }
  }

  return null;
}

function collectSaleSkuQuantities(payload: PosLocalSalePayload) {
  const quantities = new Map<Id<"productSku">, number>();
  for (const item of payload.items) {
    quantities.set(
      item.productSkuId,
      (quantities.get(item.productSkuId) ?? 0) + item.quantity,
    );
  }
  return quantities;
}

async function validateSaleCustomerReference(
  repository: SyncProjectionRepository,
  args: ProjectEventArgs,
  payload: PosLocalSalePayload,
) {
  if (payload.customerProfileId) {
    const customer = await repository.getCustomerProfile(
      payload.customerProfileId,
    );
    if (!customer || customer.storeId !== args.storeId) {
      return createConflict(repository, args, {
        conflictType: "permission",
        summary: "Customer reference is outside this store.",
        details: {
          localTransactionId: payload.localTransactionId,
          customerProfileId: payload.customerProfileId,
        },
      });
    }
  }

  return null;
}

async function validateSaleCatalogReferences(
  repository: SyncProjectionRepository,
  args: ProjectEventArgs,
  payload: PosLocalSalePayload,
) {
  const itemsByLocalId = new Map<
    string,
    {
      barcode?: string;
      image?: string;
      productName: string;
      productSku: string;
    }
  >();
  let priceConflict: LocalSyncConflictRecord | null = null;
  for (const item of payload.items) {
    const [product, sku] = await Promise.all([
      repository.getProduct(item.productId),
      repository.getProductSku(item.productSkuId),
    ]);

    if (
      !product ||
      product.storeId !== args.storeId ||
      !sku ||
      sku.storeId !== args.storeId ||
      sku.productId !== item.productId
    ) {
      return {
        conflict: await createConflict(repository, args, {
          conflictType: "inventory",
          summary: "Product reference is outside this store.",
          details: {
            localTransactionId: payload.localTransactionId,
            productId: item.productId,
            productSkuId: item.productSkuId,
            submittedUnitPrice: item.unitPrice,
            catalogUnitPrice:
              typeof sku?.netPrice === "number"
                ? sku.netPrice
                : (sku?.price ?? null),
            blocksProjection: true,
          },
        }),
        itemsByLocalId,
      };
    }
    if (
      roundMoney(item.unitPrice) !==
      roundMoney(typeof sku.netPrice === "number" ? sku.netPrice : sku.price)
    ) {
      priceConflict ??= await createConflict(repository, args, {
        conflictType: "inventory",
        summary: "Product price changed before this offline sale synced.",
        details: {
          localTransactionId: payload.localTransactionId,
          productId: item.productId,
          productSkuId: item.productSkuId,
          submittedUnitPrice: item.unitPrice,
          catalogUnitPrice:
            typeof sku.netPrice === "number" ? sku.netPrice : sku.price,
          blocksProjection: false,
        },
      });
    }
    itemsByLocalId.set(item.localTransactionItemId ?? item.productSkuId, {
      barcode: sku.barcode,
      image: sku.images[0],
      productName: sku.productName ?? item.productName,
      productSku: sku.sku ?? item.productSku,
    });
  }

  return { conflict: priceConflict, itemsByLocalId };
}

async function validateSaleLocalIds(
  repository: SyncProjectionRepository,
  args: ProjectEventArgs,
  payload: PosLocalSalePayload,
) {
  const localIds: Array<{
    localIdKind: PosLocalSyncMappingKind;
    localId: string;
  }> = [
    { localIdKind: "receipt", localId: payload.localReceiptNumber },
    ...payload.items
      .filter((item) => item.localTransactionItemId)
      .map((item) => ({
        localIdKind: "transactionItem" as const,
        localId: item.localTransactionItemId!,
      })),
    ...payload.payments
      .filter((payment) => payment.localPaymentId)
      .map((payment) => ({
        localIdKind: "payment" as const,
        localId: payment.localPaymentId!,
      })),
  ];
  const seenLocalIds = new Set<string>();

  for (const local of localIds) {
    const localKey = `${local.localIdKind}:${local.localId}`;
    if (seenLocalIds.has(localKey)) {
      return createConflict(repository, args, {
        conflictType: "duplicate_local_id",
        summary: "Local POS sync id was reused inside one synced sale.",
        details: {
          localIdKind: local.localIdKind,
          localId: local.localId,
          localTransactionId: payload.localTransactionId,
        },
      });
    }
    seenLocalIds.add(localKey);

    const existing = await findMappingForTerminal(repository, args, local);
    if (existing && existing.localEventId !== args.event.localEventId) {
      return createConflict(repository, args, {
        conflictType: "duplicate_local_id",
        summary: "Local POS sync id was reused by a different synced sale.",
        details: {
          localIdKind: local.localIdKind,
          localId: local.localId,
          originalLocalEventId: existing.localEventId,
          localTransactionId: payload.localTransactionId,
        },
      });
    }
  }

  return null;
}

async function projectRegisterClosed(
  repository: SyncProjectionRepository,
  args: ProjectEventArgsFor<"register_closed">,
): Promise<ProjectionResult> {
  const registerSession = await repository.getRegisterSessionByLocalId({
    storeId: args.storeId,
    terminalId: args.terminalId,
    localRegisterSessionId: args.event.localRegisterSessionId,
  });
  if (!registerSession) {
    const conflict = await createConflict(repository, args, {
      conflictType: "permission",
      summary: "Register session mapping is missing for synced POS history.",
      details: {
        localRegisterSessionId: args.event.localRegisterSessionId,
      },
    });
    return { status: "conflicted", mappings: [], conflicts: [conflict] };
  }

  const payload = args.event.payload;
  if (
    registerSession.status !== "open" &&
    registerSession.status !== "active"
  ) {
    const conflict = await createConflict(repository, args, {
      conflictType: "permission",
      summary: "Register session is not open for synced POS closeout.",
      details: {
        localRegisterSessionId: args.event.localRegisterSessionId,
        status: registerSession.status,
      },
    });
    return { status: "conflicted", mappings: [], conflicts: [conflict] };
  }

  const countedCash = payload.countedCash ?? registerSession.expectedCash;
  const variance = countedCash - registerSession.expectedCash;
  if (roundMoney(variance) !== 0) {
    const conflict = await createConflict(repository, args, {
      conflictType: "permission",
      summary:
        "Register closeout variance requires manager review before synced closeout can be applied.",
      details: {
        countedCash,
        expectedCash: registerSession.expectedCash,
        variance,
      },
    });
    return { status: "conflicted", mappings: [], conflicts: [conflict] };
  }

  await repository.patchRegisterSession(registerSession._id, {
    status: "closed",
    countedCash,
    variance,
    closedByStaffProfileId: args.event.staffProfileId,
    closedAt: args.event.occurredAt,
    closeoutRecords: [
      ...(registerSession.closeoutRecords ?? []),
      {
        actorStaffProfileId: args.event.staffProfileId,
        countedCash,
        expectedCash: registerSession.expectedCash,
        notes: payload.notes,
        occurredAt: args.event.occurredAt,
        type: "closed",
        variance,
      },
    ],
    notes: payload.notes,
  });
  const mapping = await createMapping(repository, args, {
    localIdKind: "closeout",
    localId: args.event.localEventId,
    cloudTable: "registerSession",
    cloudId: registerSession._id,
  });
  return { status: "projected", mappings: [mapping], conflicts: [] };
}

async function projectRegisterReopened(
  repository: SyncProjectionRepository,
  args: ProjectEventArgsFor<"register_reopened">,
): Promise<ProjectionResult> {
  const registerSession = await repository.getRegisterSessionByLocalId({
    storeId: args.storeId,
    terminalId: args.terminalId,
    localRegisterSessionId: args.event.localRegisterSessionId,
  });
  if (!registerSession) {
    const conflict = await createConflict(repository, args, {
      conflictType: "permission",
      summary: "Register session mapping is missing for synced POS history.",
      details: {
        localRegisterSessionId: args.event.localRegisterSessionId,
      },
    });
    return { status: "conflicted", mappings: [], conflicts: [conflict] };
  }

  if (registerSession.status !== "closed") {
    const conflict = await createConflict(repository, args, {
      conflictType: "permission",
      summary:
        "Only closed register sessions can be reopened from synced POS history.",
      details: {
        localRegisterSessionId: args.event.localRegisterSessionId,
        status: registerSession.status,
      },
    });
    return { status: "conflicted", mappings: [], conflicts: [conflict] };
  }

  const blockingRegisterSession = await repository.findBlockingRegisterSession({
    storeId: args.storeId,
    terminalId: args.terminalId,
    registerNumber: normalizeOptionalString(registerSession.registerNumber),
  });
  if (
    blockingRegisterSession &&
    blockingRegisterSession._id !== registerSession._id
  ) {
    const conflict = await createConflict(repository, args, {
      conflictType: "permission",
      summary:
        "A different register session is already open for this terminal.",
      details: {
        blockingRegisterSessionId: blockingRegisterSession._id,
        localRegisterSessionId: args.event.localRegisterSessionId,
      },
    });
    return { status: "conflicted", mappings: [], conflicts: [conflict] };
  }

  await repository.patchRegisterSession(registerSession._id, {
    status: "active",
    closedAt: undefined,
    closedByStaffProfileId: undefined,
    closeoutRecords: [
      ...(registerSession.closeoutRecords ?? []),
      {
        actorStaffProfileId: args.event.staffProfileId,
        countedCash: registerSession.countedCash,
        expectedCash: registerSession.expectedCash,
        notes: registerSession.notes,
        occurredAt: args.event.occurredAt,
        previousClosedAt: registerSession.closedAt,
        previousClosedByStaffProfileId: registerSession.closedByStaffProfileId,
        reason:
          typeof args.event.payload.reason === "string" &&
          args.event.payload.reason.trim()
            ? args.event.payload.reason.trim()
            : "Closed register closeout reopened for correction.",
        type: "reopened",
        variance: registerSession.variance,
      },
    ],
    countedCash: undefined,
    notes: undefined,
    variance: undefined,
  });
  return { status: "projected", mappings: [], conflicts: [] };
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

async function collectExistingSaleMappings(
  repository: SyncProjectionRepository,
  args: ProjectEventArgsFor<"sale_completed">,
) {
  const payload = getSalePayload(args.event);
  const localIds: Array<{
    localIdKind: PosLocalSyncMappingKind;
    localId: string;
  }> = [
    { localIdKind: "posSession", localId: payload.localPosSessionId },
    { localIdKind: "transaction", localId: payload.localTransactionId },
    { localIdKind: "receipt", localId: payload.localReceiptNumber },
    ...payload.items
      .filter((item) => item.localTransactionItemId)
      .map((item) => ({
        localIdKind: "transactionItem" as const,
        localId: item.localTransactionItemId!,
      })),
    ...payload.payments
      .filter((payment) => payment.localPaymentId)
      .map((payment) => ({
        localIdKind: "payment" as const,
        localId: payment.localPaymentId!,
      })),
  ];
  const mappings: LocalSyncMappingRecord[] = [];

  for (const localId of localIds) {
    const mapping = await findMapping(repository, args, localId);
    if (mapping) mappings.push(mapping);
  }

  return mappings;
}

function getSalePayload(
  event: ProjectEventArgsFor<"sale_completed">["event"],
): PosLocalSalePayload {
  return event.payload;
}

function isValidPayment(payment: {
  method: string;
  amount: number;
  timestamp: number;
}) {
  return (
    typeof payment.method === "string" &&
    payment.method.trim().length > 0 &&
    Number.isFinite(payment.amount) &&
    payment.amount > 0 &&
    Number.isFinite(payment.timestamp)
  );
}

function normalizeOptionalString(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeLocalSalePayments(args: {
  changeGiven?: number;
  payments: PosLocalSalePayload["payments"];
}) {
  const normalizedPayments = normalizeInStorePayments(args);

  return normalizedPayments.map((payment) => {
    const sourcePayment = args.payments.find(
      (candidate) =>
        candidate.method === payment.method &&
        candidate.timestamp === payment.timestamp &&
        candidate.amount >= payment.amount,
    );

    return {
      ...payment,
      localPaymentId: sourcePayment?.localPaymentId,
    };
  });
}

async function findMapping(
  repository: SyncProjectionRepository,
  args: ProjectEventArgs,
  local: {
    localIdKind: PosLocalSyncMappingKind;
    localId: string;
  },
) {
  return repository.findMapping({
    storeId: args.storeId,
    terminalId: args.terminalId,
    localRegisterSessionId: args.event.localRegisterSessionId,
    localIdKind: local.localIdKind,
    localId: local.localId,
  });
}

async function findMappingForTerminal(
  repository: SyncProjectionRepository,
  args: ProjectEventArgs,
  local: {
    localIdKind: PosLocalSyncMappingKind;
    localId: string;
  },
) {
  return repository.findMappingForTerminal({
    storeId: args.storeId,
    terminalId: args.terminalId,
    localIdKind: local.localIdKind,
    localId: local.localId,
  });
}

function createMapping(
  repository: SyncProjectionRepository,
  args: ProjectEventArgs,
  input: LocalSyncMappingProjectionInput,
) {
  const scopedInput: LocalSyncMappingRecordInput = {
    storeId: args.storeId,
    terminalId: args.terminalId,
    localRegisterSessionId: args.event.localRegisterSessionId,
    localEventId: args.event.localEventId,
    createdAt: args.now,
    ...input,
  };

  return repository.createMapping(scopedInput);
}

function isPosUsableRegisterSession(
  registerSession: Pick<RegisterSessionRecord, "status"> | null | undefined,
) {
  return POS_USABLE_REGISTER_SESSION_STATUSES.has(
    registerSession?.status ?? "",
  );
}

function createConflict(
  repository: SyncProjectionRepository,
  args: ProjectEventArgs,
  input: {
    conflictType: LocalSyncConflictRecord["conflictType"];
    summary: string;
    details: Record<string, unknown>;
  },
) {
  return repository.createConflict({
    storeId: args.storeId,
    terminalId: args.terminalId,
    localRegisterSessionId: args.event.localRegisterSessionId,
    localEventId: args.event.localEventId,
    sequence: args.event.sequence,
    conflictType: input.conflictType,
    status: "needs_review",
    summary: input.summary,
    details: input.details,
    createdAt: args.now,
  });
}

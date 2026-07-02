import type { Id } from "../../../_generated/dataModel";
import { normalizeInStorePayments } from "../../../cashControls/paymentAllocationAttribution";
import { toDisplayAmount } from "../../../lib/currency";
import {
  areRegisterSessionCloseoutReviewFactsEquivalent,
  buildRegisterSessionCloseoutReview,
  getCashControlsConfig,
} from "../../../operations/registerSessionCloseoutGate";
import { currencyFormatter, generateTransactionNumber } from "../../../utils";
import {
  canReuseCloudRegisterSessionForLocalOpen as canReuseCloudRegisterSessionForLocalOpenPolicy,
  canSupersedeReviewedRegisterSessionForLocalOpen as canSupersedeReviewedRegisterSessionForLocalOpenPolicy,
  isRegisterCloseoutReviewConflict,
  isRegisterSessionSaleUsable,
  REGISTER_CLOSEOUT_VARIANCE_SYNC_REVIEW_SUMMARY,
} from "../../../../shared/registerSessionLifecyclePolicy";
import type {
  LocalSyncConflictRecord,
  LocalSyncMappingRecord,
  LocalSyncMappingRecordInput,
  LocalSyncMappingProjectionInput,
  LocalSyncRegisterReviewConflictFact,
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
  options?: {
    allowClosedRegisterSaleProjection?: boolean;
    allowReviewedClosingRegisterSaleProjection?: boolean;
    allowReviewedDuplicatePosSessionSaleProjection?: boolean;
    applyExpectedTotalForReviewedNonCashOverpayment?: boolean;
    allowReviewedInventorySaleProjection?: boolean;
    allowRegisterCloseoutVarianceProjection?: boolean;
    reviewedConflictIds?: string[];
    reviewActorStaffProfileId?: Id<"staffProfile">;
    trustStoredStaffProof?: boolean;
  };
};

export type RegisterSessionRepairMappingArgs = {
  localEventId: string;
  localRegisterSessionId: string;
  now: number;
  registerSessionId: Id<"registerSession">;
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
};

type SaleCompletedArgs = ProjectEventArgsFor<"sale_completed">;
type SaleClearedArgs = ProjectEventArgsFor<"sale_cleared">;
type ExpenseRecordedArgs = ProjectEventArgsFor<"expense_recorded">;

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

type OpenRegisterCloseoutReviewState = {
  hasOpenRegisterCloseoutReview: boolean;
  latestReviewBoundaryAt?: number;
};

type CanonicalSaleItem = {
  barcode?: string;
  image?: string;
  productName: string;
  productSku: string;
};

type CanonicalServiceLine = {
  serviceCatalogName: string;
  serviceMode: "same_day" | "consultation" | "repair" | "revamp";
  pricingModel: "fixed" | "starting_at" | "quote_after_consultation";
};

type SaleValidationContext = {
  payload: PosLocalSalePayload;
  store: StoreRecord;
  terminal: TerminalRecord;
  catalogValidation: {
    conflict: LocalSyncConflictRecord | null;
    itemsByLocalId: Map<string, CanonicalSaleItem>;
    serviceLinesByLocalId: Map<string, CanonicalServiceLine>;
  };
};

type SaleSessionResolution = {
  registerSession: RegisterSessionRecord;
  existingPosSession: PosSessionRecord;
  existingPosSessionMapping: LocalSyncMappingRecord | null;
  preserveSaleWithoutPosSession?: boolean;
  resolvedRegisterNumber: string;
};

type SalePaymentCalculation = {
  changeGiven?: number;
  expectedCashDelta: number;
  paymentConflict: LocalSyncConflictRecord | null;
  primaryPaymentMethod?: string;
  retailAllocations: PlannedPaymentAllocation[];
  serviceAllocationsByLineKey: Map<string, PlannedPaymentAllocation[]>;
  totalPaid: number;
  transactionPayments: PosLocalSalePayload["payments"];
  validPayments: PosLocalSalePayload["payments"];
};

type PlannedPaymentAllocation = {
  localPaymentId?: string;
  method: string;
  amount: number;
  timestamp: number;
};

type PersistedSaleSession = {
  posSessionId?: Id<"posSession">;
  posSessionMappings: LocalSyncMappingRecord[];
  reusedExistingSession: boolean;
};

type PersistedSale = {
  receiptMapping: LocalSyncMappingRecord;
  registerSessionId: Id<"registerSession">;
  transactionId: Id<"posTransaction">;
  transactionMapping: LocalSyncMappingRecord;
};

type SaleInventoryValidation = {
  conflict: LocalSyncConflictRecord | null;
  skippedMutationItems: SaleInventorySkippedMutationItem[];
  stockMutationAllowed: boolean;
};

type SaleInventorySkippedMutationItem = {
  activeHeldQuantity?: number;
  availableInventoryCount?: number | null;
  heldForSession?: number;
  productId?: Id<"product">;
  productName?: string;
  productSku?: string;
  productSkuId: Id<"productSku">;
  quantityAvailable?: number | null;
  quantityAvailableAfterHolds?: number;
  reason: "stock_shortfall" | "existing_pos_session_hold_expired";
  requestedQuantity: number;
};

type PersistedServiceLine = {
  line: NonNullable<PosLocalSalePayload["serviceLines"]>[number];
  lineKey: string;
  serviceCaseId: Id<"serviceCase">;
  serviceCaseLineItemId: Id<"serviceCaseLineItem">;
  transactionServiceLineId: Id<"posTransactionServiceLine">;
  workItemId?: Id<"operationalWorkItem">;
  customerProfileId: Id<"customerProfile">;
};

async function persistRegisterSessionWorkflowTraceId(
  repository: SyncProjectionRepository,
  args: {
    registerSessionId: Id<"registerSession">;
    traceCreated: boolean;
    traceId: string;
    workflowTraceId?: string | null;
  },
) {
  if (!args.traceCreated || args.workflowTraceId) {
    return;
  }

  await repository.patchRegisterSession(args.registerSessionId, {
    workflowTraceId: args.traceId,
  });
}

const INVENTORY_CONFLICT_SUMMARY =
  "Inventory needs manager review for a synced offline sale.";
const EXPENSE_INVENTORY_CONFLICT_SUMMARY =
  "Inventory needs manager review for a synced expense.";
const PAYMENT_CONFLICT_SUMMARY =
  "Payment needs manager review for a synced offline sale.";
const PERMISSION_DRIFT_SUMMARY =
  "Staff access changed before this POS history synced.";

const POS_SYNC_ALLOWED_ROLES_BY_EVENT = {
  register_opened: ["cashier", "manager"],
  pending_checkout_item_defined: ["cashier", "manager"],
  sale_completed: ["cashier", "manager"],
  sale_cleared: ["cashier", "manager"],
  register_closed: ["cashier", "manager"],
  register_reopened: ["manager"],
  expense_recorded: ["cashier", "manager"],
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

  if (args.event.eventType === "pending_checkout_item_defined") {
    return projectPendingCheckoutItemDefined(
      repository,
      args as ProjectEventArgsFor<"pending_checkout_item_defined">,
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

  if (args.event.eventType === "expense_recorded") {
    return projectExpenseRecorded(
      repository,
      args as ProjectEventArgsFor<"expense_recorded">,
    );
  }

  assertNever(args.event);
}

export async function createOrReuseRegisterSessionRepairMapping(
  repository: SyncProjectionRepository,
  args: RegisterSessionRepairMappingArgs,
) {
  const existing = await repository.findMapping({
    storeId: args.storeId,
    terminalId: args.terminalId,
    localRegisterSessionId: args.localRegisterSessionId,
    localIdKind: "registerSession",
    localId: args.localRegisterSessionId,
  });
  if (existing) {
    if (
      existing.cloudTable === "registerSession" &&
      existing.cloudId === args.registerSessionId
    ) {
      return existing;
    }

    throw new Error(
      "POS local sync register-session mapping already belongs to another projection.",
    );
  }

  return repository.createMapping({
    storeId: args.storeId,
    terminalId: args.terminalId,
    localRegisterSessionId: args.localRegisterSessionId,
    localEventId: args.localEventId,
    sourceEventType: "repair",
    localIdKind: "registerSession",
    localId: args.localRegisterSessionId,
    cloudTable: "registerSession",
    cloudId: args.registerSessionId,
    createdAt: args.now,
  });
}

async function projectExpenseRecorded(
  repository: SyncProjectionRepository,
  args: ExpenseRecordedArgs,
): Promise<ProjectionResult> {
  const existingTransactionMapping = await findMappingForTerminal(repository, args, {
    localIdKind: "expenseTransaction",
    localId: args.event.payload.localExpenseEventId,
  });
  if (existingTransactionMapping) {
    const existingSessionMapping = await findMappingForTerminal(repository, args, {
      localIdKind: "expenseSession",
      localId: args.event.payload.localExpenseSessionId,
    });
    return {
      status: "projected",
      mappings: [
        ...(existingSessionMapping ? [existingSessionMapping] : []),
        existingTransactionMapping,
      ],
      conflicts: [],
    };
  }

  const store = await repository.getStore(args.storeId);
  if (!store) {
    const conflict = await createConflict(repository, args, {
      conflictType: "inventory",
      summary: "Store is missing for synced expense history.",
      details: { blocksProjection: true, storeId: args.storeId },
    });
    return { status: "conflicted", mappings: [], conflicts: [conflict] };
  }

  const resolvedItems: Array<{
    item: ExpenseRecordedArgs["event"]["payload"]["items"][number];
    productId: Id<"product">;
    productSkuId: Id<"productSku">;
    pendingCheckoutItemId?: Id<"posPendingCheckoutItem">;
    inventoryImportProvisionalSkuId?: Id<"inventoryImportProvisionalSku">;
  }> = [];
  const trustedExpenseSkuQuantities = new Map<
    Id<"productSku">,
    {
      productSkuId: Id<"productSku">;
      requestedQuantity: number;
      inventoryCount: number;
      quantityAvailable: number;
    }
  >();
  const trustedExpenseSkuAvailability = new Map<Id<"productSku">, boolean>();
  const reviewConflicts: LocalSyncConflictRecord[] = [];

  for (const item of args.event.payload.items) {
    if (item.pendingCheckoutItemId && item.inventoryImportProvisionalSkuId) {
      const conflict = await createConflict(repository, args, {
        conflictType: "inventory",
        summary:
          "Synced expense line has conflicting pending checkout and provisional import sources.",
        details: {
          blocksProjection: true,
          localExpenseEventId: args.event.payload.localExpenseEventId,
          localTransactionItemId: item.localTransactionItemId,
          pendingCheckoutItemId: item.pendingCheckoutItemId,
          inventoryImportProvisionalSkuId:
            item.inventoryImportProvisionalSkuId,
          productId: item.productId,
          productSkuId: item.productSkuId,
        },
      });
      return { status: "conflicted", mappings: [], conflicts: [conflict] };
    }

    const productId = repository.normalizeCloudId("product", item.productId);
    const productSkuId = repository.normalizeCloudId(
      "productSku",
      item.productSkuId,
    );
    if (!productId || !productSkuId) {
      const conflict = await createConflict(repository, args, {
        conflictType: "inventory",
        summary: "Expense line item catalog reference is missing.",
        details: {
          blocksProjection: true,
          productId: item.productId,
          productSkuId: item.productSkuId,
        },
      });
      return { status: "conflicted", mappings: [], conflicts: [conflict] };
    }

    const [product, sku] = await Promise.all([
      repository.getProduct(productId),
      repository.getProductSku(productSkuId),
    ]);
    if (
      !product ||
      !sku ||
      product.storeId !== args.storeId ||
      sku.storeId !== args.storeId ||
      sku.productId !== productId
    ) {
      const conflict = await createConflict(repository, args, {
        conflictType: "inventory",
        summary: "Expense line item catalog reference does not belong to this store.",
        details: {
          blocksProjection: true,
          productId,
          productSkuId,
        },
      });
      return { status: "conflicted", mappings: [], conflicts: [conflict] };
    }

    let pendingCheckoutItemId: Id<"posPendingCheckoutItem"> | undefined;
    if (item.pendingCheckoutItemId) {
      const normalizedPendingCheckoutItemId = repository.normalizeCloudId(
        "posPendingCheckoutItem",
        item.pendingCheckoutItemId,
      );
      if (!normalizedPendingCheckoutItemId) {
        const conflict = await createConflict(repository, args, {
          conflictType: "inventory",
          summary: "Expense pending checkout reference does not match this line.",
          details: {
            blocksProjection: true,
            pendingCheckoutItemId: item.pendingCheckoutItemId,
            productId,
            productSkuId,
          },
        });
        return { status: "conflicted", mappings: [], conflicts: [conflict] };
      }
      const pendingCheckoutItem = await repository.getPendingCheckoutItem(
        normalizedPendingCheckoutItemId,
      );
      if (
        !pendingCheckoutItem ||
        pendingCheckoutItem.storeId !== args.storeId ||
        pendingCheckoutItem.provisionalProductId !== productId ||
        pendingCheckoutItem.provisionalProductSkuId !== productSkuId
      ) {
        const conflict = await createConflict(repository, args, {
          conflictType: "inventory",
          summary: "Expense pending checkout reference does not match this line.",
          details: {
            blocksProjection: true,
            pendingCheckoutItemId: item.pendingCheckoutItemId,
            productId,
            productSkuId,
          },
        });
        return { status: "conflicted", mappings: [], conflicts: [conflict] };
      }
      pendingCheckoutItemId = normalizedPendingCheckoutItemId;
    }

    let inventoryImportProvisionalSkuId:
      | Id<"inventoryImportProvisionalSku">
      | undefined;
    if (item.inventoryImportProvisionalSkuId) {
      const normalizedInventoryImportProvisionalSkuId =
        repository.normalizeCloudId(
          "inventoryImportProvisionalSku",
          item.inventoryImportProvisionalSkuId,
        );
      if (!normalizedInventoryImportProvisionalSkuId) {
        const conflict = await createConflict(repository, args, {
          conflictType: "inventory",
          summary: "Expense provisional import reference does not match this line.",
          details: {
            blocksProjection: true,
            inventoryImportProvisionalSkuId: item.inventoryImportProvisionalSkuId,
            productId,
            productSkuId,
          },
        });
        return { status: "conflicted", mappings: [], conflicts: [conflict] };
      }
      const provisionalSku = await repository.getInventoryImportProvisionalSku(
        normalizedInventoryImportProvisionalSkuId,
      );
      if (
        !provisionalSku ||
        provisionalSku.storeId !== args.storeId ||
        provisionalSku.productId !== productId ||
        provisionalSku.productSkuId !== productSkuId ||
        provisionalSku.status !== "active" ||
        provisionalSku.posExposureStatus === "hidden"
      ) {
        const conflict = await createConflict(repository, args, {
          conflictType: "inventory",
          summary: "Expense provisional import reference does not match this line.",
          details: {
            blocksProjection: true,
            inventoryImportProvisionalSkuId: item.inventoryImportProvisionalSkuId,
            productId,
            productSkuId,
          },
        });
        return { status: "conflicted", mappings: [], conflicts: [conflict] };
      }
      inventoryImportProvisionalSkuId =
        normalizedInventoryImportProvisionalSkuId;
    }

    if (!pendingCheckoutItemId && !inventoryImportProvisionalSkuId) {
      const current = trustedExpenseSkuQuantities.get(productSkuId) ?? {
        productSkuId,
        requestedQuantity: 0,
        inventoryCount: sku.inventoryCount,
        quantityAvailable: sku.quantityAvailable,
      };
      current.requestedQuantity += item.quantity;
      trustedExpenseSkuQuantities.set(productSkuId, current);
    }

    resolvedItems.push({
      item,
      productId,
      productSkuId,
      ...(pendingCheckoutItemId ? { pendingCheckoutItemId } : {}),
      ...(inventoryImportProvisionalSkuId
        ? { inventoryImportProvisionalSkuId }
        : {}),
    });
  }

  for (const aggregate of trustedExpenseSkuQuantities.values()) {
    const inventoryAvailable =
      aggregate.inventoryCount >= aggregate.requestedQuantity &&
      aggregate.quantityAvailable >= aggregate.requestedQuantity;
    trustedExpenseSkuAvailability.set(aggregate.productSkuId, inventoryAvailable);

    if (!inventoryAvailable) {
      reviewConflicts.push(
        await createConflict(repository, args, {
          conflictType: "inventory",
          summary: EXPENSE_INVENTORY_CONFLICT_SUMMARY,
          details: {
            blocksProjection: false,
            localExpenseEventId: args.event.payload.localExpenseEventId,
            productSkuId: aggregate.productSkuId,
            requestedQuantity: aggregate.requestedQuantity,
            inventoryCount: aggregate.inventoryCount,
            quantityAvailable: aggregate.quantityAvailable,
          },
        }),
      );
    }
  }

  const existingSessionMapping = await findMappingForTerminal(repository, args, {
    localIdKind: "expenseSession",
    localId: args.event.payload.localExpenseSessionId,
  });
  const existingSession = await repository.getExpenseSessionByLocalId({
    storeId: args.storeId,
    terminalId: args.terminalId,
    localExpenseSessionId: args.event.payload.localExpenseSessionId,
  });

  const sessionId =
    existingSession?._id ??
    (await repository.createExpenseSession({
      localExpenseSessionId: args.event.payload.localExpenseSessionId,
      sessionNumber: args.event.payload.localExpenseSessionId,
      storeId: args.storeId,
      staffProfileId: args.event.staffProfileId,
      terminalId: args.terminalId,
      createdAt: args.event.occurredAt,
      updatedAt: args.now,
      expiresAt: Number.MAX_SAFE_INTEGER,
      completedAt: args.event.occurredAt,
      notes: args.event.payload.notes ?? args.event.payload.reason,
    }));

  const sessionMapping =
    existingSessionMapping ??
    (await createMapping(repository, args, {
      syncScope: "expense",
      localExpenseSessionId: args.event.payload.localExpenseSessionId,
      localIdKind: "expenseSession",
      localId: args.event.payload.localExpenseSessionId,
      cloudTable: "expenseSession",
      cloudId: sessionId,
    }));

  for (const resolved of resolvedItems) {
    const usesTrustedInventory =
      !resolved.pendingCheckoutItemId &&
      !resolved.inventoryImportProvisionalSkuId;
    const inventoryHoldApplied =
      usesTrustedInventory &&
      trustedExpenseSkuAvailability.get(resolved.productSkuId) === true;
    await repository.createExpenseSessionItem({
      sessionId,
      storeId: args.storeId,
      productId: resolved.productId,
      productSkuId: resolved.productSkuId,
      ...(resolved.pendingCheckoutItemId
        ? { pendingCheckoutItemId: resolved.pendingCheckoutItemId }
        : {}),
      ...(resolved.inventoryImportProvisionalSkuId
        ? {
            inventoryImportProvisionalSkuId:
              resolved.inventoryImportProvisionalSkuId,
          }
        : {}),
      inventoryHoldApplied,
      productSku: resolved.item.productSku,
      barcode: resolved.item.barcode,
      productName: resolved.item.productName,
      price: resolved.item.unitPrice,
      quantity: resolved.item.quantity,
      image: resolved.item.image,
      createdAt: args.event.occurredAt,
      updatedAt: args.now,
    });
  }

  const transactionId = await repository.createExpenseTransaction({
    transactionNumber: generateTransactionNumber(),
    storeId: args.storeId,
    sessionId,
    staffProfileId: args.event.staffProfileId,
    totalValue: args.event.payload.totals.total,
    completedAt: args.event.occurredAt,
    notes: args.event.payload.notes ?? args.event.payload.reason,
  });

  for (const resolved of resolvedItems) {
    const usesTrustedInventory =
      !resolved.pendingCheckoutItemId &&
      !resolved.inventoryImportProvisionalSkuId;
    const inventoryHoldApplied =
      usesTrustedInventory &&
      trustedExpenseSkuAvailability.get(resolved.productSkuId) === true;
    await repository.createExpenseTransactionItem({
      transactionId,
      productId: resolved.productId,
      productSkuId: resolved.productSkuId,
      ...(resolved.pendingCheckoutItemId
        ? { pendingCheckoutItemId: resolved.pendingCheckoutItemId }
        : {}),
      ...(resolved.inventoryImportProvisionalSkuId
        ? {
            inventoryImportProvisionalSkuId:
              resolved.inventoryImportProvisionalSkuId,
          }
        : {}),
      inventoryHoldApplied,
      productName: resolved.item.productName,
      productSku: resolved.item.productSku,
      quantity: resolved.item.quantity,
      costPrice: resolved.item.unitPrice,
      image: resolved.item.image,
    });
  }

  for (const aggregate of trustedExpenseSkuQuantities.values()) {
    if (trustedExpenseSkuAvailability.get(aggregate.productSkuId) !== true) {
      continue;
    }

    await repository.patchProductSku(aggregate.productSkuId, {
      inventoryCount: Math.max(
        0,
        aggregate.inventoryCount - aggregate.requestedQuantity,
      ),
      quantityAvailable: Math.max(
        0,
        aggregate.quantityAvailable - aggregate.requestedQuantity,
      ),
    });
  }

  const transactionMapping = await createMapping(repository, args, {
    syncScope: "expense",
    localExpenseSessionId: args.event.payload.localExpenseSessionId,
    localIdKind: "expenseTransaction",
    localId: args.event.payload.localExpenseEventId,
    cloudTable: "expenseTransaction",
    cloudId: transactionId,
  });

  return {
    status: "projected",
    mappings: [sessionMapping, transactionMapping],
    conflicts: reviewConflicts,
  };
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
  const canTrustStoredStaffProof =
    args.options?.trustStoredStaffProof === true && !args.event.staffProofToken;
  const hasTrustedStoredStaffProof =
    canTrustStoredStaffProof &&
    Boolean(staff) &&
    staff?.storeId === args.storeId &&
    staff?.status === "active" &&
    hasActivePosRole &&
    hasTerminalAccess;
  const hasTerminalStaffProof =
    Boolean(staff) &&
    staff?.storeId === args.storeId &&
    staff?.status === "active" &&
    hasActivePosRole &&
    hasTerminalAccess &&
    (hasValidStaffProof || hasTrustedStoredStaffProof);
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
  const hasTrustedStoredCashierOrManagerProof =
    canTrustStoredStaffProof &&
    Boolean(staff) &&
    staff?.storeId === args.storeId &&
    staff?.status === "active" &&
    hasActiveCashierOrManagerRole &&
    hasTerminalAccess;
  const hasTerminalCashierOrManagerProof =
    Boolean(staff) &&
    staff?.storeId === args.storeId &&
    staff?.status === "active" &&
    hasActiveCashierOrManagerRole &&
    hasTerminalAccess &&
    (hasValidStaffProof || hasTrustedStoredCashierOrManagerProof);
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
  return canReuseCloudRegisterSessionForLocalOpen(
    repository,
    args,
    registerSession,
  );
}

type ProjectEventArgsFor<EventType extends PosLocalSyncEventType> = Omit<
  ProjectEventArgs,
  "event"
> & {
  event: Extract<ParsedPosLocalSyncEventInput, { eventType: EventType }>;
};

async function canReuseCloudRegisterSessionForLocalOpen(
  repository: SyncProjectionRepository,
  args: ProjectEventArgsFor<"register_opened">,
  registerSession: Awaited<
    ReturnType<SyncProjectionRepository["getRegisterSession"]>
  >,
) {
  const hasOpenRegisterCloseoutReview =
    registerSession === null || registerSession === undefined
      ? { hasOpenRegisterCloseoutReview: false }
      : await getOpenRegisterCloseoutReviewState(repository, args, {
          registerSessionId: registerSession._id,
        });

  return canReuseCloudRegisterSessionForLocalOpenPolicy({
    hasOpenRegisterCloseoutReview:
      hasOpenRegisterCloseoutReview.hasOpenRegisterCloseoutReview,
    localRegisterSessionId: args.event.localRegisterSessionId,
    registerSession: registerSession
      ? {
          ...registerSession,
          cloudRegisterSessionId: registerSession._id,
        }
      : registerSession,
    storeId: args.storeId,
    terminalId: args.terminalId,
  });
}

async function canSupersedeReviewedRegisterSessionForLocalOpen(
  repository: SyncProjectionRepository,
  args: ProjectEventArgsFor<"register_opened">,
  registerSession: Awaited<
    ReturnType<SyncProjectionRepository["getRegisterSession"]>
  >,
) {
  const hasOpenRegisterCloseoutReview =
    registerSession === null || registerSession === undefined
      ? { hasOpenRegisterCloseoutReview: false }
      : await getOpenRegisterCloseoutReviewState(repository, args, {
          registerSessionId: registerSession._id,
        });

  return canSupersedeReviewedRegisterSessionForLocalOpenPolicy({
    closeoutReviewBoundaryAt:
      hasOpenRegisterCloseoutReview.latestReviewBoundaryAt ??
      getRegisterSessionCloseoutBoundaryAt(registerSession),
    hasOpenRegisterCloseoutReview:
      hasOpenRegisterCloseoutReview.hasOpenRegisterCloseoutReview,
    replacementLocalRegisterSessionId: args.event.localRegisterSessionId,
    replacementOpenedAt: args.event.occurredAt,
    registerSession,
    storeId: args.storeId,
    terminalId: args.terminalId,
  });
}

async function getOpenRegisterCloseoutReviewState(
  repository: SyncProjectionRepository,
  args: Pick<ProjectEventArgs, "storeId" | "terminalId">,
  input: { registerSessionId: Id<"registerSession"> },
): Promise<OpenRegisterCloseoutReviewState> {
  const facts = await repository.listOpenRegisterReviewConflictFacts({
    registerSessionId: input.registerSessionId,
    storeId: args.storeId,
    terminalId: args.terminalId,
  });
  const closeoutReviewConflicts = facts
    .filter((fact) =>
      factMatchesRegisterSessionCloseoutReview(fact, input.registerSessionId),
    )
    .map((fact) => fact.conflict);

  return {
    hasOpenRegisterCloseoutReview: closeoutReviewConflicts.length > 0,
    latestReviewBoundaryAt: closeoutReviewConflicts.reduce<number | undefined>(
      (latest, conflict) =>
        latest === undefined
          ? getConflictCloseoutReviewBoundaryAt(conflict)
          : Math.max(latest, getConflictCloseoutReviewBoundaryAt(conflict)),
      undefined,
    ),
  };
}

function getConflictCloseoutReviewBoundaryAt(conflict: LocalSyncConflictRecord) {
  return typeof conflict.details.closeoutOccurredAt === "number"
    ? conflict.details.closeoutOccurredAt
    : conflict.createdAt;
}

function getRegisterSessionCloseoutBoundaryAt(
  registerSession:
    | Awaited<ReturnType<SyncProjectionRepository["getRegisterSession"]>>
    | null
    | undefined,
) {
  const latestCloseoutRecord = registerSession?.closeoutRecords?.reduce<
    number | undefined
  >((latest, record) => {
    const occurredAt =
      typeof record === "object" &&
      record !== null &&
      "occurredAt" in record &&
      typeof record.occurredAt === "number"
        ? record.occurredAt
        : undefined;
    if (occurredAt === undefined) return latest;
    return latest === undefined ? occurredAt : Math.max(latest, occurredAt);
  }, undefined);
  if (latestCloseoutRecord !== undefined) return latestCloseoutRecord;

  if (typeof registerSession?.closeoutOwnedAt === "number") {
    return registerSession.closeoutOwnedAt;
  }

  return typeof registerSession?.closedAt === "number"
    ? registerSession.closedAt
    : null;
}

function factMatchesRegisterSessionCloseoutReview(
  fact: LocalSyncRegisterReviewConflictFact,
  registerSessionId: Id<"registerSession">,
) {
  if (!isRegisterCloseoutReviewConflict(fact.conflict)) {
    return false;
  }
  if (
    fact.registerSessionMapping?.cloudTable === "registerSession" &&
    fact.registerSessionMapping.cloudId === registerSessionId
  ) {
    return true;
  }

  return fact.directRegisterSession?._id === registerSessionId;
}

async function projectRegisterOpened(
  repository: SyncProjectionRepository,
  args: ProjectEventArgsFor<"register_opened">,
): Promise<ProjectionResult> {
  const existing = await findMapping(repository, args, {
    localIdKind: "registerSession",
    localId: args.event.localRegisterSessionId,
  });
  if (existing) {
    if (
      existing.localEventId !== args.event.localEventId &&
      existing.sourceEventType === "register_opened"
    ) {
      const conflict = await createConflict(repository, args, {
        conflictType: "duplicate_local_id",
        summary: "Local register session id was reused by a different synced register open.",
        details: {
          existingLocalEventId: existing.localEventId,
          localIdKind: "registerSession",
          localRegisterSessionId: args.event.localRegisterSessionId,
          reason: "duplicate_register_opened",
        },
      });
      return { status: "conflicted", mappings: [], conflicts: [conflict] };
    }
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
      await canReuseCloudRegisterSessionForLocalOpen(
        repository,
        args,
        registerSession,
      )
    ) {
      const mapping = await createMapping(repository, args, {
        localIdKind: "registerSession",
        localId: args.event.localRegisterSessionId,
        cloudTable: "registerSession",
        cloudId: registerSession._id,
      });
      return { status: "projected", mappings: [mapping], conflicts: [] };
    }

    const conflict = await createConflict(repository, args, {
      conflictType: "permission",
      summary: "Register session mapping is not usable for synced POS history.",
      details: {
        localRegisterSessionId: args.event.localRegisterSessionId,
        cloudRegisterSessionId: directRegisterSessionId,
        status: registerSession?.status ?? null,
      },
    });
    return { status: "conflicted", mappings: [], conflicts: [conflict] };
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
    if (
      await canReuseCloudRegisterSessionForLocalOpen(
        repository,
        args,
        blockingRegisterSession,
      )
    ) {
      const mapping = await createMapping(repository, args, {
        localIdKind: "registerSession",
        localId: args.event.localRegisterSessionId,
        cloudTable: "registerSession",
        cloudId: blockingRegisterSession._id,
      });
      return { status: "projected", mappings: [mapping], conflicts: [] };
    }

    const canSupersedeReviewedRegisterSession =
      await canSupersedeReviewedRegisterSessionForLocalOpen(
        repository,
        args,
        blockingRegisterSession,
      );

    if (!canSupersedeReviewedRegisterSession) {
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
    terminalId: args.terminalId,
    localEventId: args.event.localEventId,
  });
  const traceResult = await repository.recordRegisterSessionWorkflowTrace?.({
    stage: "opened",
    session: {
      _id: registerSessionId,
      storeId: args.storeId,
      organizationId: store?.organizationId,
      terminalId: args.terminalId,
      registerNumber: terminalRegisterNumber,
      status: "active",
      openedByStaffProfileId: args.event.staffProfileId,
      openedAt: args.event.occurredAt,
      openingFloat,
      expectedCash: openingFloat,
    },
  });
  if (traceResult) {
    await persistRegisterSessionWorkflowTraceId(repository, {
      registerSessionId,
      traceCreated: traceResult.traceCreated,
      traceId: traceResult.traceId,
    });
  }

  return { status: "projected", mappings: [mapping], conflicts: [] };
}

async function projectPendingCheckoutItemDefined(
  repository: SyncProjectionRepository,
  args: ProjectEventArgsFor<"pending_checkout_item_defined">,
): Promise<ProjectionResult> {
  const payload = args.event.payload;
  const existing = await findMappingForTerminal(repository, args, {
    localIdKind: "pendingCheckoutItem",
    localId: payload.localPendingCheckoutItemId,
  });
  if (existing) {
    if (existing.localEventId !== args.event.localEventId) {
      const conflict = await createConflict(repository, args, {
        conflictType: "duplicate_local_id",
        summary:
          "Local pending checkout item id was reused by different synced history.",
        details: {
          localPendingCheckoutItemId: payload.localPendingCheckoutItemId,
          originalLocalEventId: existing.localEventId,
        },
      });
      return conflictResult(conflict);
    }

    return { status: "projected", mappings: [existing], conflicts: [] };
  }

  const registerSession = await repository.getRegisterSessionByLocalId({
    storeId: args.storeId,
    terminalId: args.terminalId,
    localRegisterSessionId: args.event.localRegisterSessionId ?? "",
  });
  if (!registerSession) {
    const conflict = await createConflict(repository, args, {
      conflictType: "permission",
      summary: "Register session mapping is missing for synced POS history.",
      details: {
        localPendingCheckoutItemId: payload.localPendingCheckoutItemId,
        localRegisterSessionId: args.event.localRegisterSessionId,
      },
    });
    return conflictResult(conflict);
  }

  let pendingItem: Awaited<
    ReturnType<SyncProjectionRepository["createOrReusePendingCheckoutItem"]>
  >;
  try {
    pendingItem = await repository.createOrReusePendingCheckoutItem({
      storeId: args.storeId,
      createdByUserId: args.submittedByUserId,
      createdByStaffProfileId: args.event.staffProfileId,
      name: payload.name,
      lookupCode: payload.lookupCode,
      price: payload.price,
      quantitySold: payload.quantitySold,
      registerSessionId: registerSession._id,
      terminalId: args.terminalId,
      localEventId: args.event.localEventId,
      source: "offline_sync",
      timestamp: args.event.occurredAt,
    });
  } catch (error) {
    const conflict = await createConflict(repository, args, {
      conflictType: "inventory",
      summary:
        error instanceof Error
          ? error.message
          : "Pending checkout item could not be created.",
      details: {
        localPendingCheckoutItemId: payload.localPendingCheckoutItemId,
        lookupCode: payload.lookupCode,
        blocksProjection: true,
      },
    });
    return conflictResult(conflict);
  }
  const mapping = await createMapping(repository, args, {
    localIdKind: "pendingCheckoutItem",
    localId: payload.localPendingCheckoutItemId,
    cloudTable: "posPendingCheckoutItem",
    cloudId: pendingItem.pendingCheckoutItemId,
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

  const inventoryValidation = await validateSaleInventory(
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
	    inventoryValidation,
	    payload: validation.payload,
	    sale,
	    saleSession,
	    session: sessionResolution,
	    store: validation.store,
	  });
  const serviceProjection = await persistSaleServiceLines(repository, args, {
    payload: validation.payload,
    payments,
    sale,
    serviceLinesByLocalId: validation.catalogValidation.serviceLinesByLocalId,
    store: validation.store,
  });
  const paymentMappings = await persistPaymentAllocations(repository, args, {
    payments,
    sale,
    session: sessionResolution,
    store: validation.store,
  });

  await recordSaleProjectedEvent(repository, args, {
    payments,
    payload: validation.payload,
    sale,
    session: sessionResolution,
    store: validation.store,
  });
  await recordSaleWorkflowEvidence(repository, args, {
    payments,
    payload: validation.payload,
    sale,
    saleSession,
    session: sessionResolution,
    store: validation.store,
  });

  const conflicts: LocalSyncConflictRecord[] = [
    ...(validation.catalogValidation.conflict
      ? [validation.catalogValidation.conflict]
      : []),
	    ...(inventoryValidation.conflict ? [inventoryValidation.conflict] : []),
    ...(payments.paymentConflict ? [payments.paymentConflict] : []),
  ];

  return {
    status: conflicts.length > 0 ? "conflicted" : "projected",
    mappings: [
      ...saleSession.posSessionMappings,
      sale.transactionMapping,
      sale.receiptMapping,
      ...itemMappings,
      ...serviceProjection.mappings,
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

  const reviewedConflictIds = new Set(args.options?.reviewedConflictIds ?? []);
  const eventConflicts = await repository.listConflictsForEvent({
    localEventId: args.event.localEventId,
    storeId: args.storeId,
    terminalId: args.terminalId,
  });
  const existingConflicts = eventConflicts.filter(
    (conflict) =>
      conflict.status === "needs_review" &&
      !reviewedConflictIds.has(conflict._id) &&
      !reviewedConflictIds.has(conflict.localEventId),
  );
  const reviewedInventoryConflicts = eventConflicts.filter(
    (conflict) =>
      conflict.status === "needs_review" &&
      conflict.conflictType === "inventory" &&
      (reviewedConflictIds.has(conflict._id) ||
        reviewedConflictIds.has(conflict.localEventId)),
  );

  if (
    args.options?.allowReviewedInventorySaleProjection === true &&
    existingConflicts.length === 0 &&
    reviewedInventoryConflicts.length > 0
  ) {
    const existingSaleInventoryProjection =
      await createSkippedInventoryReviewForExistingSale(repository, args, {
        transactionMapping: existingTransaction,
      });
    if (existingSaleInventoryProjection) {
      return existingSaleInventoryProjection;
    }
  }

  return {
    status: existingConflicts.length > 0 ? "conflicted" : "projected",
    mappings: await collectExistingSaleMappings(repository, args),
    conflicts: existingConflicts,
  };
}

async function createSkippedInventoryReviewForExistingSale(
  repository: SyncProjectionRepository,
  args: SaleCompletedArgs,
  input: {
    transactionMapping: LocalSyncMappingRecord;
  },
): Promise<ProjectionResult | null> {
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

  const inventoryValidation = await validateSaleInventory(
    repository,
    args,
    validation.payload,
    sessionResolution.existingPosSession?._id,
  );
  if (inventoryValidation.conflict) {
    return conflictResult(inventoryValidation.conflict);
  }
  if (inventoryValidation.stockMutationAllowed) {
    return null;
  }

  await createSkippedInventoryReviewWorkItem(repository, args, {
    inventoryValidation,
    payload: validation.payload,
    sale: {
      receiptMapping: input.transactionMapping,
      registerSessionId: sessionResolution.registerSession._id,
      transactionId: input.transactionMapping.cloudId as Id<"posTransaction">,
      transactionMapping: input.transactionMapping,
    },
    session: sessionResolution,
    store: validation.store,
  });
  return null;
}

async function validateSaleCompletedInputs(
  repository: SyncProjectionRepository,
  args: SaleCompletedArgs,
): Promise<SaleValidationContext | ProjectionResult> {
  const payload = getSalePayload(args.event);
  const store = await repository.getStore(args.storeId);
  const terminal = await repository.getTerminal(args.terminalId);

  if ((payload.serviceLines?.length ?? 0) > 0 && !store?.organizationId) {
    const conflict = await createConflict(repository, args, {
      conflictType: "permission",
      summary: "Store reference is missing for synced service sale.",
      details: {
        localTransactionId: payload.localTransactionId,
      },
    });
    return conflictResult(conflict);
  }

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
    localRegisterSessionId: args.event.localRegisterSessionId ?? "",
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

  const registerSessionSaleUsable = isRegisterSessionSaleUsable(registerSession);
  const reviewedClosingRegisterSaleAllowed =
    args.options?.allowReviewedClosingRegisterSaleProjection === true &&
    registerSession.status === "closing";

  if (
    registerSessionSaleUsable &&
    (
      await getOpenRegisterCloseoutReviewState(repository, args, {
        registerSessionId: registerSession._id,
      })
    ).hasOpenRegisterCloseoutReview
  ) {
    const conflict = await createConflict(repository, args, {
      conflictType: "permission",
      summary: "Register session mapping points to a reviewed closeout.",
      details: {
        localRegisterSessionId: args.event.localRegisterSessionId,
        localTransactionId: payload.localTransactionId,
        registerSessionId: registerSession._id,
      },
    });
    return conflictResult(conflict);
  }

  if (!registerSessionSaleUsable && !reviewedClosingRegisterSaleAllowed) {
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
    localRegisterSessionId: args.event.localRegisterSessionId ?? "",
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
    const existingTransactionMapping = await findMappingForTerminal(
      repository,
      args,
      {
        localIdKind: "transaction",
        localId: payload.localTransactionId,
      },
    );
    const isSameSyncedSale =
      existingTransactionMapping?.localEventId === args.event.localEventId &&
      existingTransactionMapping.cloudId === existingPosSession.transactionId;

    if (!isSameSyncedSale) {
      if (
        args.options?.allowReviewedDuplicatePosSessionSaleProjection === true
      ) {
        return {
          existingPosSession: null,
          existingPosSessionMapping: null,
          preserveSaleWithoutPosSession: true,
          registerSession,
          resolvedRegisterNumber,
        };
      }

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
    localRegisterSessionId: args.event.localRegisterSessionId ?? "",
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
    localRegisterSessionId: args.event.localRegisterSessionId ?? "",
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
  await repository.recordPosSessionWorkflowTrace?.({
    stage: "voided",
    session: {
      ...existingPosSession,
      status: "void",
      notes: args.event.payload.reason,
      updatedAt: args.event.occurredAt,
    } as never,
    occurredAt: args.event.occurredAt,
    voidReason: args.event.payload.reason,
  });

  return { status: "projected", mappings: [mapping], conflicts: [] };
}

async function calculateSalePayments(
  repository: SyncProjectionRepository,
  args: SaleCompletedArgs,
  payload: PosLocalSalePayload,
): Promise<SalePaymentCalculation> {
  const rawValidPayments = payload.payments.filter(isValidPayment);
  const rawTotalPaid = sumPaymentAmounts(rawValidPayments);
  const rawNonCashPaid = sumPaymentAmounts(
    rawValidPayments.filter((payment) => payment.method !== "cash"),
  );
  const appliesReviewedNonCashOverpayment =
    args.options?.applyExpectedTotalForReviewedNonCashOverpayment === true &&
    rawValidPayments.length === payload.payments.length &&
    rawTotalPaid >= payload.totals.total &&
    rawNonCashPaid > payload.totals.total;
  const validPayments = appliesReviewedNonCashOverpayment
    ? capNonCashPaymentsToExpectedTotal(rawValidPayments, payload.totals.total)
    : rawValidPayments;
  const totalPaid = validPayments.reduce(
    (sum, payment) => sum + Math.max(0, payment.amount),
    0,
  );
  const nonCashPaid = validPayments
    .filter((payment) => payment.method !== "cash")
    .reduce((sum, payment) => sum + payment.amount, 0);
  const paymentConflict =
    (!appliesReviewedNonCashOverpayment &&
      validPayments.length !== payload.payments.length) ||
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
  const allocationPlan = planSalePaymentAllocations({
    changeGiven,
    payload,
    payments: validPayments,
  });

  return {
    changeGiven,
    expectedCashDelta: Math.max(0, cashCollected - (changeGiven ?? 0)),
    paymentConflict,
    primaryPaymentMethod: validPayments[0]?.method,
    retailAllocations: allocationPlan.retailAllocations,
    serviceAllocationsByLineKey: allocationPlan.serviceAllocationsByLineKey,
    totalPaid,
    transactionPayments: validPayments.map(({ method, amount, timestamp }) => ({
      method,
      amount,
      timestamp,
    })),
    validPayments,
  };
}

function sumPaymentAmounts(payments: PosLocalSalePayload["payments"]) {
  return roundMoney(
    payments.reduce((sum, payment) => sum + Math.max(0, payment.amount), 0),
  );
}

function capNonCashPaymentsToExpectedTotal(
  payments: PosLocalSalePayload["payments"],
  expectedTotal: number,
) {
  let remaining = roundMoney(Math.max(0, expectedTotal));
  const cappedPayments: PosLocalSalePayload["payments"] = [];

  for (const payment of payments) {
    if (payment.method === "cash") {
      continue;
    }

    if (remaining <= 0) {
      break;
    }

    const amount = roundMoney(Math.min(Math.max(0, payment.amount), remaining));
    if (amount <= 0) {
      continue;
    }

    cappedPayments.push({
      ...payment,
      amount,
    });
    remaining = roundMoney(remaining - amount);
  }

  return cappedPayments;
}

function planSalePaymentAllocations(args: {
  changeGiven?: number;
  payload: PosLocalSalePayload;
  payments: PosLocalSalePayload["payments"];
}) {
  const normalizedPayments = normalizeLocalSalePayments({
    changeGiven: args.changeGiven,
    payments: args.payments,
  });
  const serviceLines = args.payload.serviceLines ?? [];
  const serviceTargets = serviceLines.map((line, index) => ({
    lineKey: serviceLineKey(line, index),
    remaining: roundMoney(line.totalPrice),
  }));
  let retailRemaining = roundMoney(
    args.payload.totals.total -
      serviceTargets.reduce((sum, target) => sum + target.remaining, 0),
  );
  const retailAllocations: PlannedPaymentAllocation[] = [];
  const serviceAllocationsByLineKey = new Map<string, PlannedPaymentAllocation[]>();

  for (const payment of normalizedPayments) {
    let remainingPayment = roundMoney(payment.amount);
    if (retailRemaining > 0 && remainingPayment > 0) {
      const amount = roundMoney(Math.min(retailRemaining, remainingPayment));
      retailAllocations.push({ ...payment, amount });
      retailRemaining = roundMoney(retailRemaining - amount);
      remainingPayment = roundMoney(remainingPayment - amount);
    }

    for (const target of serviceTargets) {
      if (remainingPayment <= 0) break;
      if (target.remaining <= 0) continue;
      const amount = roundMoney(Math.min(target.remaining, remainingPayment));
      const allocations = serviceAllocationsByLineKey.get(target.lineKey) ?? [];
      allocations.push({ ...payment, amount });
      serviceAllocationsByLineKey.set(target.lineKey, allocations);
      target.remaining = roundMoney(target.remaining - amount);
      remainingPayment = roundMoney(remainingPayment - amount);
    }
  }

  return { retailAllocations, serviceAllocationsByLineKey };
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
  if (session.preserveSaleWithoutPosSession) {
    return {
      posSessionMappings: [],
      reusedExistingSession: false,
    };
  }

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
    transactionNumber: payload.receiptNumber,
    storeId: args.storeId,
    ...(saleSession.posSessionId ? { sessionId: saleSession.posSessionId } : {}),
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
  if (saleSession.posSessionId) {
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
  }

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

  return {
    receiptMapping,
    registerSessionId: session.registerSession._id,
    transactionId,
    transactionMapping,
  };
}

async function persistSaleItemsAndInventory(
  repository: SyncProjectionRepository,
  args: SaleCompletedArgs,
	  input: {
	    catalogItemsByLocalId: Map<string, CanonicalSaleItem>;
	    inventoryValidation: SaleInventoryValidation;
	    payload: PosLocalSalePayload;
	    sale: PersistedSale;
	    saleSession: PersistedSaleSession;
	    session: SaleSessionResolution;
	    store: StoreRecord;
	  },
	): Promise<LocalSyncMappingRecord[]> {
	  const { catalogItemsByLocalId, inventoryValidation, payload, sale, saleSession } =
	    input;
	  const itemMappings: LocalSyncMappingRecord[] = [];
	  const consumedHoldQuantities =
    inventoryValidation.stockMutationAllowed &&
    saleSession.reusedExistingSession &&
    saleSession.posSessionId
      ? await repository.consumeInventoryHoldsForSession({
          sessionId: saleSession.posSessionId,
        items: trustedInventorySaleItems(payload).map((item) => ({
          productSkuId: item.productSkuId as Id<"productSku">,
          quantity: item.quantity,
        })),
        now: args.event.occurredAt,
      })
    : new Map<Id<"productSku">, number>();
  const pendingEvidenceByItemId = new Map<
    Id<"posPendingCheckoutItem">,
    {
      lookupCode?: string;
      pendingCheckoutItemId: Id<"posPendingCheckoutItem">;
      price: number;
      quantitySold: number;
    }
  >();
  const provisionalImportEvidenceById = new Map<
    string,
    { inventoryImportProvisionalSkuId: string; quantitySold: number }
  >();

  for (const item of payload.items) {
    const productId = item.productId as Id<"product">;
    const productSkuId = item.productSkuId as Id<"productSku">;
    const canonicalItem = catalogItemsByLocalId.get(
      item.localTransactionItemId ?? item.productSkuId,
    );
    if (!saleSession.reusedExistingSession && saleSession.posSessionId) {
      await repository.createPosSessionItem({
        sessionId: saleSession.posSessionId,
        storeId: args.storeId,
        productId,
        productSkuId,
        pendingCheckoutItemId: item.pendingCheckoutItemId as
          | Id<"posPendingCheckoutItem">
          | undefined,
        inventoryImportProvisionalSkuId: item.inventoryImportProvisionalSkuId,
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
      productId,
      productSkuId,
      pendingCheckoutItemId: item.pendingCheckoutItemId as
        | Id<"posPendingCheckoutItem">
        | undefined,
      inventoryImportProvisionalSkuId: item.inventoryImportProvisionalSkuId,
      productName: canonicalItem?.productName ?? item.productName,
      productSku: canonicalItem?.productSku ?? item.productSku,
      barcode: canonicalItem?.barcode,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.quantity * item.unitPrice,
      image: canonicalItem?.image,
    });

    if (item.pendingCheckoutItemId) {
      const pendingCheckoutItemId =
        item.pendingCheckoutItemId as Id<"posPendingCheckoutItem">;
      const existingEvidence = pendingEvidenceByItemId.get(
        pendingCheckoutItemId,
      );
      pendingEvidenceByItemId.set(pendingCheckoutItemId, {
        lookupCode: existingEvidence?.lookupCode ?? canonicalItem?.barcode,
        pendingCheckoutItemId,
        price: existingEvidence?.price ?? item.unitPrice,
        quantitySold: (existingEvidence?.quantitySold ?? 0) + item.quantity,
      });
    }

    if (item.inventoryImportProvisionalSkuId) {
      const existingEvidence = provisionalImportEvidenceById.get(
        item.inventoryImportProvisionalSkuId,
      );
      provisionalImportEvidenceById.set(item.inventoryImportProvisionalSkuId, {
        inventoryImportProvisionalSkuId: item.inventoryImportProvisionalSkuId,
        quantitySold: (existingEvidence?.quantitySold ?? 0) + item.quantity,
      });
    }

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

  for (const evidence of pendingEvidenceByItemId.values()) {
    await repository.recordPendingCheckoutItemSaleEvidence({
      actorStaffProfileId: args.event.staffProfileId,
      actorUserId: args.submittedByUserId,
      localEventId: args.event.localEventId,
      lookupCode: evidence.lookupCode,
      pendingCheckoutItemId: evidence.pendingCheckoutItemId,
      posTransactionId: sale.transactionId,
      price: evidence.price,
      quantitySold: evidence.quantitySold,
      registerSessionId: sale.registerSessionId,
      source: "offline_sync",
      storeId: args.storeId,
      terminalId: args.terminalId,
      timestamp: args.event.occurredAt,
    });
  }

  for (const evidence of provisionalImportEvidenceById.values()) {
    await repository.recordInventoryImportProvisionalSkuSaleEvidence({
      inventoryImportProvisionalSkuId: evidence.inventoryImportProvisionalSkuId,
      posTransactionId: sale.transactionId,
      quantitySold: evidence.quantitySold,
      registerSessionId: sale.registerSessionId,
      timestamp: args.event.occurredAt,
    });
  }

  if (!inventoryValidation.stockMutationAllowed) {
    await createSkippedInventoryReviewWorkItem(repository, args, {
      inventoryValidation,
      payload,
      sale,
      session: input.session,
      store: input.store,
    });
    return itemMappings;
  }

  for (const [productSkuId, requestedQuantity] of collectSaleSkuQuantities(
    payload,
  )) {
    const sku = await repository.getProductSku(productSkuId);
    if (!sku) continue;

    const movementDisposition = await repository.recordSaleInventoryMovement({
      customerProfileId: input.session.existingPosSession?.customerProfileId,
      organizationId: input.store?.organizationId,
      posTransactionId: sale.transactionId,
      productId: sku.productId,
      productSkuId,
      quantity: requestedQuantity,
      registerSessionId: sale.registerSessionId,
      staffProfileId: args.event.staffProfileId,
      storeId: args.storeId,
      transactionNumber: payload.receiptNumber,
    });

    if (movementDisposition === "inserted") {
      await repository.patchProductSku(productSkuId, {
        inventoryCount: Math.max(0, sku.inventoryCount - requestedQuantity),
        quantityAvailable: Math.max(
          0,
          sku.quantityAvailable - requestedQuantity,
        ),
      });
    }
  }

  return itemMappings;
}

async function createSkippedInventoryReviewWorkItem(
  repository: SyncProjectionRepository,
  args: SaleCompletedArgs,
  input: {
    inventoryValidation: SaleInventoryValidation;
    payload: PosLocalSalePayload;
    sale: PersistedSale;
    session: SaleSessionResolution;
    store: StoreRecord;
  },
) {
  if (!input.store?.organizationId) {
    return;
  }

  const trustedLines = trustedInventorySaleItems(input.payload).map((item) => ({
    localTransactionItemId: item.localTransactionItemId,
    productId: item.productId,
    productName: item.productName,
    productSku: item.productSku,
    productSkuId: item.productSkuId,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
  }));
  if (trustedLines.length === 0) {
    return;
  }

  const primarySkippedItem = input.inventoryValidation.skippedMutationItems[0];
  const primaryProductName =
    primarySkippedItem?.productName ?? trustedLines[0]?.productName;
	  const title = primaryProductName
	    ? `Review inventory for ${primaryProductName}`
	    : `Review inventory for sale #${input.payload.receiptNumber}`;
	  const sourceType = "posTransaction";
	  const localInventoryReviewWorkItemId = [
	    input.payload.localTransactionId,
	    "inventory-review",
	  ].join(":");
	  const existingWorkItemMapping = await repository.findMapping({
	    localId: localInventoryReviewWorkItemId,
	    localIdKind: "inventoryReviewWorkItem",
	    localRegisterSessionId: args.event.localRegisterSessionId,
	    storeId: args.storeId,
	    terminalId: args.terminalId,
	  });
	  if (existingWorkItemMapping) {
	    return;
	  }

	  const workItemId = await repository.createServiceWorkItem({
    approvalState: "not_required",
    createdByStaffProfileId:
      args.options?.reviewActorStaffProfileId ?? args.event.staffProfileId,
    createdByUserId: args.submittedByUserId,
    metadata: {
      localEventId: args.event.localEventId,
      localRegisterSessionId: args.event.localRegisterSessionId,
      localTransactionId: input.payload.localTransactionId,
      primaryProductSkuId:
        primarySkippedItem?.productSkuId ?? trustedLines[0]?.productSkuId,
      receiptNumber: input.payload.receiptNumber,
      registerSessionId: input.session.registerSession._id,
      skippedMutationItems: input.inventoryValidation.skippedMutationItems,
      sourceId: input.sale.transactionId,
      sourceType,
      terminalId: args.terminalId,
      trustedInventoryLines: trustedLines,
    },
    notes:
      "Synced sale activity was retained from cash controls. Inventory was not decremented because stock availability still needs correction.",
    organizationId: input.store.organizationId,
    priority: "high",
    status: "open",
    storeId: args.storeId,
	    title,
	    type: "synced_sale_inventory_review",
	  });
	  await createMapping(repository, args, {
	    cloudId: workItemId,
	    cloudTable: "operationalWorkItem",
	    localId: localInventoryReviewWorkItemId,
	    localIdKind: "inventoryReviewWorkItem",
	  });
	}

async function persistSaleServiceLines(
  repository: SyncProjectionRepository,
  args: SaleCompletedArgs,
  input: {
    payload: PosLocalSalePayload;
    payments: SalePaymentCalculation;
    sale: PersistedSale;
    serviceLinesByLocalId: Map<string, CanonicalServiceLine>;
    store: StoreRecord;
  },
): Promise<{
  mappings: LocalSyncMappingRecord[];
  serviceLines: PersistedServiceLine[];
}> {
  const mappings: LocalSyncMappingRecord[] = [];
  const serviceLines: PersistedServiceLine[] = [];
  const mappedServicePaymentIds = new Set<string>();
  const retailMappedPaymentIds = new Set(
    input.payments.retailAllocations.flatMap((payment) =>
      payment.localPaymentId ? [payment.localPaymentId] : [],
    ),
  );

  for (const [index, line] of (input.payload.serviceLines ?? []).entries()) {
    const lineKey = serviceLineKey(line, index);
    const canonicalLine = input.serviceLinesByLocalId.get(lineKey);
    const existingServiceCase = line.existingServiceCaseId
      ? await repository.getServiceCase(line.existingServiceCaseId)
      : null;
    const customerProfileId =
      existingServiceCase?.customerProfileId ??
      line.customerProfileId ??
      input.payload.customerProfileId;
    if (!customerProfileId) continue;

    const serviceCaseId =
      existingServiceCase?._id ??
      (await createProjectedServiceCase(repository, args, {
        customerProfileId,
        line,
        lineKey,
        serviceCatalogName:
          canonicalLine?.serviceCatalogName ?? line.serviceCatalogName,
        store: input.store,
      }));
    const serviceCase = existingServiceCase ?? (await repository.getServiceCase(serviceCaseId));
    const workItemId = serviceCase?.operationalWorkItemId;
    const serviceCaseLineItemId = await repository.createServiceCaseLineItem({
      serviceCaseId,
      lineType: "labor",
      description: canonicalLine?.serviceCatalogName ?? line.serviceCatalogName,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      amount: line.totalPrice,
      notes: `Synced from POS receipt ${input.payload.receiptNumber}.`,
      createdAt: args.event.occurredAt,
    });
    const transactionServiceLineId =
      await repository.createTransactionServiceLine({
        transactionId: input.sale.transactionId,
        serviceCaseId,
        serviceCatalogId: line.serviceCatalogId,
        serviceName: canonicalLine?.serviceCatalogName ?? line.serviceCatalogName,
        serviceMode: canonicalLine?.serviceMode ?? line.serviceMode,
        pricingSource:
          line.pricingModel === "fixed"
            ? "catalog_base_price"
            : line.existingServiceCaseId
              ? "service_case_quote"
              : "pos_entered",
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        totalPrice: line.totalPrice,
        notes: `Synced from POS receipt ${input.payload.receiptNumber}.`,
      });

    if (line.localServiceCaseId) {
      mappings.push(
        await createMapping(repository, args, {
          localIdKind: "serviceCase",
          localId: line.localServiceCaseId,
          cloudTable: "serviceCase",
          cloudId: serviceCaseId,
        }),
      );
    }
    if (line.localServiceLineId) {
      mappings.push(
        await createMapping(repository, args, {
          localIdKind: "serviceLine",
          localId: line.localServiceLineId,
          cloudTable: "serviceCaseLineItem",
          cloudId: serviceCaseLineItemId,
        }),
      );
    }

    for (const payment of input.payments.serviceAllocationsByLineKey.get(lineKey) ??
      []) {
      const allocationId = await repository.createPaymentAllocation({
        storeId: args.storeId,
        organizationId: input.store?.organizationId,
        targetType: "service_case",
        targetId: serviceCaseId,
        allocationType: "service_payment",
        direction: "in",
        method: payment.method,
        amount: payment.amount,
        status: "recorded",
        collectedInStore: true,
        recordedAt: payment.timestamp,
        actorStaffProfileId: args.event.staffProfileId,
        customerProfileId,
        workItemId,
        registerSessionId: input.sale.registerSessionId,
        posTransactionId: input.sale.transactionId,
        externalReference: payment.localPaymentId
          ? `${payment.localPaymentId}:${lineKey}`
          : undefined,
        notes: "Synced from offline POS service sale.",
      });
      if (
        payment.localPaymentId &&
        !retailMappedPaymentIds.has(payment.localPaymentId) &&
        !mappedServicePaymentIds.has(payment.localPaymentId)
      ) {
        mappings.push(
          await createMapping(repository, args, {
            localIdKind: "payment",
            localId: payment.localPaymentId,
            cloudTable: "paymentAllocation",
            cloudId: allocationId,
          }),
        );
        mappedServicePaymentIds.add(payment.localPaymentId);
      }
    }

    await repository.syncServiceCaseFinancials(serviceCaseId);
    serviceLines.push({
      line,
      lineKey,
      serviceCaseId,
      serviceCaseLineItemId,
      transactionServiceLineId,
      workItemId,
      customerProfileId,
    });
  }

  return { mappings, serviceLines };
}

async function createProjectedServiceCase(
  repository: SyncProjectionRepository,
  args: SaleCompletedArgs,
  input: {
    customerProfileId: Id<"customerProfile">;
    line: NonNullable<PosLocalSalePayload["serviceLines"]>[number];
    lineKey: string;
    serviceCatalogName: string;
    store: StoreRecord;
  },
) {
  const workItemId = await repository.createServiceWorkItem({
    storeId: args.storeId,
    organizationId: input.store?.organizationId as Id<"organization">,
    type: "service_case",
    status: "open",
    priority: "normal",
    approvalState: "not_required",
    title: input.serviceCatalogName,
    metadata: {
      localEventId: args.event.localEventId,
      localServiceLineId: input.line.localServiceLineId,
      serviceCatalogId: input.line.serviceCatalogId,
      source: "pos_local_sync",
    },
    createdByStaffProfileId: args.event.staffProfileId,
    customerProfileId: input.customerProfileId,
  });

  return repository.createServiceCase({
    customerProfileId: input.customerProfileId,
    operationalWorkItemId: workItemId,
    organizationId: input.store?.organizationId,
    quotedAmount: input.line.totalPrice,
    serviceCatalogId: input.line.serviceCatalogId,
    serviceMode: input.line.serviceMode,
    storeId: args.storeId,
  });
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

  for (const payment of payments.retailAllocations) {
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

  if (
    payments.expectedCashDelta > 0 &&
    (isRegisterSessionSaleUsable(session.registerSession) ||
      (args.options?.allowReviewedClosingRegisterSaleProjection === true &&
        session.registerSession.status === "closing"))
  ) {
    const expectedCash =
      session.registerSession.expectedCash + payments.expectedCashDelta;
    const variance =
      session.registerSession.status === "closed" &&
      typeof session.registerSession.countedCash === "number"
        ? session.registerSession.countedCash - expectedCash
        : undefined;
    await repository.patchRegisterSession(session.registerSession._id, {
      expectedCash,
      ...(variance === undefined ? {} : { variance }),
    });
  }

  return paymentMappings;
}

function recordSaleProjectedEvent(
  repository: SyncProjectionRepository,
  args: SaleCompletedArgs,
  input: {
    payments: SalePaymentCalculation;
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
    message: buildSaleProjectedMessage({
      currency: input.store?.currency,
      payments: input.payments,
      payload: input.payload,
    }),
    metadata: {
      cashDelta: input.payments.expectedCashDelta,
      lineCount: getSaleLineCount(input.payload),
      localEventId: args.event.localEventId,
      localReceiptNumber: input.payload.localReceiptNumber,
      paymentCount: input.payments.validPayments.length,
      paymentMethods: getPaymentMethodLabels(input.payments.validPayments),
      receiptNumber: input.payload.receiptNumber,
      saleTotal: input.payload.totals.total,
      syncOrigin: "local_sync",
      total: input.payload.totals.total,
      transactionNumber: input.payload.receiptNumber,
    },
    createdAt: args.event.occurredAt,
    actorStaffProfileId: args.event.staffProfileId,
    localEventId: args.event.localEventId,
    registerSessionId: input.session.registerSession._id,
    terminalId: args.terminalId,
    posTransactionId: input.sale.transactionId,
  });
}

function buildSaleProjectedMessage(args: {
  currency?: string;
  payments: SalePaymentCalculation;
  payload: PosLocalSalePayload;
}) {
  const receiptNumber =
    args.payload.receiptNumber?.trim() ||
    args.payload.localReceiptNumber?.trim();
  const transactionLabel = receiptNumber ? ` #${receiptNumber}` : "";
  const lineCount = getSaleLineCount(args.payload);
  const paymentLabel = getPaymentSummaryLabel(args.payments.validPayments);

  return [
    `Sale${transactionLabel} synced: ${formatSaleLineCount(lineCount)}`,
    formatSaleTotal(args.currency, args.payload.totals.total),
    paymentLabel,
  ].join(", ") + ".";
}

function getSaleLineCount(payload: PosLocalSalePayload) {
  return payload.items.length + (payload.serviceLines?.length ?? 0);
}

function formatSaleLineCount(lineCount: number) {
  return lineCount === 1 ? "1 sale line" : `${lineCount} sale lines`;
}

function formatSaleTotal(currency: string | undefined, amount: number) {
  const displayAmount = toDisplayAmount(amount);
  const storeCurrency = currency?.trim() || "GHS";

  try {
    return currencyFormatter(storeCurrency).format(displayAmount);
  } catch (error) {
    console.error("[pos-sync] sale.projected.currency-format", {
      currency: storeCurrency,
      error,
    });

    return currencyFormatter("GHS").format(displayAmount);
  }
}

function formatTerminalRegisterLabel(args: {
  registerNumber?: string;
  terminalName?: string;
}) {
  const terminalName = args.terminalName?.trim();
  const registerNumber = formatRegisterNumberValue(args.registerNumber);

  if (terminalName && registerNumber) {
    return `${terminalName} / Register ${registerNumber}`;
  }

  if (registerNumber) {
    return `Register ${registerNumber}`;
  }

  return "Register";
}

function formatRegisterNumberValue(registerNumber?: string) {
  const trimmed = registerNumber?.trim();
  if (!trimmed) return undefined;

  const withoutPrefix = trimmed.replace(/^register\b\s*/i, "").trim();
  return withoutPrefix || trimmed;
}

function getPaymentMethodLabels(payments: PosLocalSalePayload["payments"]) {
  return Array.from(
    new Set(
      payments
        .map((payment) => formatPaymentMethod(payment.method))
        .filter(Boolean),
    ),
  );
}

function getPaymentSummaryLabel(payments: PosLocalSalePayload["payments"]) {
  const labels = getPaymentMethodLabels(payments);

  if (labels.length === 0) {
    return "payment needs review";
  }

  if (labels.length === 1) {
    return labels[0];
  }

  return formatPaymentMethodList(labels);
}

function formatPaymentMethodList(labels: string[]) {
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }

  const lastLabel = labels[labels.length - 1];
  const leadingLabels = labels.slice(0, -1).join(", ");

  return `${leadingLabels}, and ${lastLabel}`;
}

function formatPaymentMethod(method: string) {
  const normalized = method.trim().toLowerCase();

  if (normalized === "mobile_money") return "mobile money";
  if (normalized === "card") return "card";
  if (normalized === "cash") return "cash";

  return normalized.replaceAll("_", " ");
}

async function recordSaleWorkflowEvidence(
  repository: SyncProjectionRepository,
  args: SaleCompletedArgs,
  input: {
    payments: SalePaymentCalculation;
    payload: PosLocalSalePayload;
    sale: PersistedSale;
    saleSession: PersistedSaleSession;
    session: SaleSessionResolution;
    store: StoreRecord;
  },
) {
  if (input.saleSession.posSessionId) {
    await repository.recordPosSessionWorkflowTrace?.({
      stage: "completed",
      session: {
        ...(input.session.existingPosSession ?? {}),
        _id: input.saleSession.posSessionId,
        sessionNumber: input.payload.localPosSessionId,
        storeId: args.storeId,
        staffProfileId: args.event.staffProfileId,
        customerProfileId: input.payload.customerProfileId,
        customerInfo: input.payload.customerInfo,
        terminalId: args.terminalId,
        registerNumber: input.session.resolvedRegisterNumber,
        registerSessionId: input.session.registerSession._id,
        status: "completed",
        transactionId: input.sale.transactionId,
        createdAt:
          input.session.existingPosSession?.createdAt ?? args.event.occurredAt,
        updatedAt: args.event.occurredAt,
        expiresAt:
          input.session.existingPosSession?.expiresAt ?? args.event.occurredAt,
        completedAt: args.event.occurredAt,
        subtotal: input.payload.totals.subtotal,
        tax: input.payload.totals.tax,
        total: input.payload.totals.total,
        payments: input.payments.transactionPayments,
        inventoryHoldMode: "ledger",
      } as never,
      occurredAt: args.event.occurredAt,
      transactionId: input.sale.transactionId,
      paymentMethod: input.payments.primaryPaymentMethod,
      amount: input.payload.totals.total,
      paymentCount: input.payments.transactionPayments.length,
    });
  }

  const registerSessionTraceResult =
    await repository.recordRegisterSessionWorkflowTrace?.({
      stage: "sale_recorded",
      session: input.session.registerSession,
      occurredAt: args.event.occurredAt,
      amount: input.payments.expectedCashDelta,
      cashDelta: input.payments.expectedCashDelta,
      paymentCount: input.payments.transactionPayments.length,
      paymentMethodLabels: getPaymentMethodLabels(input.payments.validPayments),
      saleTotal: input.payload.totals.total,
      syncOrigin: "local_sync",
      transactionId: input.sale.transactionId,
      transactionNumber: input.payload.receiptNumber,
      actorStaffProfileId: args.event.staffProfileId,
    });
  if (registerSessionTraceResult) {
    await persistRegisterSessionWorkflowTraceId(repository, {
      registerSessionId: input.session.registerSession._id,
      traceCreated: registerSessionTraceResult.traceCreated,
      traceId: registerSessionTraceResult.traceId,
      workflowTraceId: input.session.registerSession.workflowTraceId,
    });
  }
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
  const skippedMutationItems: SaleInventorySkippedMutationItem[] = [];
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

    const hasCatalogMismatch =
      !sku ||
      sku.storeId !== args.storeId ||
      (item && sku.productId !== item.productId);
    if (hasCatalogMismatch) {
      const conflict = await createConflict(repository, args, {
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
      return { conflict, skippedMutationItems, stockMutationAllowed: false };
    }

    const hasStockShortfall =
      sku.inventoryCount < requestedQuantity ||
      quantityAvailableAfterHolds < requestedQuantity;
    if (hasStockShortfall) {
      if (args.options?.allowReviewedInventorySaleProjection === true) {
        skippedMutationItems.push({
          activeHeldQuantity: heldQuantity,
          availableInventoryCount: sku.inventoryCount,
          productId: item?.productId as Id<"product"> | undefined,
          productName: item?.productName,
          productSku: item?.productSku,
          productSkuId,
          quantityAvailable: sku.quantityAvailable,
          quantityAvailableAfterHolds,
          reason: "stock_shortfall",
          requestedQuantity,
        });
        continue;
      }

      const conflict = await createConflict(repository, args, {
        conflictType: "inventory",
        summary: INVENTORY_CONFLICT_SUMMARY,
        details: {
          localTransactionId: payload.localTransactionId,
          productSkuId,
          requestedQuantity,
          activeHeldQuantity: heldQuantity,
          availableInventoryCount: sku.inventoryCount,
          quantityAvailable: sku.quantityAvailable,
          quantityAvailableAfterHolds,
        },
      });
      return { conflict, skippedMutationItems, stockMutationAllowed: false };
    }

    if (existingSessionHoldQuantities) {
      const heldForSession =
        existingSessionHoldQuantities.get(productSkuId) ?? 0;
      if (heldForSession < requestedQuantity) {
        if (args.options?.allowReviewedInventorySaleProjection === true) {
          skippedMutationItems.push({
            heldForSession,
            productId: item?.productId as Id<"product"> | undefined,
            productName: item?.productName,
            productSku: item?.productSku,
            productSkuId,
            reason: "existing_pos_session_hold_expired",
            requestedQuantity,
          });
          continue;
        }

        const conflict = await createConflict(repository, args, {
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
        return { conflict, skippedMutationItems, stockMutationAllowed: false };
      }
    }
  }

  return {
    conflict: null,
    skippedMutationItems,
    stockMutationAllowed: skippedMutationItems.length === 0,
  };
}

function collectSaleSkuQuantities(payload: PosLocalSalePayload) {
  const quantities = new Map<Id<"productSku">, number>();
  for (const item of trustedInventorySaleItems(payload)) {
    const productSkuId = item.productSkuId as Id<"productSku">;
    quantities.set(
      productSkuId,
      (quantities.get(productSkuId) ?? 0) + item.quantity,
    );
  }
  return quantities;
}

function trustedInventorySaleItems(payload: PosLocalSalePayload) {
  return payload.items.filter(
    (item) =>
      !item.pendingCheckoutItemId && !item.inventoryImportProvisionalSkuId,
  );
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

  for (const line of payload.serviceLines ?? []) {
    const lineCustomerProfileId = line.customerProfileId ?? payload.customerProfileId;
    if (!lineCustomerProfileId) {
      if (line.existingServiceCaseId) continue;
      return createConflict(repository, args, {
        conflictType: "permission",
        summary: "Service line is missing customer attribution.",
        details: {
          localTransactionId: payload.localTransactionId,
          localServiceLineId: line.localServiceLineId,
          serviceCatalogId: line.serviceCatalogId,
        },
      });
    }
    const lineCustomer = await repository.getCustomerProfile(lineCustomerProfileId);
    if (!lineCustomer || lineCustomer.storeId !== args.storeId) {
      return createConflict(repository, args, {
        conflictType: "permission",
        summary: "Service line customer reference is outside this store.",
        details: {
          localTransactionId: payload.localTransactionId,
          localServiceLineId: line.localServiceLineId,
          serviceCatalogId: line.serviceCatalogId,
          customerProfileId: lineCustomerProfileId,
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
  const serviceLinesByLocalId = new Map<string, CanonicalServiceLine>();
  const provisionalImportSkusByLocalId = new Map<
    string,
    NonNullable<
      Awaited<ReturnType<SyncProjectionRepository["getInventoryImportProvisionalSku"]>>
    >
  >();
  let priceConflict: LocalSyncConflictRecord | null = null;
  const dualSourceItem = payload.items.find(
    (item) => item.pendingCheckoutItemId && item.inventoryImportProvisionalSkuId,
  );
  if (dualSourceItem) {
    return {
      conflict: await createConflict(repository, args, {
        conflictType: "inventory",
        summary:
          "Synced sale line has conflicting pending checkout and provisional import sources.",
        details: {
          localTransactionId: payload.localTransactionId,
          localTransactionItemId: dualSourceItem.localTransactionItemId,
          pendingCheckoutItemId: dualSourceItem.pendingCheckoutItemId,
          inventoryImportProvisionalSkuId:
            dualSourceItem.inventoryImportProvisionalSkuId,
          productSkuId: dualSourceItem.productSkuId,
          blocksProjection: true,
        },
      }),
      itemsByLocalId,
      serviceLinesByLocalId,
    };
  }

  const mixedInventorySourceSkuId = findMixedTrustedAndProvisionalSkuId(payload);
  if (mixedInventorySourceSkuId) {
    return {
      conflict: await createConflict(repository, args, {
        conflictType: "inventory",
        summary:
          "Synced sale mixes provisional import and trusted inventory lines for the same SKU.",
        details: {
          localTransactionId: payload.localTransactionId,
          productSkuId: mixedInventorySourceSkuId,
          blocksProjection: true,
        },
      }),
      itemsByLocalId,
      serviceLinesByLocalId,
    };
  }

  for (const item of payload.items) {
    if (item.pendingCheckoutItemId) {
      const cloudPendingId =
        repository.normalizeCloudId(
          "posPendingCheckoutItem",
          item.pendingCheckoutItemId,
        ) ??
        (
          await findMappingForTerminal(repository, args, {
            localIdKind: "pendingCheckoutItem",
            localId: item.pendingCheckoutItemId,
          })
        )?.cloudId;

      if (!cloudPendingId) {
        return {
          conflict: await createConflict(repository, args, {
            conflictType: "inventory",
            summary: "Pending checkout item reference has not synced yet.",
            details: {
              localTransactionId: payload.localTransactionId,
              pendingCheckoutItemId: item.pendingCheckoutItemId,
              blocksProjection: true,
            },
          }),
          itemsByLocalId,
          serviceLinesByLocalId,
        };
      }

      item.pendingCheckoutItemId = cloudPendingId as Id<"posPendingCheckoutItem">;
      const pendingItem = await repository.getPendingCheckoutItem(
        item.pendingCheckoutItemId as Id<"posPendingCheckoutItem">,
      );
      if (
        !pendingItem ||
        pendingItem.storeId !== args.storeId ||
        !pendingItem.provisionalProductId ||
        !pendingItem.provisionalProductSkuId
      ) {
        return {
          conflict: await createConflict(repository, args, {
            conflictType: "inventory",
            summary: "Pending checkout item reference does not match this sale line.",
            details: {
              localTransactionId: payload.localTransactionId,
              pendingCheckoutItemId: item.pendingCheckoutItemId,
              productId: item.productId,
              productSkuId: item.productSkuId,
              blocksProjection: true,
            },
          }),
          itemsByLocalId,
          serviceLinesByLocalId,
        };
      }

      item.productId = pendingItem.provisionalProductId;
      item.productSkuId = pendingItem.provisionalProductSkuId;

      if (
        pendingItem.status !== "pending_review" &&
        pendingItem.status !== "flagged"
      ) {
        return {
          conflict: await createConflict(repository, args, {
            conflictType: "inventory",
            summary: "Pending checkout item reference does not match this sale line.",
            details: {
              localTransactionId: payload.localTransactionId,
              pendingCheckoutItemId: item.pendingCheckoutItemId,
              productId: item.productId,
              productSkuId: item.productSkuId,
              blocksProjection: false,
            },
          }),
          itemsByLocalId,
          serviceLinesByLocalId,
        };
      }
    }

    if (item.inventoryImportProvisionalSkuId) {
      const provisionalImportSku =
        await repository.getInventoryImportProvisionalSku(
          item.inventoryImportProvisionalSkuId,
        );
      if (
        !provisionalImportSku ||
        provisionalImportSku.storeId !== args.storeId ||
        provisionalImportSku.status !== "active" ||
        provisionalImportSku.posExposureStatus !== "available" ||
        provisionalImportSku.productId !== item.productId ||
        provisionalImportSku.productSkuId !== item.productSkuId
      ) {
        return {
          conflict: await createConflict(repository, args, {
            conflictType: "inventory",
            summary:
              "Provisional import row changed before this offline sale synced.",
            details: {
              localTransactionId: payload.localTransactionId,
              inventoryImportProvisionalSkuId:
                item.inventoryImportProvisionalSkuId,
              productId: item.productId,
              productSkuId: item.productSkuId,
              blocksProjection: true,
            },
          }),
          itemsByLocalId,
          serviceLinesByLocalId,
        };
      }
      provisionalImportSkusByLocalId.set(
        item.localTransactionItemId ?? item.productSkuId,
        provisionalImportSku,
      );
    }

    const [product, sku] = await Promise.all([
      repository.getProduct(item.productId as Id<"product">),
      repository.getProductSku(item.productSkuId as Id<"productSku">),
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
        serviceLinesByLocalId,
      };
    }
    const expectedUnitPrice =
      provisionalImportSkusByLocalId.get(
        item.localTransactionItemId ?? item.productSkuId,
      )?.importedPrice ??
      (typeof sku.netPrice === "number" ? sku.netPrice : sku.price);
    if (roundMoney(item.unitPrice) !== roundMoney(expectedUnitPrice)) {
      priceConflict ??= await createConflict(repository, args, {
        conflictType: "inventory",
        summary: "Product price changed before this offline sale synced.",
        details: {
          localTransactionId: payload.localTransactionId,
          productId: item.productId,
          productSkuId: item.productSkuId,
          submittedUnitPrice: item.unitPrice,
          catalogUnitPrice: expectedUnitPrice,
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

  for (const [index, line] of (payload.serviceLines ?? []).entries()) {
    const serviceCatalog = await repository.getServiceCatalog(
      line.serviceCatalogId,
    );
    if (
      !serviceCatalog ||
      serviceCatalog.storeId !== args.storeId ||
      serviceCatalog.status !== "active"
    ) {
      return {
        conflict: await createConflict(repository, args, {
          conflictType: "permission",
          summary: "Service catalog reference is outside this store.",
          details: {
            localTransactionId: payload.localTransactionId,
            serviceCatalogId: line.serviceCatalogId,
            blocksProjection: true,
          },
        }),
        itemsByLocalId,
        serviceLinesByLocalId,
      };
    }

    if (
      line.pricingModel !== serviceCatalog.pricingModel ||
      line.serviceMode !== serviceCatalog.serviceMode ||
      (line.catalogUpdatedAt !== undefined &&
        serviceCatalog.updatedAt > line.catalogUpdatedAt) ||
      (serviceCatalog.pricingModel === "fixed" &&
        roundMoney(line.unitPrice) !==
          roundMoney(serviceCatalog.basePrice ?? 0))
    ) {
      return {
        conflict: await createConflict(repository, args, {
          conflictType: "permission",
          summary: "Service catalog changed before this offline sale synced.",
          details: {
            localTransactionId: payload.localTransactionId,
            serviceCatalogId: line.serviceCatalogId,
            submittedPricingModel: line.pricingModel,
            catalogPricingModel: serviceCatalog.pricingModel,
            submittedUnitPrice: line.unitPrice,
            catalogBasePrice: serviceCatalog.basePrice ?? null,
            blocksProjection: true,
          },
        }),
        itemsByLocalId,
        serviceLinesByLocalId,
      };
    }

    if (
      line.pricingModel === "quote_after_consultation" &&
      !line.existingServiceCaseId &&
      line.totalPrice <= 0
    ) {
      return {
        conflict: await createConflict(repository, args, {
          conflictType: "permission",
          summary:
            "Quote-after-consultation service needs a collected amount or existing service case.",
          details: {
            localTransactionId: payload.localTransactionId,
            serviceCatalogId: line.serviceCatalogId,
            blocksProjection: true,
          },
        }),
        itemsByLocalId,
        serviceLinesByLocalId,
      };
    }

    if (line.existingServiceCaseId) {
      const serviceCase = await repository.getServiceCase(line.existingServiceCaseId);
      if (
        !serviceCase ||
        serviceCase.storeId !== args.storeId ||
        serviceCase.status === "completed" ||
        serviceCase.status === "cancelled"
      ) {
        return {
          conflict: await createConflict(repository, args, {
            conflictType: "permission",
            summary: "Service case is not available for synced POS service sale.",
            details: {
              localTransactionId: payload.localTransactionId,
              existingServiceCaseId: line.existingServiceCaseId,
              status: serviceCase?.status ?? null,
              blocksProjection: true,
            },
          }),
          itemsByLocalId,
          serviceLinesByLocalId,
        };
      }
      const lineCustomerProfileId =
        line.customerProfileId ?? payload.customerProfileId;
      if (
        lineCustomerProfileId &&
        serviceCase.customerProfileId !== lineCustomerProfileId
      ) {
        return {
          conflict: await createConflict(repository, args, {
            conflictType: "permission",
            summary:
              "Service case customer does not match the synced POS service sale.",
            details: {
              localTransactionId: payload.localTransactionId,
              existingServiceCaseId: line.existingServiceCaseId,
              customerProfileId: lineCustomerProfileId,
              serviceCaseCustomerProfileId: serviceCase.customerProfileId,
              blocksProjection: true,
            },
          }),
          itemsByLocalId,
          serviceLinesByLocalId,
        };
      }
    }

    serviceLinesByLocalId.set(serviceLineKey(line, index), {
      serviceCatalogName: serviceCatalog.name,
      serviceMode: serviceCatalog.serviceMode,
      pricingModel: serviceCatalog.pricingModel,
    });
  }

  return { conflict: priceConflict, itemsByLocalId, serviceLinesByLocalId };
}

function findMixedTrustedAndProvisionalSkuId(payload: PosLocalSalePayload) {
  const sourcesBySkuId = new Map<
    Id<"productSku">,
    { hasProvisionalImport: boolean; hasTrustedInventory: boolean }
  >();

  for (const item of payload.items) {
    const productSkuId = item.productSkuId as Id<"productSku">;
    const source = sourcesBySkuId.get(productSkuId) ?? {
      hasProvisionalImport: false,
      hasTrustedInventory: false,
    };
    if (item.inventoryImportProvisionalSkuId) {
      source.hasProvisionalImport = true;
    } else if (!item.pendingCheckoutItemId) {
      source.hasTrustedInventory = true;
    }
    sourcesBySkuId.set(productSkuId, source);
  }

  for (const [productSkuId, source] of sourcesBySkuId) {
    if (source.hasProvisionalImport && source.hasTrustedInventory) {
      return productSkuId;
    }
  }

  return null;
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
    ...(payload.serviceLines ?? [])
      .filter((line) => line.localServiceCaseId)
      .map((line) => ({
        localIdKind: "serviceCase" as const,
        localId: line.localServiceCaseId!,
      })),
    ...(payload.serviceLines ?? [])
      .filter((line) => line.localServiceLineId)
      .map((line) => ({
        localIdKind: "serviceLine" as const,
        localId: line.localServiceLineId!,
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
    localRegisterSessionId: args.event.localRegisterSessionId ?? "",
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
  const countedCash = payload.countedCash ?? registerSession.expectedCash;
  const variance = countedCash - registerSession.expectedCash;
  const isPendingReviewedCloseout =
    registerSession.status === "closing" &&
    typeof registerSession.countedCash === "number" &&
    typeof registerSession.variance === "number" &&
    roundMoney(registerSession.countedCash) === roundMoney(countedCash) &&
    roundMoney(registerSession.variance) === roundMoney(variance);
  if (
    registerSession.status !== "open" &&
    registerSession.status !== "active" &&
    !(
      isPendingReviewedCloseout &&
      args.options?.allowRegisterCloseoutVarianceProjection === true
    )
  ) {
    const isAlreadyAppliedCloseout =
      registerSession.status === "closed" &&
      typeof registerSession.countedCash === "number" &&
      typeof registerSession.variance === "number" &&
      roundMoney(registerSession.countedCash) === roundMoney(countedCash) &&
      roundMoney(registerSession.variance) === roundMoney(variance);

    if (isAlreadyAppliedCloseout) {
      const mapping = await createMapping(repository, args, {
        localIdKind: "closeout",
        localId: args.event.localEventId,
        cloudTable: "registerSession",
        cloudId: registerSession._id,
      });
      return { status: "projected", mappings: [mapping], conflicts: [] };
    }

    if (isPendingReviewedCloseout) {
      const existingVarianceConflict = (
        await repository.listConflictsForEvent({
          storeId: args.storeId,
          terminalId: args.terminalId,
          localEventId: args.event.localEventId,
        })
      ).find(
        (conflict) =>
          conflict.status === "needs_review" &&
          conflict.summary === REGISTER_CLOSEOUT_VARIANCE_SYNC_REVIEW_SUMMARY,
      );

      if (existingVarianceConflict) {
        return {
          status: "conflicted",
          mappings: [],
          conflicts: [existingVarianceConflict],
        };
      }

      if (registerSession.managerApprovalRequestId) {
        const approvalRequest = await repository.getApprovalRequest(
          registerSession.managerApprovalRequestId,
        );
        const factsMatch =
          approvalRequest?.requestType === "variance_review" &&
          approvalRequest.registerSessionId === registerSession._id &&
          areRegisterSessionCloseoutReviewFactsEquivalent(
            approvalRequest.metadata,
            {
              countedCash,
              expectedCash: registerSession.expectedCash,
              localEventId: args.event.localEventId,
              localRegisterSessionId: args.event.localRegisterSessionId,
              notes: payload.notes?.trim() || undefined,
              terminalId: args.terminalId,
              variance,
            },
          );

        if (
          !approvalRequest ||
          !factsMatch ||
          (approvalRequest.status !== "pending" &&
            approvalRequest.status !== "approved")
        ) {
          const conflict = await createConflict(repository, args, {
            conflictType: "permission",
            summary:
              "Register closeout approval ownership no longer matches the synced closeout facts.",
            details: {
              approvalRequestId: registerSession.managerApprovalRequestId,
              approvalRequestStatus: approvalRequest?.status,
              localEventId: args.event.localEventId,
              registerSessionId: registerSession._id,
            },
          });
          return { status: "conflicted", mappings: [], conflicts: [conflict] };
        }

        const mapping = await createMapping(repository, args, {
          localIdKind: "closeout",
          localId: args.event.localEventId,
          cloudTable: "registerSession",
          cloudId: registerSession._id,
        });
        return { status: "projected", mappings: [mapping], conflicts: [] };
      }
    }

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

  const closeoutHolds =
    (await repository.listCloseoutHoldsForRegisterSession?.({
      registerSessionId: registerSession._id,
      storeId: args.storeId,
    })) ?? [];

  if (
    closeoutHolds.some((hold) => hold.cashAffecting && hold.count > 0)
  ) {
    const [store, terminal] = await Promise.all([
      repository.getStore(args.storeId),
      repository.getTerminal(args.terminalId),
    ]);
    const registerLabel = formatTerminalRegisterLabel({
      registerNumber: registerSession.registerNumber ?? registerSession._id,
      terminalName: terminal?.displayName,
    });

    await repository.patchRegisterSession(registerSession._id, {
      status: "closing",
      countedCash,
      variance,
      closeoutOwnedAt: args.event.occurredAt,
      closeoutOwnershipSource: "closeout_submission",
      notes: payload.notes,
    });
    await repository.createOperationalEvent({
      storeId: args.storeId,
      organizationId: store?.organizationId,
      eventType: "register_session_closeout_submitted",
      subjectType: "register_session",
      subjectId: registerSession._id,
      message:
        variance === 0
          ? `${registerLabel} closeout submitted with an exact cash match. Finalize after pending register corrections are resolved.`
          : `${registerLabel} closeout submitted with a cash variance of ${formatSaleTotal(store?.currency, variance)}. Finalize after pending register corrections are resolved.`,
      metadata: {
        countedCash,
        expectedCash: registerSession.expectedCash,
        holdKinds: closeoutHolds
          .filter((hold) => hold.cashAffecting && hold.count > 0)
          .map((hold) => hold.kind),
        localEventId: args.event.localEventId,
        notes: payload.notes,
        registerNumber: registerSession.registerNumber,
        syncOrigin: "local_sync",
        variance,
      },
      createdAt: args.event.occurredAt,
      actorStaffProfileId: args.event.staffProfileId,
      registerSessionId: registerSession._id,
      terminalId: args.terminalId,
      localEventId: args.event.localEventId,
    });
    const mapping = await createMapping(repository, args, {
      localIdKind: "closeout",
      localId: args.event.localEventId,
      cloudTable: "registerSession",
      cloudId: registerSession._id,
    });
    return { status: "projected", mappings: [mapping], conflicts: [] };
  }

  if (
    roundMoney(variance) !== 0 &&
    args.options?.allowRegisterCloseoutVarianceProjection !== true
  ) {
    const [store, terminal] = await Promise.all([
      repository.getStore(args.storeId),
      repository.getTerminal(args.terminalId),
    ]);
    const closeoutReview = buildRegisterSessionCloseoutReview({
      config: getCashControlsConfig(store),
      countedCash,
      expectedCash: registerSession.expectedCash,
    });

    if (!closeoutReview.requiresApproval) {
      // The shared Cash Controls gate allows this variance; project it below.
    } else {
      const reviewResult =
        await repository.createOrReuseRegisterSessionVarianceReview({
          closeoutOccurredAt: args.event.occurredAt,
          countedCash,
          expectedCash: registerSession.expectedCash,
          gateDecisionReason: closeoutReview.reason,
          localEventId: args.event.localEventId,
          localRegisterSessionId: args.event.localRegisterSessionId,
          notes: payload.notes,
          organizationId: store?.organizationId,
          registerNumber: registerSession.registerNumber,
          registerSessionId: registerSession._id,
          requestedByStaffProfileId: args.event.staffProfileId,
          requestedByUserId: args.submittedByUserId,
          storeId: args.storeId,
          terminalId: args.terminalId,
          variance: closeoutReview.variance,
        });

      if (reviewResult.status === "conflict") {
        const conflict = await createConflict(repository, args, {
          conflictType: "permission",
          summary: reviewResult.summary,
          details: reviewResult.details,
        });
        return { status: "conflicted", mappings: [], conflicts: [conflict] };
      }

      const registerLabel = formatTerminalRegisterLabel({
        registerNumber: registerSession.registerNumber,
        terminalName: terminal?.displayName,
      });

      if (reviewResult.created) {
        await repository.createOperationalEvent({
          storeId: args.storeId,
          organizationId: store?.organizationId,
          eventType: "register_session_variance_review_requested",
          subjectType: "register_session",
          subjectId: registerSession._id,
          message: `${registerLabel} closeout submitted with a cash variance of ${formatSaleTotal(store?.currency, closeoutReview.variance)}. Review before finalizing it.`,
          metadata: {
            actionKey: "cash_controls.register_session.variance_review",
            approvalMode: "async_approval",
            approvalRequestId: reviewResult.approvalRequest._id,
            countedCash,
            expectedCash: registerSession.expectedCash,
            gateDecision: "approval_required",
            gateDecisionReason: closeoutReview.reason,
            localEventId: args.event.localEventId,
            localRegisterSessionId: args.event.localRegisterSessionId,
            notes: payload.notes,
            registerNumber: registerSession.registerNumber,
            syncOrigin: "local_sync",
            variance: closeoutReview.variance,
          },
          createdAt: args.event.occurredAt,
          actorStaffProfileId: args.event.staffProfileId,
          actorUserId: args.submittedByUserId,
          approvalRequestId: reviewResult.approvalRequest._id,
          registerSessionId: registerSession._id,
          terminalId: args.terminalId,
          localEventId: args.event.localEventId,
        });
      }

      const mapping = await createMapping(repository, args, {
        localIdKind: "closeout",
        localId: args.event.localEventId,
        cloudTable: "registerSession",
        cloudId: registerSession._id,
      });
      return { status: "projected", mappings: [mapping], conflicts: [] };
    }
  }

  const [store, terminal] = await Promise.all([
    repository.getStore(args.storeId),
    repository.getTerminal(args.terminalId),
  ]);

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
  const traceResult = await repository.recordRegisterSessionWorkflowTrace?.({
    stage: "closed",
    session: {
      ...registerSession,
      status: "closed",
      countedCash,
      variance,
      closedByStaffProfileId: args.event.staffProfileId,
      closedAt: args.event.occurredAt,
      notes: payload.notes,
    } as never,
    occurredAt: args.event.occurredAt,
    actorStaffProfileId: args.event.staffProfileId,
    countedCash,
    variance,
  });
  if (traceResult) {
    await persistRegisterSessionWorkflowTraceId(repository, {
      registerSessionId: registerSession._id,
      traceCreated: traceResult.traceCreated,
      traceId: traceResult.traceId,
      workflowTraceId: registerSession.workflowTraceId,
    });
  }
  const registerLabel = formatTerminalRegisterLabel({
    registerNumber: registerSession.registerNumber ?? registerSession._id,
    terminalName: terminal?.displayName,
  });
  await repository.createOperationalEvent({
    storeId: args.storeId,
    organizationId: store?.organizationId,
    eventType: "register_session_closed",
    subjectType: "register_session",
    subjectId: registerSession._id,
    message:
      variance === 0
        ? `${registerLabel} closeout recorded with an exact cash match.`
        : `${registerLabel} closeout recorded with a cash variance of ${formatSaleTotal(store?.currency, variance)}.`,
    metadata: {
      countedCash,
      expectedCash: registerSession.expectedCash,
      localEventId: args.event.localEventId,
      registerNumber: registerSession.registerNumber,
      syncOrigin: "local_sync",
      variance,
    },
    createdAt: args.event.occurredAt,
    actorStaffProfileId: args.event.staffProfileId,
    registerSessionId: registerSession._id,
    terminalId: args.terminalId,
    localEventId: args.event.localEventId,
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
  const conflict = await createConflict(repository, args, {
    conflictType: "permission",
    summary:
      "Register reopen from synced POS history requires manager review before projection.",
    details: {
      localRegisterSessionId: args.event.localRegisterSessionId,
      reason:
        typeof args.event.payload.reason === "string"
          ? args.event.payload.reason
          : undefined,
      staffProfileId: args.event.staffProfileId,
    },
  });
  return { status: "conflicted", mappings: [], conflicts: [conflict] };
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function serviceLineKey(
  line: NonNullable<PosLocalSalePayload["serviceLines"]>[number],
  index: number,
) {
  return line.localServiceLineId ?? `${line.serviceCatalogId}:${index}`;
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
    ...(payload.serviceLines ?? [])
      .filter((line) => line.localServiceCaseId)
      .map((line) => ({
        localIdKind: "serviceCase" as const,
        localId: line.localServiceCaseId!,
      })),
    ...(payload.serviceLines ?? [])
      .filter((line) => line.localServiceLineId)
      .map((line) => ({
        localIdKind: "serviceLine" as const,
        localId: line.localServiceLineId!,
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
    localRegisterSessionId: args.event.localRegisterSessionId ?? "",
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
    localRegisterSessionId: args.event.localRegisterSessionId ?? "",
    localEventId: args.event.localEventId,
    sourceEventType: args.event.eventType,
    createdAt: args.now,
    ...input,
  };

  return repository.createMapping(scopedInput);
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
    localRegisterSessionId: args.event.localRegisterSessionId ?? "",
    localEventId: args.event.localEventId,
    sequence: args.event.sequence,
    conflictType: input.conflictType,
    status: "needs_review",
    summary: input.summary,
    details: input.details,
    createdAt: args.now,
  });
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { generateTransactionNumber } from "~/convex/utils";

import type {
  CartItem,
  CustomerInfo,
  Payment,
  Product,
} from "@/components/pos/types";
import { useAuth } from "@/hooks/useAuth";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { useGetTerminal } from "@/hooks/useGetTerminal";
import { useNavigateBack } from "@/hooks/use-navigate-back";
import { registerAndProvisionPosTerminal } from "@/lib/pos/application/registerAndProvisionPosTerminal";
import { bootstrapRegister } from "@/lib/pos/application/useCases/bootstrapRegister";
import { holdSession as runHoldSession } from "@/lib/pos/application/useCases/holdSession";
import {
  calculatePosCartTotals,
  normalizeNonCashOverpayment,
  type PosPaymentMethod,
} from "@/lib/pos/domain";
import { parseDisplayAmountInput } from "@/lib/pos/displayAmounts";
import { toOperatorMessage } from "@/lib/errors/operatorMessages";
import { isApprovalRequiredResult, runCommand } from "@/lib/errors/runCommand";
import type { CommandApprovalProofResult } from "@/components/operations/CommandApprovalDialog";
import type { StaffAuthenticationResult } from "@/components/staff-auth/StaffAuthenticationDialog";
import { useApprovedCommand } from "@/components/operations/useApprovedCommand";
import { logger } from "@/lib/logger";
import { useConvexCommandGateway } from "@/lib/pos/infrastructure/convex/commandGateway";
import { type PosLocalEventRecord } from "@/lib/pos/infrastructure/local/posLocalStore";
import {
  hasSettledRegisterCloseout,
  type PosLocalActiveSaleReadModel,
  type PosLocalRegisterReadModel,
} from "@/lib/pos/infrastructure/local/registerReadModel";
import { isSyncablePosLocalEvent } from "@/lib/pos/infrastructure/local/syncContract";
import { useLocalPosEntryContext } from "@/lib/pos/infrastructure/local/localPosEntryContext";
import { readStoredTerminalFingerprint } from "@/lib/pos/infrastructure/terminal/fingerprint";
import {
  useConvexRegisterCatalog,
  useConvexRegisterCatalogAvailability,
  useConvexRegisterServiceCatalog,
} from "@/lib/pos/infrastructure/convex/catalogGateway";
import { useConvexRegisterState } from "@/lib/pos/infrastructure/convex/registerGateway";
import { isRegisterSessionSaleUsable } from "~/shared/registerSessionLifecyclePolicy";
import { userError, type CommandResult } from "~/shared/commandResult";
import type { ApprovalRequirement } from "~/shared/approvalPolicy";
import {
  normalizePosTerminalTransactionCapability,
  posTerminalCanTransactProducts,
  posTerminalCanTransactServices,
} from "~/shared/posTerminalCapability";
import {
  useConvexActiveSession,
  useConvexHeldSessions,
  useConvexSessionActions,
  type PosSessionCustomer,
  type PosSessionDetail,
} from "@/lib/pos/infrastructure/convex/sessionGateway";

import type {
  RegisterCommandApprovalDialogState,
  RegisterServiceLineState,
  RegisterServiceSearchResult,
  RegisterViewModel,
} from "./registerUiState";
import {
  buildRegisterUpdateApplyBlockerState,
  EMPTY_REGISTER_CUSTOMER_INFO,
} from "./registerUiState";
import {
  buildRegisterHeaderState,
  buildRegisterInfoState,
  getCashierDisplayName,
  getRegisterCustomerInfo,
  isRegisterSessionActive,
} from "./selectors";
import {
  buildRegisterServiceCatalogIndex,
  searchRegisterCatalog,
  searchRegisterServiceCatalog,
  type RegisterCatalogSearchResult,
  type RegisterServiceCatalogSearchRow,
} from "./catalogSearch";
import {
  mapCatalogRowToProduct,
  normalizeExactInput,
  POS_AVAILABILITY_NOT_READY_MESSAGE,
  type RegisterCatalogAvailability,
} from "./catalogSearchPresentation";
import { useRegisterCatalogIndex } from "./useRegisterCatalogIndex";
import { buildPosSyncStatusPresentation } from "@/lib/pos/presentation/syncStatusPresentation";
import {
  canOperateRegister,
  getStaffDisplayNameFromAuthResult,
  hasRegisterManagerRole,
  hasRegisterOperatorRole,
  isCashierPresenceBlockingSale,
  POS_CASHIER_PRESENCE_OFFLINE_FRESHNESS_MS,
  readStaffProofFromAuthResult,
  validateRestoredCashierPresence,
  type CashierPresenceRestoreState,
  type CashierPresenceStore,
  type StaffProfileRosterRow,
} from "./registerCashierPresence";
import {
  buildLocalCartItemPayload,
  buildLocalCartItemPayloadFromCartItem,
  cartItemsFromLocalRegisterModel,
  cartLineSourceKey,
  getProductAvailabilityStatus,
  localAvailabilityConsumptionFromReadModel,
  mapLocalCartItemToCartItem,
  mapLocalPendingCheckoutEventsToProducts,
  mapPendingCheckoutCartItemToProduct,
  mapProductToOptimisticCartItem,
  mergeCartItemsBySku,
  optimisticCartProductKeyFromCartItem,
  pendingCheckoutFieldsMatchSearch,
  pendingCheckoutCartItemMatchesSearch,
  productCartSourceKey,
  renderedCartLineSourceKey,
  totalsFromCartItems,
} from "./registerCartProjection";
import {
  buildCompletedSalePayload,
  buildServiceCheckoutBlockMessage,
  combinePaymentsByMethod,
  completedCustomerInfo,
  hasCustomerDetails,
  mapLocalPaymentToPayment,
  mapLocalServiceLineToState,
  mapSessionCustomer,
  matchingServiceLineDraft,
  serviceLineStateToCartLine,
  serviceLineStateToLocalPayload,
} from "./registerCheckoutProjection";
import {
  buildOpenDrawerFailureMessage,
  findRegisterCloseoutReviewItem,
  getCloseoutCloudRegisterSessionId,
  getCloseoutLocalRegisterSessionId,
  isKnownCloudRegisterSessionBlockingLocalProjection,
  readLocalSyncStatus,
} from "./registerDrawerPresentation";
import {
  useRegisterCheckoutDraftState,
  type RegisterPaymentMutationDraft,
} from "./useRegisterCheckoutDraftState";
import { useRegisterLocalRuntime } from "./useRegisterLocalRuntime";

type LocalAuthenticatedStaff = {
  activeRoles: string[];
  displayName: string;
} | null;

function removedCartLineKeyFromCartItem(item: CartItem) {
  return [
    item.skuId?.toString() ?? item.productId?.toString() ?? item.id.toString(),
    renderedCartLineSourceKey(item),
  ].join(":");
}

function removedCartLineKeyFromProduct(product: Product) {
  return [
    product.skuId?.toString() ??
      product.productId?.toString() ??
      product.id.toString(),
    productCartSourceKey(product),
  ].join(":");
}

type ServiceCatalogRow = {
  basePrice?: number;
  description?: string;
  depositType?: RegisterServiceCatalogSearchRow["depositType"];
  depositValue?: number;
  name: string;
  pricingModel: RegisterServiceSearchResult["pricingModel"];
  requiresManagerApproval?: boolean;
  serviceCatalogId: Id<"serviceCatalog">;
  serviceMode: RegisterServiceSearchResult["serviceMode"];
  status: "active";
  updatedAt?: number;
  checkoutReadiness?: RegisterServiceCatalogSearchRow["checkoutReadiness"];
};

function mapServiceCatalogRowToRegisterSearchResult(
  row: ServiceCatalogRow,
): RegisterServiceSearchResult {
  return {
    id: row.serviceCatalogId.toString(),
    serviceCatalogId: row.serviceCatalogId,
    name: row.name,
    description: row.description,
    serviceMode: row.serviceMode,
    pricingModel: row.pricingModel,
    basePrice: row.basePrice,
    requiresManagerApproval: row.requiresManagerApproval,
    updatedAt: row.updatedAt,
  };
}

function mapServiceCatalogRowToSearchRow(
  row: ServiceCatalogRow,
): RegisterServiceCatalogSearchRow {
  return {
    serviceCatalogId: row.serviceCatalogId.toString(),
    name: row.name,
    description: row.description,
    serviceMode: row.serviceMode,
    pricingModel: row.pricingModel,
    basePrice: row.basePrice,
    depositType: row.depositType ?? "none",
    depositValue: row.depositValue,
    requiresManagerApproval: Boolean(row.requiresManagerApproval),
    checkoutReadiness:
      row.checkoutReadiness ??
      ({
        canCheckoutDirectly: row.pricingModel === "fixed",
        message: "",
        reason:
          row.pricingModel === "fixed"
            ? "fixed_price"
            : row.pricingModel === "starting_at"
              ? "starting_at_amount_required"
              : "quote_after_consultation_requires_case_or_amount",
        status:
          row.pricingModel === "fixed"
            ? "ready"
            : row.pricingModel === "starting_at"
              ? "amount_required"
              : "case_or_amount_required",
      } as RegisterServiceCatalogSearchRow["checkoutReadiness"]),
  };
}

function isServiceCatalogRow(row: unknown): row is ServiceCatalogRow {
  if (!row || typeof row !== "object") return false;

  const candidate = row as Partial<ServiceCatalogRow>;
  return (
    candidate.serviceCatalogId !== undefined &&
    typeof candidate.name === "string" &&
    (candidate.pricingModel === "fixed" ||
      candidate.pricingModel === "starting_at" ||
      candidate.pricingModel === "quote_after_consultation") &&
    (candidate.serviceMode === "same_day" ||
      candidate.serviceMode === "consultation" ||
      candidate.serviceMode === "repair" ||
      candidate.serviceMode === "revamp")
  );
}

function getLocalOperatingDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createPaymentId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `payment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
}

function createLocalFallbackId(prefix: string): string {
  const uniqueId =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${uniqueId}`;
}

function buildLocalReceiptNumber() {
  return generateTransactionNumber();
}

function trimOptional(value: string): string | undefined {
  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

function presentOperatorError(message: string): void {
  toast.error(toOperatorMessage(message));
}

function countPendingSyncableLocalEventsForStaff(
  events: PosLocalEventRecord[],
  staffProfileId: Id<"staffProfile"> | string | null | undefined,
) {
  if (!staffProfileId) {
    return 0;
  }

  return events.filter(
    (event) =>
      event.staffProfileId === staffProfileId &&
      isSyncablePosLocalEvent(event) &&
      (event.sync.status === "pending" ||
        event.sync.status === "syncing" ||
        event.sync.status === "failed"),
  ).length;
}

function hasUploadedLocalEventsForStaff(
  events: PosLocalEventRecord[],
  staffProfileId: Id<"staffProfile"> | string | null | undefined,
) {
  if (!staffProfileId) {
    return false;
  }

  return events.some(
    (event) => event.staffProfileId === staffProfileId && event.sync.uploaded,
  );
}

function hasSyncedSaleLocalEventsForStaff(
  events: PosLocalEventRecord[],
  staffProfileId: Id<"staffProfile"> | string | null | undefined,
) {
  if (!staffProfileId) {
    return false;
  }

  return events.some(
    (event) =>
      event.staffProfileId === staffProfileId &&
      event.type === "transaction.completed" &&
      event.sync.status === "synced" &&
      event.sync.uploaded,
  );
}

type LocalOperableRegisterSession = {
  cloudRegisterSessionId?: string;
  expectedCash: number;
  localRegisterSessionId: string;
  openedAt: number;
  openingFloat: number;
  registerNumber: string;
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
};

type CloseoutBlockedRegisterSession = {
  _id?: Id<"registerSession"> | string;
  countedCash?: number;
  expectedCash: number;
  localRegisterSessionId?: string;
  localSyncStatus?: {
    pendingEventCount?: number;
    status: string;
  };
  managerApprovalRequestId?: Id<"approvalRequest">;
  openedAt: number;
  openingFloat: number;
  registerNumber: string;
  status: "closing";
  terminalId: Id<"posTerminal">;
  variance?: number;
};

function selectPassiveCloseoutBlockedRegisterSession(): CloseoutBlockedRegisterSession | null {
  return null;
}

type LocalOperablePosSession = {
  localPosSessionId: string;
  localRegisterSessionId: string;
  registerNumber: string;
  startedAt: number;
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
};

type CloudOperableActiveSession = PosSessionDetail & {
  sessionSource: "cloud";
};

type LocalOperableActiveSession = {
  _creationTime: number;
  _id: string;
  cartItems: CartItem[];
  createdAt: number;
  customer: PosSessionCustomer;
  expiresAt: number;
  localRegisterSessionId: string;
  localSyncStatus: {
    pendingEventCount: number;
    status: "pending_sync";
  };
  payments: Payment[];
  registerNumber?: string;
  registerSessionId?: undefined;
  sessionNumber: string;
  sessionSource: "local";
  staffProfileId?: Id<"staffProfile"> | string;
  status: "active";
  storeId?: Id<"store">;
  terminalId: Id<"posTerminal"> | string;
  updatedAt: number;
  workflowTraceId?: string | null;
};

type OperableActiveSession =
  | CloudOperableActiveSession
  | LocalOperableActiveSession;

function asCloudOperableSession(
  session: PosSessionDetail | null,
): CloudOperableActiveSession | null {
  return session ? { ...session, sessionSource: "cloud" } : null;
}

function isCloudOperableSession(
  session: OperableActiveSession | null | undefined,
): session is CloudOperableActiveSession {
  return session?.sessionSource === "cloud";
}

function isLocalOperableSession(
  session: OperableActiveSession | null | undefined,
): session is LocalOperableActiveSession {
  return session?.sessionSource === "local";
}

function isEmptyLocalSaleShell(
  sale: PosLocalActiveSaleReadModel | null,
): sale is PosLocalActiveSaleReadModel {
  return Boolean(
    sale &&
    sale.items.length === 0 &&
    sale.payments.length === 0 &&
    sale.subtotal === 0 &&
    sale.tax === 0 &&
    sale.total === 0,
  );
}

export function useRegisterViewModel(): RegisterViewModel {
  const { activeStore } = useGetActiveStore();
  const { user } = useAuth();
  const terminal = useGetTerminal();
  const routeParams = useParams({ strict: false }) as
    | {
        orgUrlSlug?: string;
        storeUrlSlug?: string;
      }
    | undefined;
  const localEntryContext = useLocalPosEntryContext({
    activeStore,
    routeParams,
  });
  const activeStoreId = (activeStore?._id ??
    (localEntryContext.status === "ready"
      ? localEntryContext.storeId
      : undefined)) as Id<"store"> | undefined;
  const activeStoreOrganizationId = (
    activeStore as { organizationId?: string } | null | undefined
  )?.organizationId;
  const activeStoreCurrency = activeStore?.currency ?? "GHS";
  const navigateBack = useNavigateBack();
  const [staffProfileId, setStaffProfileId] =
    useState<Id<"staffProfile"> | null>(null);
  const [staffProofToken, setStaffProofToken] = useState<string | null>(null);
  const staffProfileIdRef = useRef<Id<"staffProfile"> | null>(staffProfileId);
  const staffProofTokenRef = useRef<string | null>(staffProofToken);
  staffProfileIdRef.current = staffProfileId;
  staffProofTokenRef.current = staffProofToken;
  const [localAuthenticatedStaff, setLocalAuthenticatedStaff] =
    useState<LocalAuthenticatedStaff>(null);
  const [cashierPresenceRestore, setCashierPresenceRestore] =
    useState<CashierPresenceRestoreState>({ status: "pending" });
  const terminalRegisterNumber = terminal?.registerNumber
    ? trimOptional(terminal.registerNumber)
    : undefined;
  const terminalTransactionCapability =
    normalizePosTerminalTransactionCapability(terminal?.transactionCapability);
  const terminalCanTransactProducts = posTerminalCanTransactProducts(
    terminalTransactionCapability,
  );
  const terminalCanTransactServices = posTerminalCanTransactServices(
    terminalTransactionCapability,
  );
  const activeOperatingDate = useMemo(() => getLocalOperatingDate(), []);
  const [showCustomerPanel, setShowCustomerPanel] = useState(false);
  const [showProductEntry, setShowProductEntry] = useState(true);
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [serviceLineDrafts, setServiceLineDrafts] = useState<
    RegisterServiceLineState[]
  >([]);
  const serviceLineDraftsRef = useRef<RegisterServiceLineState[]>([]);
  useEffect(() => {
    serviceLineDraftsRef.current = serviceLineDrafts;
  }, [serviceLineDrafts]);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>(
    EMPTY_REGISTER_CUSTOMER_INFO,
  );
  const [isTransactionCompleted, setIsTransactionCompleted] = useState(false);
  const [completedOrderNumber, setCompletedOrderNumber] = useState<
    string | null
  >(null);
  const [drawerOpeningFloat, setDrawerOpeningFloat] = useState("");
  const [drawerNotes, setDrawerNotes] = useState("");
  const [correctedOpeningFloat, setCorrectedOpeningFloat] = useState("");
  const [openingFloatCorrectionReason, setOpeningFloatCorrectionReason] =
    useState("");
  const [closeoutCountedCash, setCloseoutCountedCash] = useState("");
  const [closeoutNotes, setCloseoutNotes] = useState("");
  const [drawerErrorMessage, setDrawerErrorMessage] = useState<string | null>(
    null,
  );
  const [isOpeningDrawer, setIsOpeningDrawer] = useState(false);
  const [isRepairingTerminalSetup, setIsRepairingTerminalSetup] =
    useState(false);
  const [isCorrectingOpeningFloat, setIsCorrectingOpeningFloat] =
    useState(false);
  const [isSubmittingCloseout, setIsSubmittingCloseout] = useState(false);
  const [isReopeningCloseout, setIsReopeningCloseout] = useState(false);
  const [isCloseoutRequested, setIsCloseoutRequested] = useState(false);
  const [
    isOpeningFloatCorrectionRequested,
    setIsOpeningFloatCorrectionRequested,
  ] = useState(false);
  const [completedTransactionData, setCompletedTransactionData] =
    useState<RegisterViewModel["checkout"]["completedTransactionData"]>(null);
  const bootstrapInitialized = useRef(false);
  const syncedSessionId = useRef<string | null>(null);
  const locallyCompletedSessionIdsRef = useRef<Set<string>>(new Set());
  const {
    allocateCheckoutStateVersion,
    checkoutMutationLockedRef,
    enqueueCartMutation,
    enqueuePaymentQueueMutation,
    enqueueServiceMutation,
    payments,
    paymentsRef,
    resetCheckoutStateVersion,
    setPaymentState,
    waitForCheckoutMutationQueues,
  } = useRegisterCheckoutDraftState();
  const [isCheckoutMutationInFlight, setIsCheckoutMutationInFlight] =
    useState(false);
  const setCheckoutMutationLocked = useCallback(
    (locked: boolean) => {
      checkoutMutationLockedRef.current = locked;
      setIsCheckoutMutationInFlight(locked);
    },
    [checkoutMutationLockedRef],
  );
  const activeSessionIdRef = useRef<Id<"posSession"> | null>(null);
  const isMountedRef = useRef(true);
  const customerCommitQueueRef = useRef<Promise<void>>(Promise.resolve());
  const drawerBindingRequestRef = useRef<string | null>(null);
  const unmountSessionRef = useRef<Id<"posSession"> | null>(null);
  const unmountSessionCartItemCountRef = useRef(0);
  const exactAddKeyRef = useRef<string | null>(null);
  const pendingSessionStartKeyRef = useRef<string | null>(null);
  const seededRegisterSessionIdsRef = useRef<Set<string>>(new Set());
  const autoTerminalRepairAttemptRef = useRef<string | null>(null);
  const activeCartItemsRef = useRef<CartItem[]>([]);
  const localRegisterReadModelRef = useRef<PosLocalRegisterReadModel | null>(
    null,
  );
  const localAvailabilityConsumptionBySkuIdRef = useRef<Map<string, number>>(
    new Map(),
  );
  const [optimisticCartQuantities, setOptimisticCartQuantities] = useState<
    Record<string, number>
  >({});
  const [optimisticCartProducts, setOptimisticCartProducts] = useState<
    Record<string, CartItem>
  >({});
  const [
    optimisticallyRemovedCartLineKeys,
    setOptimisticallyRemovedCartLineKeys,
  ] = useState<Record<string, true>>({});
  const [localOperableRegisterSession, setLocalOperableRegisterSession] =
    useState<LocalOperableRegisterSession | null>(null);
  const [localOperablePosSession, setLocalOperablePosSession] =
    useState<LocalOperablePosSession | null>(null);
  const requestBootstrap = useCallback(() => {
    bootstrapInitialized.current = false;
  }, []);
  const {
    appSessionRecovery,
    hasProvisionedLocalSyncSeed,
    localCommandGateway,
    localRegisterReadModel,
    localRuntimeSyncSource,
    localSaleValidationMetadata,
    localStaffAuthorityStatus,
    localStore,
    localSyncEventAppendToken,
    noteLocalRegisterEventChanged,
    noteLocalRuntimeChanged,
    readCurrentLocalRegisterModel,
    refreshLocalRegisterReadModel,
  } = useRegisterLocalRuntime({
    activeStoreId,
    createLocalFallbackId,
    onRetryBootstrap: requestBootstrap,
    staffProfileId,
    staffProfileIdRef,
    staffProofToken,
    staffProofTokenRef,
    terminal,
  });

  useEffect(() => {
    const localTransactionId = completedTransactionData?.localTransactionId;
    if (
      !localTransactionId ||
      completedTransactionData?.transactionId ||
      !localRegisterReadModel
    ) {
      return;
    }

    const completedSale = localRegisterReadModel.completedSales.find(
      (sale) => sale.localTransactionId === localTransactionId,
    );
    const cloudTransactionId = completedSale?.cloudTransactionId;
    if (!cloudTransactionId) {
      return;
    }

    setCompletedTransactionData((current) => {
      if (
        !current ||
        current.localTransactionId !== localTransactionId ||
        current.transactionId
      ) {
        return current;
      }

      return {
        ...current,
        transactionId: cloudTransactionId as Id<"posTransaction">,
      };
    });
  }, [
    completedTransactionData?.localTransactionId,
    completedTransactionData?.transactionId,
    localRegisterReadModel,
  ]);

  const registerState = useConvexRegisterState({
    storeId: activeStoreId,
    terminalId: terminal?._id ?? null,
    staffProfileId,
    registerNumber: terminalRegisterNumber,
  });
  const bootstrapState = bootstrapRegister({
    registerState,
  });
  const staffRosterResult = useQuery(
    api.operations.staffProfiles.listStaffProfiles,
    activeStoreId ? { storeId: activeStoreId! } : "skip",
  ) as unknown;
  const isStaffRosterLoaded =
    !activeStoreId || Array.isArray(staffRosterResult);
  const staffRoster = Array.isArray(staffRosterResult)
    ? (staffRosterResult as StaffProfileRosterRow[])
    : [];
  const serviceCatalogResult = useConvexRegisterServiceCatalog({
    storeId: activeStoreId,
  });
  const serviceCatalogRows = useMemo(
    () =>
      Array.isArray(serviceCatalogResult)
        ? serviceCatalogResult.filter(isServiceCatalogRow)
        : [],
    [serviceCatalogResult],
  );
  const activeRegisterOperatorCount =
    staffRoster.filter(canOperateRegister).length;
  const activeSession = useConvexActiveSession({
    storeId: activeStoreId,
    terminalId: terminal?._id ?? null,
    staffProfileId,
    registerNumber: terminalRegisterNumber,
  });
  const registerCatalogRows = useConvexRegisterCatalog({
    storeId: activeStoreId,
  });
  const registerCatalogIndex = useRegisterCatalogIndex(registerCatalogRows);
  const registerCatalogSkuIds = useMemo(
    () => new Set((registerCatalogRows ?? []).map((row) => row.productSkuId)),
    [registerCatalogRows],
  );
  const registerMetadataSearchState = useMemo(
    () => searchRegisterCatalog(registerCatalogIndex, productSearchQuery),
    [productSearchQuery, registerCatalogIndex],
  );
  const registerAvailabilityProductSkuIds = useMemo(() => {
    const productSkuIds = new Set<Id<"productSku">>();

    for (const item of activeSession?.cartItems ?? []) {
      if (item.skuId) {
        productSkuIds.add(item.skuId);
      }
    }

    for (const item of localRegisterReadModel?.activeSale?.items ?? []) {
      productSkuIds.add(item.productSkuId as Id<"productSku">);
    }

    for (const item of Object.values(optimisticCartProducts)) {
      if (item.skuId) {
        productSkuIds.add(item.skuId);
      }
    }

    for (const row of registerMetadataSearchState.results) {
      productSkuIds.add(row.productSkuId as Id<"productSku">);
    }

    return Array.from(productSkuIds);
  }, [
    activeSession?.cartItems,
    localRegisterReadModel?.activeSale?.items,
    optimisticCartProducts,
    registerMetadataSearchState.results,
  ]);
  const registerCatalogAvailabilityRows = useConvexRegisterCatalogAvailability({
    refreshFullAvailabilitySnapshot: true,
    storeId: activeStoreId,
    productSkuIds: registerAvailabilityProductSkuIds,
  });
  const registerCatalogAvailabilityBySkuId = useMemo(() => {
    const rows = registerCatalogAvailabilityRows ?? [];

    return new Map<string, RegisterCatalogAvailability>(
      rows.map((row) => [row.productSkuId, row]),
    );
  }, [registerCatalogAvailabilityRows]);
  const isRegisterCatalogReady = registerCatalogRows !== undefined;
  const isRegisterSearchLoading =
    productSearchQuery.trim().length > 0 && !isRegisterCatalogReady;

  useEffect(() => {
    isMountedRef.current = true;
    setOptimisticallyRemovedCartLineKeys({});
    activeSessionIdRef.current = activeSession?._id
      ? (activeSession._id as Id<"posSession">)
      : null;
  }, [activeSession?._id]);
  const usableActiveRegisterSession =
    registerState?.activeRegisterSession &&
    isRegisterSessionSaleUsable(registerState.activeRegisterSession)
      ? registerState.activeRegisterSession
      : null;
  const localStaffPendingUploadCount = countPendingSyncableLocalEventsForStaff(
    localRegisterReadModel?.sourceEvents ?? [],
    staffProfileId,
  );
  const localStaffHasUploadedEvents = hasUploadedLocalEventsForStaff(
    localRegisterReadModel?.sourceEvents ?? [],
    staffProfileId,
  );
  const localStaffHasSyncedSaleEvents = hasSyncedSaleLocalEventsForStaff(
    localRegisterReadModel?.sourceEvents ?? [],
    staffProfileId,
  );
  const projectedLocalActiveSale = localRegisterReadModel?.activeSale ?? null;
  const projectedLocalActiveSaleStaffProfileId =
    projectedLocalActiveSale?.staffProfileId ?? null;
  const isProjectedLocalActiveSaleOwnedByCurrentStaff = Boolean(
    projectedLocalActiveSale &&
    staffProfileId &&
    projectedLocalActiveSaleStaffProfileId === staffProfileId,
  );
  const cloudRegisterSessionBlocksLocalProjection =
    isKnownCloudRegisterSessionBlockingLocalProjection(
      registerState?.activeRegisterSession,
      localRegisterReadModel?.activeRegisterSession,
    );
  const projectedLocalRegisterSession =
    localRegisterReadModel?.activeRegisterSession &&
    activeStoreId &&
    terminal?._id &&
    !cloudRegisterSessionBlocksLocalProjection &&
    isRegisterSessionSaleUsable(localRegisterReadModel.activeRegisterSession)
      ? {
          expectedCash:
            localRegisterReadModel.activeRegisterSession.expectedCash,
          cloudRegisterSessionId:
            localRegisterReadModel.activeRegisterSession.cloudRegisterSessionId,
          localRegisterSessionId:
            localRegisterReadModel.activeRegisterSession.localRegisterSessionId,
          openedAt: localRegisterReadModel.activeRegisterSession.openedAt,
          openingFloat:
            localRegisterReadModel.activeRegisterSession.openingFloat,
          registerNumber:
            localRegisterReadModel.activeRegisterSession.registerNumber ?? "",
          storeId: activeStoreId!,
          terminalId: terminal._id,
        }
      : null;
  const locallyOperableRegisterSession =
    localOperableRegisterSession &&
    activeStoreId === localOperableRegisterSession.storeId &&
    terminal?._id === localOperableRegisterSession.terminalId
      ? localOperableRegisterSession
      : projectedLocalRegisterSession;
  const closeoutBlockedRegisterSession =
    selectPassiveCloseoutBlockedRegisterSession();
  const activeCloudRegisterSessionHasCloseoutReview = Boolean(
    findRegisterCloseoutReviewItem(usableActiveRegisterSession),
  );
  const saleUsableActiveRegisterSession =
    usableActiveRegisterSession && !activeCloudRegisterSessionHasCloseoutReview
      ? usableActiveRegisterSession
      : null;
  const activeRegisterNumber =
    activeSession?.registerNumber ??
    locallyOperableRegisterSession?.registerNumber ??
    saleUsableActiveRegisterSession?.registerNumber ??
    closeoutBlockedRegisterSession?.registerNumber ??
    registerState?.activeSession?.registerNumber ??
    registerState?.resumableSession?.registerNumber;
  const activeRegisterSessionId = saleUsableActiveRegisterSession?._id as
    | Id<"registerSession">
    | undefined;
  const cloudRegisterSessionId = activeRegisterSessionId?.toString();
  const localEventRegisterSessionId =
    locallyOperableRegisterSession?.localRegisterSessionId ??
    projectedLocalActiveSale?.localRegisterSessionId ??
    projectedLocalRegisterSession?.localRegisterSessionId ??
    cloudRegisterSessionId;
  const isProjectedLocalActiveSaleLockedToAnotherStaff = Boolean(
    projectedLocalActiveSale &&
    (!staffProfileId ||
      projectedLocalActiveSaleStaffProfileId !== staffProfileId),
  );
  const isProjectedLocalActiveSaleEmptyShell = isEmptyLocalSaleShell(
    projectedLocalActiveSale,
  );
  const shouldReplaceProjectedLocalActiveSaleForCurrentStaff = Boolean(
    isProjectedLocalActiveSaleLockedToAnotherStaff &&
    isProjectedLocalActiveSaleEmptyShell,
  );
  const registerNumber = activeRegisterNumber ?? terminalRegisterNumber ?? "";
  const heldSessions = useConvexHeldSessions({
    storeId: activeStoreId,
    terminalId: terminal?._id ?? null,
    staffProfileId,
    limit: 10,
  });
  const cashier = registerState?.cashier ?? null;
  const canSignedInStaffOpenDrawer = Boolean(
    hasRegisterOperatorRole(cashier?.activeRoles) ||
    hasRegisterOperatorRole(localAuthenticatedStaff?.activeRoles),
  );
  const isCashierManager = Boolean(
    hasRegisterManagerRole(cashier?.activeRoles) ||
    hasRegisterManagerRole(localAuthenticatedStaff?.activeRoles),
  );
  const activeSessionConflict = registerState?.activeSessionConflict ?? null;

  const { holdSession: holdSessionCommand } = useConvexCommandGateway();
  const authenticateStaffCredentialForApproval = useMutation(
    api.operations.staffCredentials.authenticateStaffCredentialForApproval,
  );
  const authenticateForCloseoutApproval = useCallback(
    (args: {
      actionKey: string;
      pinHash: string;
      reason?: string;
      requiredRole: ApprovalRequirement["requiredRole"];
      requestedByStaffProfileId?: Id<"staffProfile">;
      storeId: Id<"store">;
      subject: ApprovalRequirement["subject"];
      username: string;
    }) => {
      if (!activeStoreId) {
        return Promise.resolve(
          userError({
            code: "authentication_failed",
            message: "Select a store before confirming manager approval",
          }),
        );
      }

      return runCommand(
        () =>
          authenticateStaffCredentialForApproval({
            actionKey: args.actionKey,
            pinHash: args.pinHash,
            reason: args.reason,
            requiredRole: args.requiredRole,
            requestedByStaffProfileId: args.requestedByStaffProfileId,
            storeId: activeStoreId!,
            subject: args.subject,
            username: args.username,
          }) as Promise<CommandResult<CommandApprovalProofResult>>,
      );
    },
    [activeStoreId, authenticateStaffCredentialForApproval],
  );
  const closeoutApprovalRunner = useApprovedCommand({
    storeId: activeStoreId,
    onAuthenticateForApproval: authenticateForCloseoutApproval,
  });
  const submitRegisterSessionCloseout = useMutation(
    api.cashControls.closeouts.submitRegisterSessionCloseout,
  );
  const correctRegisterSessionOpeningFloat = useMutation(
    api.cashControls.closeouts.correctRegisterSessionOpeningFloat,
  );
  const registerTerminalMutation = useMutation(
    api.inventory.posTerminal.registerTerminal,
  );
  const {
    resumeSession,
    bindSessionToRegisterSession,
    voidSession,
    updateSession,
  } = useConvexSessionActions();
  const voidSessionRef = useRef<typeof voidSession>(voidSession);
  useEffect(() => {
    let cancelled = false;

    async function restoreCashierPresence() {
      if (!activeStoreId || !terminal?._id) {
        setCashierPresenceRestore({ status: "pending" });
        return;
      }

      if (staffProfileIdRef.current) {
        setCashierPresenceRestore({ status: "restored" });
        return;
      }

      if (typeof indexedDB === "undefined") {
        setCashierPresenceRestore({
          message:
            "Cashier sign-in could not be restored. Sign in to continue.",
          status: "failed",
        });
        return;
      }

      setCashierPresenceRestore({ status: "pending" });

      const storeDayReadiness = await localStore.readStoreDayReadiness({
        operatingDate: activeOperatingDate,
        storeId: activeStoreId,
      });
      if (cancelled) return;

      if (!storeDayReadiness.ok) {
        setCashierPresenceRestore({
          message:
            "Cashier sign-in could not be restored. Sign in to continue.",
          status: "failed",
        });
        return;
      }

      if (
        storeDayReadiness.value?.status !== "started" &&
        storeDayReadiness.value?.status !== "reopened"
      ) {
        setCashierPresenceRestore({
          message:
            "Store day not ready. Complete opening before cashier sign-in.",
          status: "failed",
        });
        return;
      }

      const presenceStore = localStore as CashierPresenceStore;
      if (
        !presenceStore.readCashierPresence &&
        !presenceStore.readActiveCashierPresence
      ) {
        setCashierPresenceRestore({ status: "missing" });
        return;
      }

      const now = Date.now();
      const presenceResult =
        activeStoreOrganizationId && presenceStore.readCashierPresence
          ? await presenceStore.readCashierPresence({
              now,
              operatingDate: activeOperatingDate,
              organizationId: activeStoreOrganizationId,
              storeId: activeStoreId,
              terminalId: terminal._id,
            })
          : await presenceStore.readActiveCashierPresence!({
              now,
              operatingDate: activeOperatingDate,
              storeId: activeStoreId,
              terminalId: terminal._id,
            });
      if (cancelled) return;

      if (staffProfileIdRef.current) {
        setCashierPresenceRestore({ status: "restored" });
        return;
      }

      if (!presenceResult.ok) {
        setCashierPresenceRestore({
          message:
            "Cashier sign-in could not be restored. Sign in to continue.",
          status: "failed",
        });
        return;
      }

      const presence = presenceResult.value;
      if (!presence) {
        setCashierPresenceRestore({ status: "missing" });
        return;
      }

      const nextRestoreState = validateRestoredCashierPresence({
        isOnline: globalThis.navigator?.onLine ?? true,
        now,
        operatingDate: activeOperatingDate,
        organizationId: activeStoreOrganizationId,
        presence,
        storeId: activeStoreId,
        terminalId: terminal._id,
      });

      if (nextRestoreState.status === "restored") {
        staffProfileIdRef.current =
          presence.staffProfileId as Id<"staffProfile">;
        staffProofTokenRef.current = presence.staffProofToken ?? null;
        setStaffProfileId(presence.staffProfileId as Id<"staffProfile">);
        setStaffProofToken(presence.staffProofToken ?? null);
        setLocalAuthenticatedStaff({
          activeRoles: presence.activeRoles ?? [],
          displayName: presence.displayName ?? "Signed-in cashier",
        });
      } else if (nextRestoreState.status === "validation_pending") {
        staffProfileIdRef.current =
          presence.staffProfileId as Id<"staffProfile">;
        staffProofTokenRef.current = null;
        setStaffProfileId(presence.staffProfileId as Id<"staffProfile">);
        setStaffProofToken(null);
        setLocalAuthenticatedStaff({
          activeRoles: presence.activeRoles ?? [],
          displayName: presence.displayName ?? "Signed-in cashier",
        });
      } else {
        staffProfileIdRef.current = null;
        staffProofTokenRef.current = null;
        setStaffProfileId(null);
        setStaffProofToken(null);
        setLocalAuthenticatedStaff(null);
        const presenceOrganizationId =
          activeStoreOrganizationId ?? presence.organizationId;
        if (presenceOrganizationId && presenceStore.clearCashierPresence) {
          await presenceStore.clearCashierPresence({
            operatingDate: activeOperatingDate,
            organizationId: presenceOrganizationId,
            storeId: activeStoreId,
            terminalId: terminal._id,
          });
        } else if (presenceStore.invalidateCashierPresenceForTerminal) {
          await presenceStore.invalidateCashierPresenceForTerminal({
            storeId: activeStoreId,
            terminalId: terminal._id,
          });
        }
      }

      if (!cancelled) {
        setCashierPresenceRestore({
          ...nextRestoreState,
          displayName: presence.displayName ?? null,
          username: presence.username ?? null,
        });
      }
    }

    void restoreCashierPresence();

    return () => {
      cancelled = true;
    };
  }, [
    activeOperatingDate,
    activeStoreId,
    activeStoreOrganizationId,
    localStore,
    terminal?._id,
  ]);
  const clearProjectedLocalSaleForStaff = useCallback(
    async (
      actingStaffProfileId: Id<"staffProfile">,
      options?: { requireEmpty?: boolean },
    ): Promise<boolean> => {
      if (
        !projectedLocalActiveSale ||
        projectedLocalActiveSale.staffProfileId === actingStaffProfileId
      ) {
        return true;
      }

      if (
        options?.requireEmpty !== false &&
        !isEmptyLocalSaleShell(projectedLocalActiveSale)
      ) {
        return false;
      }

      if (!activeStoreId || !terminal?._id) {
        return false;
      }

      const savedLocally = await localCommandGateway.clearCart({
        terminalId: terminal._id,
        storeId: activeStoreId,
        registerNumber,
        localRegisterSessionId: projectedLocalActiveSale.localRegisterSessionId,
        localPosSessionId: projectedLocalActiveSale.localPosSessionId,
        staffProfileId: actingStaffProfileId,
        reason: isEmptyLocalSaleShell(projectedLocalActiveSale)
          ? "Empty sale replaced"
          : "Sale replaced",
      });

      if (!savedLocally) {
        return false;
      }

      locallyCompletedSessionIdsRef.current.add(
        projectedLocalActiveSale.localPosSessionId,
      );
      noteLocalRegisterEventChanged();
      return true;
    },
    [
      activeStoreId,
      localCommandGateway,
      noteLocalRegisterEventChanged,
      projectedLocalActiveSale,
      registerNumber,
      terminal?._id,
    ],
  );

  const localActiveSession = useMemo<LocalOperableActiveSession | null>(() => {
    if (projectedLocalActiveSale) {
      if (!isProjectedLocalActiveSaleOwnedByCurrentStaff) {
        return null;
      }

      const sale = projectedLocalActiveSale;
      if (locallyCompletedSessionIdsRef.current.has(sale.localPosSessionId)) {
        return null;
      }

      return {
        _id: sale.localPosSessionId,
        _creationTime: sale.startedAt,
        storeId: activeStoreId as Id<"store">,
        terminalId: sale.terminalId,
        staffProfileId:
          (sale.staffProfileId as Id<"staffProfile">) ?? undefined,
        status: "active",
        createdAt: sale.startedAt,
        expiresAt: Number.MAX_SAFE_INTEGER,
        sessionNumber: "Local sale",
        sessionSource: "local",
        updatedAt: sale.updatedAt,
        registerNumber: sale.registerNumber,
        localRegisterSessionId: sale.localRegisterSessionId,
        cartItems: sale.items.map(mapLocalCartItemToCartItem),
        payments: sale.payments.map((payment) =>
          mapLocalPaymentToPayment(payment, createPaymentId),
        ),
        customer: null,
        localSyncStatus: {
          status: "pending_sync",
          pendingEventCount: localStaffPendingUploadCount,
        },
      };
    }

    if (!localOperablePosSession || !locallyOperableRegisterSession) {
      return null;
    }

    if (
      locallyCompletedSessionIdsRef.current.has(
        localOperablePosSession.localPosSessionId,
      )
    ) {
      return null;
    }

    return {
      _id: localOperablePosSession.localPosSessionId,
      _creationTime: localOperablePosSession.startedAt,
      storeId: localOperablePosSession.storeId,
      terminalId: localOperablePosSession.terminalId,
      staffProfileId: staffProfileId ?? undefined,
      status: "active",
      createdAt: localOperablePosSession.startedAt,
      expiresAt: Number.MAX_SAFE_INTEGER,
      sessionNumber: "Local sale",
      sessionSource: "local",
      updatedAt: localOperablePosSession.startedAt,
      registerNumber: localOperablePosSession.registerNumber,
      localRegisterSessionId: localOperablePosSession.localRegisterSessionId,
      cartItems: [],
      payments: [],
      customer: null,
      localSyncStatus: {
        status: "pending_sync",
        pendingEventCount: 1,
      },
    };
  }, [
    activeStoreId,
    isProjectedLocalActiveSaleOwnedByCurrentStaff,
    localStaffPendingUploadCount,
    localOperablePosSession,
    locallyOperableRegisterSession,
    projectedLocalActiveSale,
    staffProfileId,
  ]);
  const visibleActiveSession = asCloudOperableSession(
    activeSession &&
      !locallyCompletedSessionIdsRef.current.has(
        activeSession._id.toString(),
      ) &&
      localRegisterReadModel?.activeSale?.localPosSessionId !==
        activeSession._id.toString() &&
      !localRegisterReadModel?.clearedSaleIds.includes(
        activeSession._id.toString(),
      ) &&
      !localRegisterReadModel?.completedSales.some(
        (sale) => sale.localPosSessionId === activeSession._id.toString(),
      )
      ? activeSession
      : null,
  );
  const operableActiveSession: OperableActiveSession | null =
    localActiveSession ?? visibleActiveSession;
  useEffect(() => {
    if (operableActiveSession) {
      pendingSessionStartKeyRef.current = null;
    }
  }, [operableActiveSession]);
  const serverCartItems = useMemo(
    () => operableActiveSession?.cartItems ?? [],
    [operableActiveSession?.cartItems],
  );
  const activeCartItems = useMemo(() => {
    const cartItems = serverCartItems
      .filter(
        (item) =>
          !optimisticallyRemovedCartLineKeys[
            removedCartLineKeyFromCartItem(item)
          ],
      )
      .map((item) => {
        const optimisticQuantity = optimisticCartQuantities[item.id];
        return optimisticQuantity === undefined
          ? item
          : { ...item, quantity: optimisticQuantity };
      })
      .filter((item) => item.quantity > 0);

    for (const optimisticProduct of Object.values(optimisticCartProducts)) {
      if (
        optimisticallyRemovedCartLineKeys[
          removedCartLineKeyFromCartItem(optimisticProduct)
        ]
      ) {
        continue;
      }

      if (!optimisticProduct.skuId) {
        cartItems.push(optimisticProduct);
        continue;
      }

      const existingIndex = cartItems.findIndex(
        (item) =>
          item.skuId === optimisticProduct.skuId &&
          renderedCartLineSourceKey(item) ===
            renderedCartLineSourceKey(optimisticProduct),
      );
      if (existingIndex >= 0) {
        const existingItem = cartItems[existingIndex];
        const optimisticQuantity = optimisticCartQuantities[existingItem.id];
        const existingItemIsOptimistic = existingItem.id
          .toString()
          .startsWith("optimistic:");
        if (optimisticQuantity === undefined && existingItemIsOptimistic) {
          cartItems[existingIndex] = {
            ...existingItem,
            quantity: optimisticProduct.quantity,
          };
        }
      } else {
        cartItems.push(optimisticProduct);
      }
    }

    return cartItems;
  }, [
    optimisticCartProducts,
    optimisticCartQuantities,
    optimisticallyRemovedCartLineKeys,
    serverCartItems,
  ]);
  activeCartItemsRef.current = activeCartItems;
  localRegisterReadModelRef.current = localRegisterReadModel;
  const localAvailabilityConsumptionBySkuId = useMemo(() => {
    const quantities = localAvailabilityConsumptionFromReadModel(
      localRegisterReadModel,
    );

    for (const product of Object.values(optimisticCartProducts)) {
      if (!product.skuId) continue;
      if (cartLineSourceKey(product) !== "trusted_inventory") continue;

      quantities.set(
        product.skuId,
        (quantities.get(product.skuId) ?? 0) + product.quantity,
      );
    }

    return quantities;
  }, [localRegisterReadModel, optimisticCartProducts]);
  localAvailabilityConsumptionBySkuIdRef.current =
    localAvailabilityConsumptionBySkuId;
  const localRegisterCatalogAvailabilityBySkuId = useMemo(() => {
    const adjusted = new Map<string, RegisterCatalogAvailability>();

    for (const [
      productSkuId,
      availability,
    ] of registerCatalogAvailabilityBySkuId) {
      const quantityAvailable = Math.max(
        0,
        availability.availabilityPolicy === "active_provisional_import" ||
          availability.availabilityPolicy === "pending_checkout"
          ? 0
          : Math.trunc(availability.quantityAvailable) -
              (localAvailabilityConsumptionBySkuId.get(productSkuId) ?? 0),
      );

      adjusted.set(productSkuId, {
        ...availability,
        inStock:
          availability.availabilityPolicy === "active_provisional_import" ||
          availability.availabilityPolicy === "pending_checkout"
            ? availability.inStock
            : availability.inStock && quantityAvailable > 0,
        quantityAvailable,
      });
    }

    return adjusted;
  }, [localAvailabilityConsumptionBySkuId, registerCatalogAvailabilityBySkuId]);
  const registerSearchState = useMemo<RegisterCatalogSearchResult>(() => {
    if (!terminalCanTransactProducts) {
      const query = productSearchQuery.trim();
      return query
        ? {
            canAutoAdd: false,
            exactMatch: null,
            intent: "text",
            query,
            results: [],
          }
        : {
            canAutoAdd: false,
            exactMatch: null,
            intent: "empty",
            query: "",
            results: [],
          };
    }

    if (registerMetadataSearchState.intent !== "exact") {
      return registerMetadataSearchState;
    }

    const exactAvailability = registerMetadataSearchState.exactMatch
      ? localRegisterCatalogAvailabilityBySkuId.get(
          registerMetadataSearchState.exactMatch.productSkuId,
        )
      : undefined;

    return {
      ...registerMetadataSearchState,
      canAutoAdd: Boolean(
        registerMetadataSearchState.exactMatch &&
        exactAvailability &&
        (exactAvailability.availabilityPolicy === "active_provisional_import" ||
          exactAvailability.availabilityPolicy === "pending_checkout" ||
          exactAvailability.quantityAvailable >= 0),
      ),
    };
  }, [
    localRegisterCatalogAvailabilityBySkuId,
    productSearchQuery,
    registerMetadataSearchState,
    terminalCanTransactProducts,
  ]);
  const registerSearchProducts = useMemo(() => {
    const catalogProducts = registerSearchState.results.map((row) =>
      mapCatalogRowToProduct(
        row,
        localRegisterCatalogAvailabilityBySkuId.get(row.productSkuId),
      ),
    );
    const catalogProductSkuIds = new Set(
      catalogProducts.flatMap((product) =>
        product.skuId ? [product.skuId.toString()] : [],
      ),
    );
    const activePendingCheckoutProducts = activeCartItems
      .filter(
        (item) =>
          "pendingCheckoutItemId" in item &&
          Boolean(item.pendingCheckoutItemId) &&
          item.skuId &&
          !catalogProductSkuIds.has(item.skuId.toString()) &&
          pendingCheckoutCartItemMatchesSearch(item, productSearchQuery),
      )
      .map(mapPendingCheckoutCartItemToProduct);
    const activePendingCheckoutSkuIds = new Set(
      activePendingCheckoutProducts.flatMap((product) =>
        product.skuId ? [product.skuId.toString()] : [],
      ),
    );
    const activePendingCheckoutItemIds = new Set(
      activePendingCheckoutProducts.flatMap((product) =>
        product.pendingCheckoutItemId
          ? [product.pendingCheckoutItemId.toString()]
          : [],
      ),
    );
    const savedPendingCheckoutProducts =
      mapLocalPendingCheckoutEventsToProducts(
        localRegisterReadModel?.sourceEvents ?? [],
      ).filter(
        (product) =>
          product.skuId &&
          product.pendingCheckoutItemId &&
          !catalogProductSkuIds.has(product.skuId.toString()) &&
          !activePendingCheckoutSkuIds.has(product.skuId.toString()) &&
          !activePendingCheckoutItemIds.has(
            product.pendingCheckoutItemId.toString(),
          ) &&
          pendingCheckoutFieldsMatchSearch(
            {
              barcode: product.barcode,
              name: product.name,
              productId: product.productId?.toString(),
              sku: product.sku,
              skuId: product.skuId?.toString(),
            },
            productSearchQuery,
          ),
      );

    return [
      ...activePendingCheckoutProducts,
      ...savedPendingCheckoutProducts,
      ...catalogProducts,
    ];
  }, [
    activeCartItems,
    localRegisterCatalogAvailabilityBySkuId,
    localRegisterReadModel?.sourceEvents,
    productSearchQuery,
    registerSearchState.results,
  ]);
  const exactSearchProduct = registerSearchState.exactMatch
    ? mapCatalogRowToProduct(
        registerSearchState.exactMatch,
        localRegisterCatalogAvailabilityBySkuId.get(
          registerSearchState.exactMatch.productSkuId,
        ),
      )
    : null;
  if (isCloudOperableSession(operableActiveSession)) {
    unmountSessionRef.current = operableActiveSession._id;
    unmountSessionCartItemCountRef.current = activeCartItems.length;
  } else {
    unmountSessionRef.current = null;
    unmountSessionCartItemCountRef.current = 0;
  }
  voidSessionRef.current = voidSession;
  useEffect(() => {
    setOptimisticCartQuantities((current) => {
      let changed = false;
      const next = { ...current };

      for (const [itemId, optimisticQuantity] of Object.entries(current)) {
        const serverItem = serverCartItems.find((item) => item.id === itemId);
        if (
          (optimisticQuantity <= 0 && !serverItem) ||
          serverItem?.quantity === optimisticQuantity
        ) {
          delete next[itemId];
          changed = true;
        }
      }

      return changed ? next : current;
    });

    setOptimisticCartProducts((current) => {
      let changed = false;
      const next = { ...current };

      for (const [skuId, optimisticProduct] of Object.entries(current)) {
        const serverItem = serverCartItems.find((item) => item.skuId === skuId);
        if (serverItem && serverItem.quantity >= optimisticProduct.quantity) {
          delete next[skuId];
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [serverCartItems]);
  const activeTotals = useMemo(
    () => calculatePosCartTotals(activeCartItems),
    [activeCartItems],
  );
  const serviceSearchResults = useMemo(() => {
    if (!terminalCanTransactServices) {
      return [];
    }

    const index = buildRegisterServiceCatalogIndex(
      serviceCatalogRows
        .filter((row) => row.status === undefined || row.status === "active")
        .map(mapServiceCatalogRowToSearchRow),
    );
    return searchRegisterServiceCatalog(index, productSearchQuery, {
      limit: 25,
    }).results.map((result) =>
      mapServiceCatalogRowToRegisterSearchResult({
        serviceCatalogId: result.serviceCatalogId as Id<"serviceCatalog">,
        name: result.name,
        description: result.description ?? undefined,
        serviceMode: result.serviceMode,
        pricingModel: result.pricingModel,
        basePrice: result.basePrice ?? undefined,
        depositType: result.depositType,
        depositValue: result.depositValue ?? undefined,
        requiresManagerApproval: result.requiresManagerApproval,
        status: "active",
        updatedAt: serviceCatalogRows.find(
          (row) => row.serviceCatalogId.toString() === result.serviceCatalogId,
        )?.updatedAt,
        checkoutReadiness: result.checkoutReadiness,
      }),
    );
  }, [productSearchQuery, serviceCatalogRows, terminalCanTransactServices]);
  const serviceSubtotal = useMemo(
    () =>
      calculatePosCartTotals(serviceLineDrafts.map(serviceLineStateToCartLine))
        .subtotal,
    [serviceLineDrafts],
  );
  const combinedActiveTotals = useMemo(
    () =>
      calculatePosCartTotals([
        ...activeCartItems,
        ...serviceLineDrafts.map(serviceLineStateToCartLine),
      ]),
    [activeCartItems, serviceLineDrafts],
  );
  const serviceCheckoutBlockMessage = useMemo(
    () =>
      buildServiceCheckoutBlockMessage({
        customerInfo,
        serviceItems: serviceLineDrafts,
      }),
    [customerInfo, serviceLineDrafts],
  );
  const hasActiveCustomerDetails = hasCustomerDetails(customerInfo);
  const hasActiveCartDraft =
    activeCartItems.length > 0 || serviceLineDrafts.length > 0;
  const hasInProgressSaleDraft =
    hasActiveCartDraft || hasActiveCustomerDetails || payments.length > 0;
  const hasClearableSaleState = Boolean(
    operableActiveSession && hasInProgressSaleDraft,
  );
  const hasActivePosSession = Boolean(operableActiveSession?._id);
  const hasCloudBlockedRecoverableLocalSale = Boolean(
    cloudRegisterSessionBlocksLocalProjection &&
    projectedLocalActiveSale &&
    isProjectedLocalActiveSaleOwnedByCurrentStaff,
  );
  const activeSessionNeedsRegisterBinding = Boolean(
    isCloudOperableSession(operableActiveSession) &&
      !operableActiveSession.registerSessionId &&
      !locallyOperableRegisterSession,
  );
  const activeSessionHasMismatchedRegisterBinding = Boolean(
    isCloudOperableSession(operableActiveSession) &&
    operableActiveSession.registerSessionId &&
    activeRegisterSessionId &&
    operableActiveSession.registerSessionId !== activeRegisterSessionId,
  );
  const activeSessionHasBlockedRegisterBinding =
    activeSessionNeedsRegisterBinding ||
    activeSessionHasMismatchedRegisterBinding;
  const hasCloseoutBlockedDrawerState = Boolean(
    bootstrapState &&
    closeoutBlockedRegisterSession &&
    !saleUsableActiveRegisterSession,
  );
  const hasMissingDrawerStartupState = Boolean(
    bootstrapState &&
    (bootstrapState.phase === "readyToStart" ||
      bootstrapState.phase === "resumable") &&
    !saleUsableActiveRegisterSession &&
    !locallyOperableRegisterSession,
  );
  const hasMissingDrawerRecoveryState = Boolean(
    bootstrapState &&
    !saleUsableActiveRegisterSession &&
    !locallyOperableRegisterSession &&
    (bootstrapState.phase === "active" ||
      bootstrapState.phase === "resumable" ||
      hasActivePosSession),
  );
  const hasDraftDrawerRecoveryState = Boolean(
    hasInProgressSaleDraft &&
    !saleUsableActiveRegisterSession &&
    !locallyOperableRegisterSession &&
    !localEventRegisterSessionId &&
    !isTransactionCompleted,
  );
  const rawLocalSaleAuthorityBlockReason =
    localRegisterReadModel?.saleBlockReason ?? null;
  const hasSettledLocalCloseoutBlock =
    rawLocalSaleAuthorityBlockReason === "drawer_closed" &&
    hasSettledRegisterCloseout({
      events: localRegisterReadModel?.sourceEvents ?? [],
      session: localRegisterReadModel?.activeRegisterSession,
    });
  const localSaleAuthorityBlockReason = hasSettledLocalCloseoutBlock
    ? null
    : rawLocalSaleAuthorityBlockReason;
  const localDrawerAuthorityReason =
    localRegisterReadModel?.drawerAuthorityReason ?? null;
  const hasRecoverableDrawerAuthorityBlock =
    localDrawerAuthorityReason === "authority_unknown";
  const hasLifecycleReviewDrawerBlock =
    localDrawerAuthorityReason === "lifecycle_rejected";
  const hasLocalSaleAuthorityBlock = Boolean(localSaleAuthorityBlockReason);
  const requiresDrawerGate = Boolean(
    activeStoreId &&
    terminal?._id &&
    staffProfileId &&
    ((bootstrapState &&
      (hasMissingDrawerStartupState ||
        hasCloseoutBlockedDrawerState ||
        hasMissingDrawerRecoveryState)) ||
      hasCloudBlockedRecoverableLocalSale ||
      hasDraftDrawerRecoveryState ||
      activeSessionHasBlockedRegisterBinding ||
      hasLocalSaleAuthorityBlock),
  );
  const closeoutBlockedGateIsRecovery = Boolean(
    hasCloseoutBlockedDrawerState &&
    (hasMissingDrawerRecoveryState || activeSessionHasBlockedRegisterBinding),
  );
  const localCloseoutRegisterSession = locallyOperableRegisterSession
    ? {
        localRegisterSessionId:
          locallyOperableRegisterSession.localRegisterSessionId,
        status: "active" as const,
        terminalId: locallyOperableRegisterSession.terminalId,
        registerNumber: locallyOperableRegisterSession.registerNumber,
        openingFloat: locallyOperableRegisterSession.openingFloat,
        expectedCash: locallyOperableRegisterSession.expectedCash,
        countedCash: undefined,
        managerApprovalRequestId: undefined,
        openedAt: locallyOperableRegisterSession.openedAt,
        variance: undefined,
        localSyncStatus: {
          status: "pending_sync",
          pendingEventCount: 1,
        },
      }
    : null;
  const activeCloseoutRegisterSession =
    closeoutBlockedRegisterSession ??
    (isCloseoutRequested
      ? (localCloseoutRegisterSession ?? saleUsableActiveRegisterSession)
      : null);
  const activeCloseoutRegisterSessionHasSyncReview = Boolean(
    findRegisterCloseoutReviewItem(activeCloseoutRegisterSession),
  );
  const activeCloseoutRegisterSessionHasSubmittedCount =
    activeCloseoutRegisterSession?.countedCash !== undefined;
  const activeCloseoutRegisterSessionSyncStatus =
    activeCloseoutRegisterSession?.localSyncStatus?.status;
  const activeCloseoutSubmittedReason:
    | "manager_review"
    | "pending_sync"
    | undefined =
    activeCloseoutRegisterSessionHasSyncReview ||
    Boolean(activeCloseoutRegisterSession?.managerApprovalRequestId)
      ? "manager_review"
      : activeCloseoutRegisterSessionHasSubmittedCount &&
          (activeCloseoutRegisterSession?.status === "closing" ||
            activeCloseoutRegisterSessionSyncStatus ===
              "locally_closed_pending_sync" ||
            activeCloseoutRegisterSessionSyncStatus === "pending_sync")
        ? "pending_sync"
        : undefined;
  const activeOpeningFloatCorrectionRegisterSession =
    isOpeningFloatCorrectionRequested && usableActiveRegisterSession
      ? usableActiveRegisterSession
      : null;
  const drawerGateMode:
    | "initialSetup"
    | "recovery"
    | "closeoutBlocked"
    | "openingFloatCorrection"
    | "terminalRepair"
    | "drawerAuthorityRepair" = activeOpeningFloatCorrectionRegisterSession
    ? "openingFloatCorrection"
    : localSaleAuthorityBlockReason === "terminal_integrity"
      ? "terminalRepair"
      : hasLifecycleReviewDrawerBlock
        ? "recovery"
        : localSaleAuthorityBlockReason === "drawer_authority" &&
            hasRecoverableDrawerAuthorityBlock
          ? "drawerAuthorityRepair"
          : hasCloseoutBlockedDrawerState || activeCloseoutRegisterSession
            ? "closeoutBlocked"
            : hasMissingDrawerRecoveryState ||
                hasCloudBlockedRecoverableLocalSale ||
                hasDraftDrawerRecoveryState ||
                activeSessionHasBlockedRegisterBinding
              ? "recovery"
              : "initialSetup";
  const handleRepairTerminalSetup = useCallback(async () => {
    if (!activeStoreId || !terminal?._id || typeof indexedDB === "undefined") {
      setDrawerErrorMessage(
        "Terminal setup repair is not available on this browser.",
      );
      return;
    }

    const fingerprint = readStoredTerminalFingerprint();
    if (!fingerprint) {
      setDrawerErrorMessage(
        "Terminal setup repair needs this browser fingerprint. Open POS Settings to repair setup.",
      );
      return;
    }

    setIsRepairingTerminalSetup(true);
    try {
      const seedResult = await localStore.readProvisionedTerminalSeed();
      const seed = seedResult.ok ? seedResult.value : null;

      if (
        !seed ||
        seed.storeId !== activeStoreId ||
        seed.cloudTerminalId !== terminal._id ||
        seed.terminalId !== fingerprint.fingerprintHash
      ) {
        setDrawerErrorMessage(
          "Terminal setup repair needs the current local setup record. Open POS Settings to repair setup.",
        );
        return;
      }

      const repairRegisterNumber =
        seed.registerNumber ?? terminal.registerNumber ?? registerNumber;
      if (!repairRegisterNumber) {
        setDrawerErrorMessage(
          "Register number required. Open POS Settings to repair setup.",
        );
        return;
      }

      const result = await registerAndProvisionPosTerminal({
        activeStoreId,
        browserInfo: fingerprint.browserInfo,
        displayName: terminal.displayName || seed.displayName,
        fingerprintHash: fingerprint.fingerprintHash,
        orgUrlSlug: seed.orgUrlSlug,
        registerNumber: repairRegisterNumber,
        registerTerminalMutation,
        storeFactory: () => localStore,
        storeUrlSlug: seed.storeUrlSlug,
      });

      if (result.kind === "user_error") {
        setDrawerErrorMessage(toOperatorMessage(result.error.message));
        return;
      }

      setDrawerErrorMessage(null);
      noteLocalRuntimeChanged();
      await refreshLocalRegisterReadModel();
    } catch (error) {
      logger.warn("[POS] Terminal setup auto repair failed", {
        error,
        storeId: activeStoreId,
        terminalId: terminal._id,
      });
      setDrawerErrorMessage("Unable to repair terminal setup. Try again.");
    } finally {
      setIsRepairingTerminalSetup(false);
    }
  }, [
    activeStoreId,
    localStore,
    noteLocalRuntimeChanged,
    refreshLocalRegisterReadModel,
    registerNumber,
    registerTerminalMutation,
    terminal?._id,
    terminal?.displayName,
    terminal?.registerNumber,
  ]);
  useEffect(() => {
    if (drawerGateMode !== "terminalRepair") {
      autoTerminalRepairAttemptRef.current = null;
      return;
    }
    if (!activeStoreId || !terminal?._id || isRepairingTerminalSetup) {
      return;
    }

    const repairKey = `${activeStoreId}:${terminal._id}`;
    if (autoTerminalRepairAttemptRef.current === repairKey) {
      return;
    }
    autoTerminalRepairAttemptRef.current = repairKey;
    void handleRepairTerminalSetup();
  }, [
    activeStoreId,
    drawerGateMode,
    handleRepairTerminalSetup,
    isRepairingTerminalSetup,
    terminal?._id,
  ]);
  const guardActiveSessionConflict = useCallback(() => {
    if (!activeSessionConflict) {
      return false;
    }

    presentOperatorError(activeSessionConflict.message);
    return true;
  }, [activeSessionConflict]);

  const resetDraftState = useCallback(
    (options?: {
      keepCashier?: boolean;
      keepTransactionCompletion?: boolean;
    }) => {
      setShowCustomerPanel(false);
      setShowProductEntry(true);
      setProductSearchQuery("");
      setServiceLineDrafts([]);
      setCustomerInfo(EMPTY_REGISTER_CUSTOMER_INFO);
      setPaymentState([]);
      setOptimisticCartProducts({});
      setOptimisticCartQuantities({});
      setOptimisticallyRemovedCartLineKeys({});
      setLocalOperablePosSession(null);

      if (!options?.keepTransactionCompletion) {
        setIsTransactionCompleted(false);
        setCompletedOrderNumber(null);
        setCompletedTransactionData(null);
      }

      if (!options?.keepCashier) {
        setStaffProfileId(null);
        setStaffProofToken(null);
        setLocalAuthenticatedStaff(null);
        setLocalOperableRegisterSession(null);
        setCashierPresenceRestore({ status: "missing" });
      }
    },
    [setPaymentState],
  );

  useEffect(() => {
    if (!activeRegisterSessionId) {
      return;
    }

    setDrawerOpeningFloat("");
    setDrawerNotes("");
    setDrawerErrorMessage(null);
    setIsOpeningDrawer(false);
    setLocalOperableRegisterSession(null);
    setLocalOperablePosSession(null);
  }, [activeRegisterSessionId]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      activeSessionIdRef.current = null;
      const sessionId = unmountSessionRef.current;
      const hasCartItems = unmountSessionCartItemCountRef.current > 0;

      if (!sessionId || hasCartItems) {
        return;
      }

      const sessionVoidOperation = voidSessionRef.current;
      if (!sessionVoidOperation) {
        return;
      }

      void (async () => {
        const result = await sessionVoidOperation({
          sessionId,
        });

        if (result.kind !== "ok") {
          logger.warn("[POS] Failed to void empty session on unmount", {
            sessionId,
            error: result.error.message,
          });
        }
      })();
    };
  }, []);

  useEffect(() => {
    requestBootstrap();
  }, [
    requestBootstrap,
    activeStoreId,
    terminal?._id,
    staffProfileId,
    registerNumber,
  ]);

  useEffect(() => {
    const sessionId = operableActiveSession?._id ?? null;
    if (sessionId === syncedSessionId.current) {
      return;
    }

    syncedSessionId.current = sessionId;

    if (!sessionId) {
      resetCheckoutStateVersion();
      if (!isTransactionCompleted) {
        setCustomerInfo(EMPTY_REGISTER_CUSTOMER_INFO);
        setPaymentState([]);
        setShowCustomerPanel(false);
      }
      return;
    }

    resetCheckoutStateVersion();
    setCustomerInfo(
      mapSessionCustomer(operableActiveSession?.customer ?? null),
    );
    setPaymentState(
      combinePaymentsByMethod(
        (operableActiveSession?.payments ?? []).map((payment) => ({
          id: createPaymentId(),
          method: payment.method as PosPaymentMethod,
          amount: payment.amount,
          timestamp: payment.timestamp,
        })),
      ),
    );
    setShowCustomerPanel(Boolean(operableActiveSession?.customer));
    setIsTransactionCompleted(false);
    setCompletedOrderNumber(null);
    setCompletedTransactionData(null);
  }, [
    operableActiveSession?._id,
    operableActiveSession?.customer,
    operableActiveSession?.payments,
    isTransactionCompleted,
    resetCheckoutStateVersion,
    setPaymentState,
  ]);

  const ensureLocalRegisterSessionReady = useCallback(
    async (
      localRegisterSessionId: string,
      options?: { staffProfileId?: Id<"staffProfile"> },
    ) => {
      const actingStaffProfileId = options?.staffProfileId ?? staffProfileId;

      if (
        seededRegisterSessionIdsRef.current.has(localRegisterSessionId) ||
        locallyOperableRegisterSession?.localRegisterSessionId ===
          localRegisterSessionId ||
        (localRegisterReadModel?.canSell &&
          localRegisterReadModel.activeRegisterSession
            ?.localRegisterSessionId === localRegisterSessionId)
      ) {
        return true;
      }

      if (
        !usableActiveRegisterSession ||
        usableActiveRegisterSession._id.toString() !== localRegisterSessionId ||
        !activeStoreId ||
        !terminal?._id ||
        !actingStaffProfileId
      ) {
        return false;
      }

      const savedLocally = await localCommandGateway.seedRegisterSession({
        terminalId: terminal._id,
        storeId: activeStoreId!,
        registerNumber,
        localRegisterSessionId,
        staffProfileId: actingStaffProfileId,
        validationMetadata: localSaleValidationMetadata,
        openingFloat: usableActiveRegisterSession.openingFloat,
        expectedCash: usableActiveRegisterSession.expectedCash,
        notes: usableActiveRegisterSession.notes ?? null,
        status: usableActiveRegisterSession.status,
      });
      if (savedLocally) {
        seededRegisterSessionIdsRef.current.add(localRegisterSessionId);
        noteLocalRegisterEventChanged();
      }
      return Boolean(savedLocally);
    },
    [
      activeStoreId,
      localRegisterReadModel?.activeRegisterSession?.localRegisterSessionId,
      localRegisterReadModel?.canSell,
      localCommandGateway,
      localSaleValidationMetadata,
      locallyOperableRegisterSession?.localRegisterSessionId,
      noteLocalRegisterEventChanged,
      registerNumber,
      staffProfileId,
      terminal?._id,
      usableActiveRegisterSession,
    ],
  );

  const ensureLocalPosSessionId = useCallback(async (): Promise<
    string | null
  > => {
    const localRegisterSessionId =
      locallyOperableRegisterSession?.localRegisterSessionId ??
      localEventRegisterSessionId;

    if (operableActiveSession?._id) {
      if (!localRegisterSessionId) {
        toast.error("Drawer closed. Open the drawer before adding items.");
        return null;
      }
      if (!(await ensureLocalRegisterSessionReady(localRegisterSessionId))) {
        toast.error("Drawer closed. Open the drawer before adding items.");
        return null;
      }
      if (!activeStoreId || !terminal?._id || !staffProfileId) {
        toast.error("Register sign-in required. Sign in before adding items.");
        return null;
      }
      if (
        shouldReplaceProjectedLocalActiveSaleForCurrentStaff &&
        !(await clearProjectedLocalSaleForStaff(staffProfileId, {
          requireEmpty: true,
        }))
      ) {
        toast.error(
          "This local sale belongs to another signed-in staff member.",
        );
        return null;
      }
      const localSession = await localCommandGateway.startSession({
        storeId: activeStoreId!,
        terminalId: terminal._id as Id<"posTerminal">,
        staffProfileId,
        registerNumber,
        localRegisterSessionId,
        localPosSessionId: operableActiveSession._id.toString(),
        validationMetadata: localSaleValidationMetadata,
      });
      if (localSession.kind !== "ok") {
        toast.error("Unable to start this sale. Try again.");
        return null;
      }
      noteLocalRegisterEventChanged();
      return operableActiveSession._id.toString();
    }

    if (registerState?.activeSession?._id) {
      return registerState.activeSession._id.toString();
    }

    if (!localRegisterSessionId) {
      toast.error("Drawer closed. Open the drawer before adding items.");
      return null;
    }

    if (!activeStoreId || !terminal?._id || !staffProfileId) {
      toast.error("Register sign-in required. Sign in before adding items.");
      return null;
    }

    if (
      shouldReplaceProjectedLocalActiveSaleForCurrentStaff &&
      !(await clearProjectedLocalSaleForStaff(staffProfileId, {
        requireEmpty: true,
      }))
    ) {
      toast.error("This local sale belongs to another signed-in staff member.");
      return null;
    }

    if (!(await hasProvisionedLocalSyncSeed())) {
      toast.error(
        "Terminal setup required. Register this terminal before selling.",
      );
      return null;
    }

    if (!(await ensureLocalRegisterSessionReady(localRegisterSessionId))) {
      toast.error("Drawer closed. Open the drawer before adding items.");
      return null;
    }

    const result = await localCommandGateway.startSession({
      storeId: activeStoreId!,
      terminalId: terminal._id as Id<"posTerminal">,
      staffProfileId,
      registerNumber,
      localRegisterSessionId,
      validationMetadata: localSaleValidationMetadata,
    });

    if (result.kind !== "ok") {
      toast.error("Unable to start this sale. Try again.");
      return null;
    }

    const localPosSessionId = result.data.localPosSessionId;
    noteLocalRegisterEventChanged();
    setLocalOperablePosSession({
      localPosSessionId,
      localRegisterSessionId,
      registerNumber,
      startedAt: Date.now(),
      storeId: activeStoreId!,
      terminalId: terminal._id,
    });
    bootstrapInitialized.current = true;
    return localPosSessionId;
  }, [
    operableActiveSession?._id,
    localEventRegisterSessionId,
    activeStoreId,
    clearProjectedLocalSaleForStaff,
    ensureLocalRegisterSessionReady,
    hasProvisionedLocalSyncSeed,
    shouldReplaceProjectedLocalActiveSaleForCurrentStaff,
    localCommandGateway,
    localSaleValidationMetadata,
    locallyOperableRegisterSession,
    noteLocalRegisterEventChanged,
    staffProfileId,
    registerNumber,
    registerState?.activeSession?._id,
    terminal?._id,
  ]);

  const projectedLocalServiceLines = projectedLocalActiveSale?.serviceLines;
  const projectedLocalSaleId = projectedLocalActiveSale?.localPosSessionId;
  const projectedLocalSaleUpdatedAt = projectedLocalActiveSale?.updatedAt;
  useEffect(() => {
    if (
      !projectedLocalServiceLines ||
      !isProjectedLocalActiveSaleOwnedByCurrentStaff
    ) {
      return;
    }

    const nextServiceLineDrafts = projectedLocalServiceLines.map(
      mapLocalServiceLineToState,
    );
    serviceLineDraftsRef.current = nextServiceLineDrafts;
    setServiceLineDrafts(nextServiceLineDrafts);
  }, [
    isProjectedLocalActiveSaleOwnedByCurrentStaff,
    projectedLocalSaleId,
    projectedLocalSaleUpdatedAt,
    projectedLocalServiceLines,
  ]);

  const persistSessionMetadata = useCallback(
    async (session: OperableActiveSession | null | undefined) => {
      if (!isCloudOperableSession(session) || !staffProfileId) {
        return true;
      }

      const result = await updateSession({
        sessionId: session._id,
        staffProfileId,
        customerProfileId: customerInfo.customerProfileId,
        customerInfo: hasCustomerDetails(customerInfo)
          ? {
              name: customerInfo.name || undefined,
              email: customerInfo.email || undefined,
              phone: customerInfo.phone || undefined,
            }
          : undefined,
        subtotal: activeTotals.subtotal,
        tax: activeTotals.tax,
        total: activeTotals.total,
      });

      if (result.kind === "ok") {
        return true;
      }

      if (result.kind === "unexpected_error") {
        logger.error(
          "[POS] Failed to update session metadata",
          new Error(result.error.message),
        );
      }

      presentOperatorError(result.error.message);
      return false;
    },
    [
      activeTotals.subtotal,
      activeTotals.tax,
      activeTotals.total,
      customerInfo,
      staffProfileId,
      updateSession,
    ],
  );

  const commitCustomerInfoBestEffort = useCallback(
    async (nextCustomerInfo: CustomerInfo) => {
      if (!isCloudOperableSession(operableActiveSession) || !staffProfileId) {
        return;
      }

      const sessionId = operableActiveSession._id;

      const totals = {
        subtotal: activeTotals.subtotal,
        tax: activeTotals.tax,
        total: activeTotals.total,
      };

      const persistCustomerInfo = async () => {
        if (!isMountedRef.current || activeSessionIdRef.current !== sessionId) {
          return;
        }

        const result = await updateSession({
          sessionId,
          staffProfileId,
          customerProfileId: nextCustomerInfo.customerProfileId,
          customerInfo: hasCustomerDetails(nextCustomerInfo)
            ? {
                name: nextCustomerInfo.name || undefined,
                email: nextCustomerInfo.email || undefined,
                phone: nextCustomerInfo.phone || undefined,
              }
            : undefined,
          subtotal: totals.subtotal,
          tax: totals.tax,
          total: totals.total,
        });

        if (result.kind !== "ok") {
          logger.warn("[POS] Failed to sync committed customer details", {
            sessionId,
            error: result.error.message,
          });
        }
      };

      customerCommitQueueRef.current = customerCommitQueueRef.current
        .catch(() => undefined)
        .then(persistCustomerInfo);

      await customerCommitQueueRef.current;
    },
    [
      operableActiveSession,
      activeTotals.subtotal,
      activeTotals.tax,
      activeTotals.total,
      staffProfileId,
      updateSession,
    ],
  );

  const persistCheckoutStateLocally = useCallback(
    async (args: {
      nextPayments: Payment[];
      stage:
        | "paymentAdded"
        | "paymentUpdated"
        | "paymentRemoved"
        | "paymentsCleared";
      checkoutStateVersion: number;
      paymentMethod?: PosPaymentMethod;
      amount?: number;
      previousAmount?: number;
    }) => {
      if (!operableActiveSession?._id || !staffProfileId) {
        return false;
      }

      if (activeSessionHasBlockedRegisterBinding) {
        logger.warn(
          "[POS] Skipped checkout persistence while drawer recovery is required",
          {
            sessionId: operableActiveSession._id,
            stage: args.stage,
          },
        );
        return false;
      }

      if (!activeStoreId || !terminal?._id) {
        return false;
      }

      if (!(await hasProvisionedLocalSyncSeed())) {
        logger.warn(
          "[POS] Skipped checkout persistence before terminal setup",
          {
            sessionId: operableActiveSession._id,
            stage: args.stage,
          },
        );
        return false;
      }

      const savedLocally = await localCommandGateway.appendPaymentState({
        terminalId: terminal._id,
        storeId: activeStoreId!,
        registerNumber,
        localRegisterSessionId: localEventRegisterSessionId ?? registerNumber,
        localPosSessionId: operableActiveSession._id.toString(),
        staffProfileId,
        validationMetadata: localSaleValidationMetadata,
        checkoutStateVersion: args.checkoutStateVersion,
        payments: args.nextPayments,
        stage: args.stage,
        paymentMethod: args.paymentMethod,
        amount: args.amount,
        previousAmount: args.previousAmount,
      });
      if (!savedLocally) {
        logger.warn("[POS] Failed to save local checkout state", {
          sessionId: operableActiveSession._id,
          stage: args.stage,
        });
        await refreshLocalRegisterReadModel();
        return false;
      }

      noteLocalRegisterEventChanged();
      return true;
    },
    [
      operableActiveSession?._id,
      activeSessionHasBlockedRegisterBinding,
      localEventRegisterSessionId,
      activeStoreId,
      hasProvisionedLocalSyncSeed,
      localCommandGateway,
      localSaleValidationMetadata,
      noteLocalRegisterEventChanged,
      registerNumber,
      refreshLocalRegisterReadModel,
      staffProfileId,
      terminal?._id,
    ],
  );

  useEffect(() => {
    if (
      isTransactionCompleted ||
      activeCartItems.length > 0 ||
      payments.length === 0
    ) {
      return;
    }

    const checkoutStateVersion = allocateCheckoutStateVersion();
    void (async () => {
      const saved = await persistCheckoutStateLocally({
        checkoutStateVersion,
        nextPayments: [],
        stage: "paymentsCleared",
      });
      if (saved) {
        setPaymentState([]);
      }
    })();
  }, [
    activeCartItems.length,
    allocateCheckoutStateVersion,
    isTransactionCompleted,
    payments.length,
    persistCheckoutStateLocally,
    setPaymentState,
  ]);

  useEffect(() => {
    if (
      isTransactionCompleted ||
      payments.length === 0 ||
      (activeCartItems.length === 0 && serviceLineDrafts.length === 0)
    ) {
      return;
    }

    const payableTotal = activeTotals.total + serviceSubtotal;
    const { adjustedPayments, changed } = normalizeNonCashOverpayment(
      payments,
      payableTotal,
    );
    if (!changed) {
      return;
    }

    const checkoutStateVersion = allocateCheckoutStateVersion();
    void (async () => {
      const saved = await persistCheckoutStateLocally({
        checkoutStateVersion,
        nextPayments: adjustedPayments,
        stage: "paymentUpdated",
      });
      if (saved) {
        setPaymentState(adjustedPayments);
      }
    })();
  }, [
    activeCartItems.length,
    activeTotals.total,
    allocateCheckoutStateVersion,
    isTransactionCompleted,
    payments,
    persistCheckoutStateLocally,
    serviceLineDrafts.length,
    serviceSubtotal,
    setPaymentState,
  ]);

  const holdCurrentSession = useCallback(
    async (reason?: string) => {
      if (!operableActiveSession || !staffProfileId) {
        toast.error(
          "No sale in progress. Start a sale before placing it on hold.",
        );
        return false;
      }

      if (
        isLocalOperableSession(operableActiveSession) ||
        localRegisterReadModel?.activeSale?.localPosSessionId ===
          operableActiveSession._id.toString()
      ) {
        toast.error(
          "Complete or clear this local sale before leaving the register.",
        );
        return false;
      }

      const persisted = await persistSessionMetadata(operableActiveSession);
      if (!persisted) {
        return false;
      }

      const result = await runHoldSession({
        gateway: {
          holdSession: holdSessionCommand,
        },
        command: {
          sessionId: operableActiveSession._id,
          staffProfileId,
          reason,
        },
      });

      if (!result.ok) {
        presentOperatorError(result.message);
        return false;
      }

      resetDraftState({
        keepCashier: true,
      });
      toast.success("Sale placed on hold");
      return true;
    },
    [
      operableActiveSession,
      localRegisterReadModel?.activeSale?.localPosSessionId,
      staffProfileId,
      holdSessionCommand,
      persistSessionMetadata,
      resetDraftState,
    ],
  );

  const voidCurrentSession = useCallback(async () => {
    if (!operableActiveSession) {
      toast.error("No sale in progress. Start a sale before clearing it.");
      return false;
    }

    const localSaleId = operableActiveSession._id.toString();
    const isProjectedLocalSale =
      localRegisterReadModel?.activeSale?.localPosSessionId === localSaleId;
    const hasServiceOnlyLocalDraft =
      serviceLineDrafts.length > 0 && activeCartItems.length === 0;

    if (
      isLocalOperableSession(operableActiveSession) ||
      isProjectedLocalSale ||
      hasServiceOnlyLocalDraft
    ) {
      if (checkoutMutationLockedRef.current) {
        toast.error(
          "Finish the current checkout update before clearing the sale.",
        );
        return false;
      }

      if (!staffProfileId) {
        toast.error("Register sign-in required. Sign in before clearing it.");
        return false;
      }

      setCheckoutMutationLocked(true);
      const hadCartItems =
        activeCartItems.length > 0 || serviceLineDrafts.length > 0;
      try {
        await waitForCheckoutMutationQueues();

        if (!activeStoreId || !terminal?._id) {
          presentOperatorError("Unable to update this sale. Try again.");
          return false;
        }
        const clearedLocalSaleId = hasServiceOnlyLocalDraft
          ? await ensureLocalPosSessionId()
          : localSaleId;
        if (!clearedLocalSaleId) {
          return false;
        }
        const savedLocally = await localCommandGateway.clearCart({
          terminalId: terminal._id,
          storeId: activeStoreId!,
          registerNumber,
          localRegisterSessionId: localEventRegisterSessionId ?? registerNumber,
          localPosSessionId: clearedLocalSaleId,
          staffProfileId,
          reason: "Sale cleared",
        });

        if (!savedLocally) {
          presentOperatorError("Unable to update this sale. Try again.");
          return false;
        }
        noteLocalRegisterEventChanged();
        locallyCompletedSessionIdsRef.current.add(localSaleId);

        resetDraftState({
          keepCashier: true,
        });
        if (hadCartItems) {
          toast.success("Sale cleared");
        }
        return true;
      } finally {
        setCheckoutMutationLocked(false);
      }
    }

    const result = await voidSession({
      sessionId: operableActiveSession._id as Id<"posSession">,
    });

    if (result.kind !== "ok") {
      presentOperatorError(result.error.message);
      return false;
    }

    const hadCartItems =
      operableActiveSession.cartItems.length > 0 ||
      serviceLineDrafts.length > 0;

    resetDraftState({
      keepCashier: true,
    });
    if (hadCartItems) {
      toast.success("Sale cleared");
    }
    return true;
  }, [
    activeCartItems,
    localEventRegisterSessionId,
    activeStoreId,
    checkoutMutationLockedRef,
    ensureLocalPosSessionId,
    localCommandGateway,
    localRegisterReadModel?.activeSale?.localPosSessionId,
    noteLocalRegisterEventChanged,
    operableActiveSession,
    registerNumber,
    resetDraftState,
    serviceLineDrafts.length,
    setCheckoutMutationLocked,
    staffProfileId,
    terminal?._id,
    voidSession,
    waitForCheckoutMutationQueues,
  ]);

  const handleResumeSession = useCallback(
    async (sessionId: Id<"posSession">) => {
      if (!staffProfileId || !terminal?._id) {
        toast.error(
          "Register sign-in required. Sign in before resuming a sale.",
        );
        return;
      }

      if (operableActiveSession && operableActiveSession._id !== sessionId) {
        const hasDraftState =
          operableActiveSession.cartItems.length > 0 ||
          serviceLineDrafts.length > 0;
        const handled = hasDraftState
          ? await holdCurrentSession(
              "Auto-held before resuming a different session",
            )
          : true;

        if (!handled) {
          return;
        }
      }

      const result = await resumeSession({
        sessionId,
        staffProfileId,
        terminalId: terminal._id,
      });

      if (result.kind !== "ok") {
        presentOperatorError(result.error.message);
        return;
      }

      setPaymentState([]);
      setShowCustomerPanel(false);
      bootstrapInitialized.current = true;
      toast.success("Sale resumed");
    },
    [
      operableActiveSession,
      serviceLineDrafts.length,
      staffProfileId,
      holdCurrentSession,
      resumeSession,
      setPaymentState,
      terminal?._id,
    ],
  );

  const handleStartNewSession = useCallback(
    async (options?: {
      force?: boolean;
      staffProfileId?: Id<"staffProfile">;
    }) => {
      if (guardActiveSessionConflict()) {
        return;
      }

      const actingStaffProfileId = options?.staffProfileId ?? staffProfileId;

      if (!activeStoreId || !terminal?._id || !actingStaffProfileId) {
        toast.error(
          "Register sign-in required. Sign in before starting a sale.",
        );
        return;
      }

      if (
        projectedLocalActiveSale &&
        projectedLocalActiveSale.staffProfileId !== actingStaffProfileId &&
        isEmptyLocalSaleShell(projectedLocalActiveSale) &&
        !(await clearProjectedLocalSaleForStaff(actingStaffProfileId))
      ) {
        toast.error(
          "This local sale belongs to another signed-in staff member.",
        );
        return;
      }

      const localRegisterSessionId =
        locallyOperableRegisterSession?.localRegisterSessionId ??
        localEventRegisterSessionId;

      if (!localRegisterSessionId) {
        toast.error("Drawer closed. Open the drawer before starting a sale.");
        return;
      }

      const sessionStartKey = `${localRegisterSessionId}:${actingStaffProfileId}`;
      if (pendingSessionStartKeyRef.current === sessionStartKey) {
        return;
      }
      pendingSessionStartKeyRef.current = sessionStartKey;
      let keepSessionStartGuard = false;

      try {
        if (!(await hasProvisionedLocalSyncSeed())) {
          toast.error(
            "Terminal setup required. Register this terminal before selling.",
          );
          return;
        }

        if (
          !(await ensureLocalRegisterSessionReady(localRegisterSessionId, {
            staffProfileId: actingStaffProfileId,
          }))
        ) {
          toast.error("Drawer closed. Open the drawer before starting a sale.");
          return;
        }

        if (operableActiveSession) {
          const hasDraftState =
            operableActiveSession.cartItems.length > 0 ||
            serviceLineDrafts.length > 0;
          const handled = hasDraftState
            ? await holdCurrentSession("Auto-held for new session")
            : true;

          if (!handled) {
            return;
          }
        }

        const result = await localCommandGateway.startSession({
          storeId: activeStoreId!,
          terminalId: terminal._id as Id<"posTerminal">,
          staffProfileId: actingStaffProfileId,
          registerNumber,
          localRegisterSessionId,
          validationMetadata: localSaleValidationMetadata,
        });

        if (result.kind !== "ok") {
          await refreshLocalRegisterReadModel();
          presentOperatorError(result.error.message);
          return;
        }

        const localPosSessionId = result.data.localPosSessionId;
        keepSessionStartGuard = true;
        noteLocalRegisterEventChanged();
        resetDraftState({
          keepCashier: true,
        });
        setLocalOperablePosSession({
          localPosSessionId,
          localRegisterSessionId,
          registerNumber,
          startedAt: Date.now(),
          storeId: activeStoreId!,
          terminalId: terminal._id,
        });
        bootstrapInitialized.current = true;
      } finally {
        if (
          !keepSessionStartGuard &&
          pendingSessionStartKeyRef.current === sessionStartKey
        ) {
          pendingSessionStartKeyRef.current = null;
        }
      }
    },
    [
      operableActiveSession,
      localEventRegisterSessionId,
      activeStoreId,
      staffProfileId,
      clearProjectedLocalSaleForStaff,
      guardActiveSessionConflict,
      ensureLocalRegisterSessionReady,
      hasProvisionedLocalSyncSeed,
      holdCurrentSession,
      localCommandGateway,
      localSaleValidationMetadata,
      locallyOperableRegisterSession?.localRegisterSessionId,
      noteLocalRegisterEventChanged,
      projectedLocalActiveSale,
      refreshLocalRegisterReadModel,
      registerNumber,
      resetDraftState,
      serviceLineDrafts.length,
      terminal?._id,
    ],
  );

  const handleOpenDrawer = useCallback(async () => {
    if (!activeStoreId || !terminal?._id || !staffProfileId) {
      setDrawerErrorMessage(
        "Register sign-in required. Sign in before opening the drawer.",
      );
      return;
    }

    if (!canSignedInStaffOpenDrawer) {
      setDrawerErrorMessage(
        "Cashier or manager sign-in required to open this drawer.",
      );
      return;
    }

    const isOnline = globalThis.navigator?.onLine ?? true;

    if (isOnline && !staffProofToken) {
      setDrawerErrorMessage("Sign in again before opening the drawer.");
      toast.error("Sign out, then sign in again before opening the drawer.");
      return;
    }

    const parsedOpeningFloat = parseDisplayAmountInput(drawerOpeningFloat);
    if (parsedOpeningFloat === undefined || parsedOpeningFloat <= 0) {
      setDrawerErrorMessage(
        "Opening float required. Enter an amount greater than 0.",
      );
      return;
    }

    setDrawerErrorMessage(null);
    setIsOpeningDrawer(true);

    if (!(await hasProvisionedLocalSyncSeed())) {
      setIsOpeningDrawer(false);
      setDrawerErrorMessage(
        "Terminal setup required. Register this terminal before opening the drawer.",
      );
      return;
    }

    const result = await localCommandGateway.openDrawer({
      storeId: activeStoreId!,
      terminalId: terminal._id as Id<"posTerminal">,
      staffProfileId,
      registerNumber,
      validationMetadata: localSaleValidationMetadata,
      openingFloat: parsedOpeningFloat,
      notes: trimOptional(drawerNotes),
    });

    setIsOpeningDrawer(false);

    if (result.kind !== "ok" || !result.data) {
      setDrawerErrorMessage(buildOpenDrawerFailureMessage(result));
      return;
    }

    const localRegisterSessionId = result.data.localRegisterSessionId;
    noteLocalRegisterEventChanged();
    setLocalOperableRegisterSession({
      expectedCash: parsedOpeningFloat,
      localRegisterSessionId,
      openedAt: result.data.openedAt,
      openingFloat: parsedOpeningFloat,
      registerNumber,
      storeId: activeStoreId!,
      terminalId: terminal._id,
    });
    setDrawerErrorMessage(null);
    bootstrapInitialized.current = true;
    toast.success("Drawer open");
  }, [
    activeStoreId,
    canSignedInStaffOpenDrawer,
    staffProfileId,
    staffProofToken,
    drawerNotes,
    drawerOpeningFloat,
    hasProvisionedLocalSyncSeed,
    localCommandGateway,
    localSaleValidationMetadata,
    noteLocalRegisterEventChanged,
    registerNumber,
    terminal?._id,
  ]);

  const handleSubmitRegisterCloseout = useCallback(async () => {
    if (!activeStoreId || !terminal?._id || !staffProfileId) {
      setDrawerErrorMessage(
        "Register sign-in required. Sign in before submitting closeout.",
      );
      return;
    }

    const registerSessionId = getCloseoutLocalRegisterSessionId(
      activeCloseoutRegisterSession,
      localRegisterReadModel,
    );

    if (!registerSessionId) {
      setDrawerErrorMessage(
        "Closeout unavailable. Refresh the register and try again.",
      );
      return;
    }

    const parsedCountedCash = parseDisplayAmountInput(closeoutCountedCash);

    if (parsedCountedCash === undefined) {
      setDrawerErrorMessage("Counted cash required. Enter the drawer total.");
      return;
    }

    const expectedCloseoutCash = activeCloseoutRegisterSession?.expectedCash;
    const trimmedCloseoutNotes = trimOptional(closeoutNotes);
    const hasCloseoutVariance =
      expectedCloseoutCash !== undefined &&
      parsedCountedCash !== expectedCloseoutCash;

    setDrawerErrorMessage(null);
    setIsSubmittingCloseout(true);
    await waitForCheckoutMutationQueues();
    const savedLocally = await localCommandGateway.startCloseout({
      terminalId: terminal._id,
      storeId: activeStoreId!,
      registerNumber,
      localRegisterSessionId: registerSessionId,
      staffProfileId,
      validationMetadata: localSaleValidationMetadata,
      countedCash: parsedCountedCash,
      notes: trimmedCloseoutNotes ?? null,
    });
    if (savedLocally.kind !== "ok") {
      setIsSubmittingCloseout(false);
      setDrawerErrorMessage("Unable to close this register. Try again.");
      return;
    }

    const cloudRegisterSessionId = getCloseoutCloudRegisterSessionId(
      activeCloseoutRegisterSession,
    );
    if (!hasCloseoutVariance && cloudRegisterSessionId) {
      const closeoutResult = await runCommand(() =>
        submitRegisterSessionCloseout({
          actorStaffProfileId: staffProfileId,
          actorUserId: user?._id,
          countedCash: parsedCountedCash,
          notes: trimmedCloseoutNotes,
          registerSessionId: cloudRegisterSessionId,
          storeId: activeStoreId!,
        }),
      );

      if (closeoutResult.kind === "ok") {
        const markSyncedResult = await localStore.markEventsSynced(
          [savedLocally.data.localEventId],
          { uploaded: true },
        );
        if (markSyncedResult.ok) {
          noteLocalRegisterEventChanged();
        }
      }
    }

    setIsSubmittingCloseout(false);
    noteLocalRegisterEventChanged();
    setCloseoutCountedCash("");
    setCloseoutNotes("");
    setDrawerErrorMessage(null);
    setIsCloseoutRequested(false);
    setLocalOperablePosSession(null);
    if (
      locallyOperableRegisterSession?.localRegisterSessionId ===
      registerSessionId
    ) {
      setLocalOperableRegisterSession(null);
    }
    requestBootstrap();
    toast.success("Register closed.");
  }, [
    activeStoreId,
    activeCloseoutRegisterSession,
    closeoutCountedCash,
    closeoutNotes,
    localCommandGateway,
    localSaleValidationMetadata,
    localStore,
    localRegisterReadModel,
    locallyOperableRegisterSession?.localRegisterSessionId,
    noteLocalRegisterEventChanged,
    registerNumber,
    requestBootstrap,
    staffProfileId,
    submitRegisterSessionCloseout,
    terminal?._id,
    user?._id,
    waitForCheckoutMutationQueues,
  ]);

  const handleCancelRegisterCloseout = useCallback(() => {
    setIsCloseoutRequested(false);
    setCloseoutCountedCash("");
    setCloseoutNotes("");
    setDrawerErrorMessage(null);
  }, []);

  const handleReopenRegisterCloseout = useCallback(async () => {
    if (!closeoutBlockedRegisterSession) {
      setIsCloseoutRequested(false);
      setCloseoutCountedCash("");
      setCloseoutNotes("");
      setDrawerErrorMessage(null);
      return;
    }

    if (!activeStoreId || !terminal?._id || !staffProfileId) {
      setDrawerErrorMessage(
        "Register sign-in required. Sign in before reopening the register.",
      );
      return;
    }

    if (!isCashierManager) {
      setDrawerErrorMessage(
        "Manager approval required. Ask a manager to reopen this register.",
      );
      return;
    }

    const registerSessionId = getCloseoutLocalRegisterSessionId(
      activeCloseoutRegisterSession,
      localRegisterReadModel,
    );

    if (!registerSessionId) {
      setDrawerErrorMessage(
        "Reopen unavailable. Refresh the register and try again.",
      );
      return;
    }

    setDrawerErrorMessage(null);
    setIsReopeningCloseout(true);

    const savedLocally = await localCommandGateway.reopenRegister({
      terminalId: terminal._id,
      storeId: activeStoreId!,
      registerNumber,
      localRegisterSessionId: registerSessionId,
      staffProfileId,
      validationMetadata: localSaleValidationMetadata,
      reason: "Register closeout reopened from POS drawer gate.",
    });
    setIsReopeningCloseout(false);

    if (!savedLocally) {
      setDrawerErrorMessage("Unable to reopen this register. Try again.");
      return;
    }

    noteLocalRegisterEventChanged();
    setCloseoutCountedCash("");
    setCloseoutNotes("");
    setLocalOperableRegisterSession({
      expectedCash: closeoutBlockedRegisterSession.expectedCash,
      localRegisterSessionId: registerSessionId,
      openedAt: closeoutBlockedRegisterSession.openedAt,
      openingFloat: closeoutBlockedRegisterSession.openingFloat,
      registerNumber,
      storeId: activeStoreId!,
      terminalId: terminal._id,
    });
    requestBootstrap();
    toast.success("Register reopened. You can start selling.");
  }, [
    activeStoreId,
    activeCloseoutRegisterSession,
    closeoutBlockedRegisterSession,
    isCashierManager,
    localCommandGateway,
    localSaleValidationMetadata,
    localRegisterReadModel,
    noteLocalRegisterEventChanged,
    registerNumber,
    requestBootstrap,
    staffProfileId,
    terminal?._id,
  ]);

  const handleSubmitOpeningFloatCorrection = useCallback(async () => {
    if (!activeStoreId || !user?._id || !staffProfileId) {
      setDrawerErrorMessage(
        "Register sign-in required. Sign in before correcting opening float.",
      );
      return;
    }

    const registerSessionId =
      activeOpeningFloatCorrectionRegisterSession?._id as
        | Id<"registerSession">
        | undefined;

    if (!registerSessionId) {
      setDrawerErrorMessage(
        "Opening float correction unavailable. Refresh the register and try again.",
      );
      return;
    }

    const parsedOpeningFloat = parseDisplayAmountInput(correctedOpeningFloat);
    if (parsedOpeningFloat === undefined || parsedOpeningFloat < 0) {
      setDrawerErrorMessage(
        "Corrected opening float required. Enter a non-negative amount.",
      );
      return;
    }

    const reason = trimOptional(openingFloatCorrectionReason);
    if (!reason) {
      setDrawerErrorMessage("Reason required. Add why the float changed.");
      return;
    }

    setDrawerErrorMessage(null);
    await closeoutApprovalRunner.run({
      requestedByStaffProfileId: staffProfileId,
      execute: async (approvalArgs) => {
        setIsCorrectingOpeningFloat(true);
        try {
          return await runCommand(() =>
            correctRegisterSessionOpeningFloat({
              actorStaffProfileId: staffProfileId,
              actorUserId: user._id,
              approvalProofId: approvalArgs.approvalProofId,
              correctedOpeningFloat: parsedOpeningFloat,
              reason,
              registerSessionId,
              storeId: activeStoreId!,
            }),
          );
        } finally {
          setIsCorrectingOpeningFloat(false);
        }
      },
      onResult: (result) => {
        if (isApprovalRequiredResult(result)) {
          return;
        }

        if (result.kind !== "ok") {
          setDrawerErrorMessage(toOperatorMessage(result.error.message));
          return;
        }

        setCorrectedOpeningFloat("");
        setOpeningFloatCorrectionReason("");
        setIsOpeningFloatCorrectionRequested(false);
        requestBootstrap();
        toast.success(
          result.data?.action === "unchanged"
            ? "Opening float unchanged"
            : "Opening float corrected",
        );
      },
    });
  }, [
    activeOpeningFloatCorrectionRegisterSession?._id,
    activeStoreId,
    closeoutApprovalRunner,
    correctedOpeningFloat,
    correctRegisterSessionOpeningFloat,
    openingFloatCorrectionReason,
    requestBootstrap,
    staffProfileId,
    user?._id,
  ]);

  useEffect(() => {
    if (
      !isCloudOperableSession(operableActiveSession) ||
      operableActiveSession.registerSessionId ||
      !activeRegisterSessionId ||
      !staffProfileId
    ) {
      return;
    }

    const requestKey = `${operableActiveSession._id}:${activeRegisterSessionId}`;
    if (drawerBindingRequestRef.current === requestKey) {
      return;
    }

    drawerBindingRequestRef.current = requestKey;

    void (async () => {
      const result = await bindSessionToRegisterSession({
        sessionId: operableActiveSession._id,
        staffProfileId,
        registerSessionId: activeRegisterSessionId,
      });

      if (result.kind !== "ok") {
        drawerBindingRequestRef.current = null;
        setDrawerErrorMessage(toOperatorMessage(result.error.message));
        return;
      }

      requestBootstrap();
    })();
  }, [
    activeRegisterSessionId,
    operableActiveSession,
    bindSessionToRegisterSession,
    requestBootstrap,
    staffProfileId,
  ]);

  useEffect(() => {
    if (
      !activeStoreId ||
      !terminal?._id ||
      !staffProfileId ||
      !bootstrapState ||
      isTransactionCompleted ||
      bootstrapInitialized.current ||
      requiresDrawerGate
    ) {
      return;
    }

    if (
      bootstrapState.phase !== "active" &&
      bootstrapState.phase !== "resumable" &&
      bootstrapState.phase !== "readyToStart"
    ) {
      return;
    }

    bootstrapInitialized.current = true;

    void (async () => {
      if (bootstrapState.phase === "active") {
        return;
      }

      if (
        bootstrapState.phase === "resumable" &&
        bootstrapState.resumableSession
      ) {
        const result = await resumeSession({
          sessionId: bootstrapState.resumableSession._id as Id<"posSession">,
          staffProfileId,
          terminalId: terminal._id,
        });

        if (result.kind !== "ok") {
          presentOperatorError(result.error.message);
          bootstrapInitialized.current = false;
        }

        return;
      }

      bootstrapInitialized.current = false;
    })();
  }, [
    activeStoreId,
    activeRegisterSessionId,
    bootstrapState,
    staffProfileId,
    isTransactionCompleted,
    requiresDrawerGate,
    resumeSession,
    terminal?._id,
  ]);

  const appendLocalCartItem = useCallback(
    async (input: { localPosSessionId: string; payload: unknown }) => {
      if (!activeStoreId || !terminal?._id || !staffProfileId) {
        return false;
      }

      return localCommandGateway.appendCartItem({
        terminalId: terminal._id,
        storeId: activeStoreId!,
        registerNumber,
        localRegisterSessionId: localEventRegisterSessionId ?? registerNumber,
        localPosSessionId: input.localPosSessionId,
        staffProfileId,
        validationMetadata: localSaleValidationMetadata,
        payload: input.payload,
      });
    },
    [
      localEventRegisterSessionId,
      activeStoreId,
      localCommandGateway,
      localSaleValidationMetadata,
      registerNumber,
      staffProfileId,
      terminal?._id,
    ],
  );

  const defineLocalPendingCheckoutItem = useCallback(
    async (input: { localPosSessionId: string; product: Product }) => {
      if (!input.product.pendingCheckoutItemLocalDefinition) {
        return true;
      }
      if (!activeStoreId || !terminal?._id || !staffProfileId) {
        return false;
      }

      return localCommandGateway.definePendingCheckoutItem({
        terminalId: terminal._id,
        storeId: activeStoreId,
        registerNumber,
        localRegisterSessionId: localEventRegisterSessionId ?? registerNumber,
        localPosSessionId: input.localPosSessionId,
        staffProfileId,
        validationMetadata: localSaleValidationMetadata,
        payload: input.product.pendingCheckoutItemLocalDefinition,
      });
    },
    [
      activeStoreId,
      localCommandGateway,
      localEventRegisterSessionId,
      localSaleValidationMetadata,
      registerNumber,
      staffProfileId,
      terminal?._id,
    ],
  );

  const handleAddService = useCallback(
    async (service: RegisterServiceSearchResult, amount?: number) => {
      if (checkoutMutationLockedRef.current) {
        toast.error(
          "Finish the current checkout update before changing the sale.",
        );
        return false;
      }

      return enqueueServiceMutation(async () => {
        if (!staffProfileId) {
          toast.error(
            "Register sign-in required. Sign in before adding services.",
          );
          return false;
        }

        if (!terminalCanTransactServices) {
          toast.error("This terminal is not configured for service sales.");
          return false;
        }

        if (activeSessionHasBlockedRegisterBinding) {
          toast.error("Drawer closed. Open the drawer before adding services.");
          return false;
        }

        const requiresAmount =
          service.pricingModel === "starting_at" ||
          service.pricingModel === "quote_after_consultation";
        const lineAmount = requiresAmount
          ? (amount ?? 0)
          : (service.basePrice ?? 0);

        if (requiresAmount && lineAmount <= 0) {
          toast.error(
            service.pricingModel === "starting_at"
              ? "Service amount required. Enter the service amount before adding."
              : "Quoted amount required. Enter the quoted amount before adding.",
          );
          return false;
        }

        if (service.pricingModel === "fixed" && lineAmount <= 0) {
          toast.error("Service price unavailable. Choose another service.");
          return false;
        }

        const localPosSessionId = await ensureLocalPosSessionId();
        if (!localPosSessionId) {
          return false;
        }

        if (!activeStoreId || !terminal?._id) {
          presentOperatorError("Unable to update this sale. Try again.");
          return false;
        }

        const currentServiceLineDrafts = serviceLineDraftsRef.current;
        const existingServiceLine = matchingServiceLineDraft(
          currentServiceLineDrafts,
          service,
        );

        if (existingServiceLine) {
          return false;
        }

        const serviceLine: RegisterServiceLineState = {
          id: createLocalFallbackId("local-service-line"),
          serviceCatalogId: service.serviceCatalogId,
          name: service.name,
          serviceMode: service.serviceMode,
          pricingModel: service.pricingModel,
          price: lineAmount,
          quantity: 1,
          amountRequired: requiresAmount && lineAmount <= 0,
          catalogUpdatedAt: service.updatedAt,
        };
        const savedLocally = await localCommandGateway.appendServiceLine({
          terminalId: terminal._id,
          storeId: activeStoreId,
          registerNumber,
          localRegisterSessionId: localEventRegisterSessionId ?? registerNumber,
          localPosSessionId,
          staffProfileId,
          validationMetadata: localSaleValidationMetadata,
          payload: serviceLineStateToLocalPayload(serviceLine),
        });

        if (!savedLocally) {
          presentOperatorError("Unable to update this sale. Try again.");
          return false;
        }

        const nextServiceLineDrafts = [
          ...currentServiceLineDrafts,
          serviceLine,
        ];
        serviceLineDraftsRef.current = nextServiceLineDrafts;
        setServiceLineDrafts(nextServiceLineDrafts);
        setShowProductEntry(true);
        setProductSearchQuery("");
        return true;
      });
    },
    [
      activeSessionHasBlockedRegisterBinding,
      activeStoreId,
      checkoutMutationLockedRef,
      enqueueServiceMutation,
      ensureLocalPosSessionId,
      localCommandGateway,
      localSaleValidationMetadata,
      localEventRegisterSessionId,
      registerNumber,
      staffProfileId,
      terminal?._id,
      terminalCanTransactServices,
    ],
  );

  const handleUpdateServiceAmount = useCallback(
    async (lineId: string, amount: number) => {
      if (checkoutMutationLockedRef.current) {
        toast.error(
          "Finish the current checkout update before changing the sale.",
        );
        return;
      }

      if (activeSessionHasBlockedRegisterBinding) {
        toast.error(
          "Drawer closed. Open the drawer before changing this sale.",
        );
        return;
      }

      await enqueueServiceMutation(async () => {
        const existing = serviceLineDrafts.find((item) => item.id === lineId);
        const localPosSessionId = await ensureLocalPosSessionId();
        if (!localPosSessionId) {
          return;
        }
        if (existing && activeStoreId && terminal?._id && staffProfileId) {
          const nextLine = {
            ...existing,
            price: amount,
            amountRequired:
              (existing.pricingModel === "starting_at" ||
                existing.pricingModel === "quote_after_consultation") &&
              amount <= 0,
          };
          const savedLocally = await localCommandGateway.appendServiceLine({
            terminalId: terminal._id,
            storeId: activeStoreId,
            registerNumber,
            localRegisterSessionId:
              localEventRegisterSessionId ?? registerNumber,
            localPosSessionId,
            staffProfileId,
            validationMetadata: localSaleValidationMetadata,
            payload: serviceLineStateToLocalPayload(nextLine),
          });
          if (!savedLocally) {
            presentOperatorError("Unable to update this sale. Try again.");
            return;
          }
        }

        setServiceLineDrafts((current) =>
          current.map((item) =>
            item.id === lineId
              ? {
                  ...item,
                  price: amount,
                  amountRequired:
                    (item.pricingModel === "starting_at" ||
                      item.pricingModel === "quote_after_consultation") &&
                    amount <= 0,
                }
              : item,
          ),
        );
      });
    },
    [
      activeSessionHasBlockedRegisterBinding,
      activeStoreId,
      checkoutMutationLockedRef,
      enqueueServiceMutation,
      ensureLocalPosSessionId,
      localCommandGateway,
      localSaleValidationMetadata,
      localEventRegisterSessionId,
      registerNumber,
      serviceLineDrafts,
      staffProfileId,
      terminal?._id,
    ],
  );

  const handleRemoveService = useCallback(
    async (lineId: string) => {
      if (checkoutMutationLockedRef.current) {
        toast.error(
          "Finish the current checkout update before changing the sale.",
        );
        return;
      }

      if (activeSessionHasBlockedRegisterBinding) {
        toast.error(
          "Drawer closed. Open the drawer before changing this sale.",
        );
        return;
      }

      await enqueueServiceMutation(async () => {
        const existing = serviceLineDrafts.find((item) => item.id === lineId);
        const localPosSessionId = await ensureLocalPosSessionId();
        if (!localPosSessionId) {
          return;
        }
        if (existing && activeStoreId && terminal?._id && staffProfileId) {
          const savedLocally = await localCommandGateway.appendServiceLine({
            terminalId: terminal._id,
            storeId: activeStoreId,
            registerNumber,
            localRegisterSessionId:
              localEventRegisterSessionId ?? registerNumber,
            localPosSessionId,
            staffProfileId,
            validationMetadata: localSaleValidationMetadata,
            payload: {
              ...serviceLineStateToLocalPayload(existing),
              quantity: 0,
              unitPrice: 0,
              totalPrice: 0,
            },
          });
          if (!savedLocally) {
            presentOperatorError("Unable to update this sale. Try again.");
            return;
          }
        }

        setServiceLineDrafts((current) =>
          current.filter((item) => item.id !== lineId),
        );
      });
    },
    [
      activeSessionHasBlockedRegisterBinding,
      activeStoreId,
      checkoutMutationLockedRef,
      enqueueServiceMutation,
      ensureLocalPosSessionId,
      localCommandGateway,
      localSaleValidationMetadata,
      localEventRegisterSessionId,
      registerNumber,
      serviceLineDrafts,
      staffProfileId,
      terminal?._id,
    ],
  );

  const handleAddProduct = useCallback(
    async (product: Product, quantity = 1) => {
      const requestedQuantity = Number.isFinite(quantity)
        ? Math.max(1, Math.trunc(quantity))
        : 1;

      if (!staffProfileId) {
        toast.error("Register sign-in required. Sign in before adding items.");
        return false;
      }

      if (!terminalCanTransactProducts) {
        toast.error("This terminal is not configured for product sales.");
        return false;
      }

      if (!product.productId || !product.skuId) {
        toast.error("Item details unavailable. Try another item.");
        return false;
      }
      const productSkuId = product.skuId;

      if (activeSessionHasBlockedRegisterBinding) {
        toast.error("Drawer closed. Open the drawer before adding items.");
        return false;
      }

      const availabilityStatus = getProductAvailabilityStatus(product);
      if (availabilityStatus === "unknown") {
        toast.error(
          product.availabilityMessage ?? POS_AVAILABILITY_NOT_READY_MESSAGE,
        );
        return false;
      }

      return enqueueCartMutation(async () => {
        const localPosSessionId = await ensureLocalPosSessionId();
        if (!localPosSessionId) {
          return false;
        }

        const fastCartItems = activeCartItemsRef.current;
        const fastLocalAvailabilityConsumptionBySkuId =
          localAvailabilityConsumptionBySkuIdRef.current;
        const queuedReadModel = localRegisterReadModelRef.current;
        if (registerCatalogSkuIds.has(productSkuId)) {
          const availability =
            registerCatalogAvailabilityBySkuId.get(productSkuId);
          const quantityAvailable =
            availability !== undefined
              ? Math.trunc(availability.quantityAvailable)
              : availabilityStatus === "available" &&
                  typeof product.quantityAvailable === "number"
                ? Math.trunc(product.quantityAvailable)
                : undefined;

          if (
            product.availabilityPolicy !== "active_provisional_import" &&
            product.availabilityPolicy !== "pending_checkout" &&
            availability?.availabilityPolicy !== "active_provisional_import" &&
            availability?.availabilityPolicy !== "pending_checkout"
          ) {
            if (quantityAvailable === undefined) {
              toast.error(POS_AVAILABILITY_NOT_READY_MESSAGE);
              return false;
            }
          }
        }

        const nextLineSourceKey = productCartSourceKey(product);
        const localSaleItem = queuedReadModel?.activeSale?.items.find(
          (item) =>
            item.productSkuId === productSkuId &&
            cartLineSourceKey(item) === nextLineSourceKey,
        );
        const existingItem = fastCartItems.find(
          (item) =>
            item.skuId === productSkuId &&
            cartLineSourceKey(item) === nextLineSourceKey,
        );
        const conflictingItem =
          queuedReadModel?.activeSale?.items.find(
            (item) =>
              item.productSkuId === productSkuId &&
              cartLineSourceKey(item) !== nextLineSourceKey &&
              (cartLineSourceKey(item) === "trusted_inventory" ||
                nextLineSourceKey === "trusted_inventory"),
          ) ??
          fastCartItems.find(
            (item) =>
              item.skuId === productSkuId &&
              cartLineSourceKey(item) !== nextLineSourceKey &&
              (cartLineSourceKey(item) === "trusted_inventory" ||
                nextLineSourceKey === "trusted_inventory"),
          );
        if (conflictingItem) {
          toast.error(
            "This item is already in the cart from a different inventory source. Remove it and add it again.",
          );
          return false;
        }
        const nextQuantity =
          (localSaleItem?.quantity ?? existingItem?.quantity ?? 0) +
          requestedQuantity;
        const localItemId =
          localSaleItem?.localItemId ??
          existingItem?.id.toString() ??
          createLocalFallbackId("local-item");
        const optimisticProductKey = product.id.toString();
        const removedLineKey = removedCartLineKeyFromProduct(product);
        const hadRemovedLine =
          Boolean(optimisticallyRemovedCartLineKeys[removedLineKey]);
        const previousOptimisticProduct =
          optimisticCartProducts[optimisticProductKey];
        const isExistingOptimisticProduct = existingItem?.id
          .toString()
          .startsWith("optimistic:");
        const previousFastCartItems = activeCartItemsRef.current;
        const previousFastLocalAvailabilityConsumptionBySkuId =
          localAvailabilityConsumptionBySkuIdRef.current;
        const optimisticItem = mapProductToOptimisticCartItem(
          product,
          nextQuantity,
        );
        if (existingItem && !isExistingOptimisticProduct) {
          setOptimisticallyRemovedCartLineKeys((current) => {
            const next = { ...current };
            delete next[removedLineKey];
            return next;
          });
          setOptimisticCartQuantities((current) => ({
            ...current,
            [existingItem.id]: nextQuantity,
          }));
          activeCartItemsRef.current = fastCartItems.map((item) =>
            item.id === existingItem.id
              ? { ...item, quantity: nextQuantity }
              : item,
          );
        } else {
          setOptimisticCartProducts((current) => ({
            ...current,
            [optimisticProductKey]: optimisticItem,
          }));
          activeCartItemsRef.current = [
            ...fastCartItems.filter((item) => item.id !== optimisticItem.id),
            optimisticItem,
          ];
        }

        if (!existingItem || isExistingOptimisticProduct) {
          setOptimisticallyRemovedCartLineKeys((current) => {
            const next = { ...current };
            delete next[removedLineKey];
            return next;
          });
        }

        if (nextLineSourceKey === "trusted_inventory") {
          const nextConsumption = new Map(
            fastLocalAvailabilityConsumptionBySkuId,
          );
          nextConsumption.set(
            productSkuId,
            (nextConsumption.get(productSkuId) ?? 0) + requestedQuantity,
          );
          localAvailabilityConsumptionBySkuIdRef.current = nextConsumption;
        }

        const pendingDefinitionSaved = await defineLocalPendingCheckoutItem({
          localPosSessionId,
          product,
        });

        const savedLocally =
          pendingDefinitionSaved &&
          (await appendLocalCartItem({
            localPosSessionId,
            payload: buildLocalCartItemPayload({
              localItemId,
              product,
              quantity: nextQuantity,
            }),
          }));

        if (!savedLocally) {
          activeCartItemsRef.current = previousFastCartItems;
          localAvailabilityConsumptionBySkuIdRef.current =
            previousFastLocalAvailabilityConsumptionBySkuId;
          if (hadRemovedLine) {
            setOptimisticallyRemovedCartLineKeys((current) => ({
              ...current,
              [removedLineKey]: true,
            }));
          }
          if (existingItem && !isExistingOptimisticProduct) {
            setOptimisticCartQuantities((current) => {
              const next = { ...current };
              delete next[existingItem.id];
              return next;
            });
          } else {
            setOptimisticCartProducts((current) => {
              if (previousOptimisticProduct) {
                return {
                  ...current,
                  [optimisticProductKey]: previousOptimisticProduct,
                };
              }

              const next = { ...current };
              delete next[optimisticProductKey];
              return next;
            });
          }
          presentOperatorError("Unable to add this item. Try again.");
          return false;
        }

        noteLocalRegisterEventChanged();
        setProductSearchQuery("");
        return true;
      });
    },
    [
      activeSessionHasBlockedRegisterBinding,
      enqueueCartMutation,
      appendLocalCartItem,
      defineLocalPendingCheckoutItem,
      ensureLocalPosSessionId,
      noteLocalRegisterEventChanged,
      optimisticCartProducts,
      optimisticallyRemovedCartLineKeys,
      registerCatalogAvailabilityBySkuId,
      registerCatalogSkuIds,
      staffProfileId,
      terminalCanTransactProducts,
    ],
  );

  const addExactSearchProductOnce = useCallback(
    async (options?: { allowAnyExactIdentifier?: boolean }) => {
      if (!exactSearchProduct || !registerSearchState.canAutoAdd) {
        return false;
      }

      const isBarcodeExact =
        normalizeExactInput(exactSearchProduct.barcode) ===
        normalizeExactInput(registerSearchState.query);
      if (!options?.allowAnyExactIdentifier && !isBarcodeExact) {
        return false;
      }

      const exactAddKey = `${registerSearchState.query}:${exactSearchProduct.skuId}`;
      if (exactAddKeyRef.current === exactAddKey) {
        return true;
      }

      exactAddKeyRef.current = exactAddKey;
      const wasAdded = await handleAddProduct(exactSearchProduct);
      if (!wasAdded) {
        exactAddKeyRef.current = null;
      }
      return wasAdded;
    },
    [exactSearchProduct, handleAddProduct, registerSearchState],
  );

  useEffect(() => {
    if (!productSearchQuery.trim()) {
      exactAddKeyRef.current = null;
      return;
    }

    if (
      registerSearchState.intent === "exact" &&
      registerSearchState.canAutoAdd
    ) {
      void addExactSearchProductOnce();
    }
  }, [addExactSearchProductOnce, productSearchQuery, registerSearchState]);

  const handleUpdateQuantity = useCallback(
    async (itemId: Id<"posSessionItem">, quantity: number) => {
      if (!operableActiveSession || !staffProfileId) {
        return;
      }

      if (activeSessionHasBlockedRegisterBinding) {
        toast.error(
          "Drawer closed. Open the drawer before updating this sale.",
        );
        return;
      }

      return enqueueCartMutation(async () => {
        const item = activeCartItems.find(
          (candidate) => candidate.id === itemId,
        );
        if (!item) {
          return;
        }
        const removedLineKey = removedCartLineKeyFromCartItem(item);

        const queuedReadModel = await readCurrentLocalRegisterModel();
        const queuedLocalItem = item.skuId
          ? queuedReadModel?.activeSale?.items.find(
              (candidate) =>
                candidate.localItemId === itemId.toString() ||
                candidate.productSkuId === item.skuId,
            )
          : undefined;
        const currentQuantity = queuedLocalItem?.quantity ?? item.quantity;
        const isProvisionalImportLine = Boolean(
          ("inventoryImportProvisionalSkuId" in item
            ? item.inventoryImportProvisionalSkuId
            : undefined) ?? queuedLocalItem?.inventoryImportProvisionalSkuId,
        );

        if (
          item.skuId &&
          quantity > currentQuantity &&
          !isProvisionalImportLine &&
          registerCatalogSkuIds.has(item.skuId)
        ) {
          if (!registerCatalogAvailabilityBySkuId.has(item.skuId)) {
            toast.error(POS_AVAILABILITY_NOT_READY_MESSAGE);
            return;
          }
        }

        const itemIsLocalOnly = item.id.toString().startsWith("optimistic:");
        if (itemIsLocalOnly) {
          if (!item.skuId) return;
          if (quantity <= 0) {
            const optimisticProductKey =
              optimisticCartProductKeyFromCartItem(item);
            setOptimisticallyRemovedCartLineKeys((current) => ({
              ...current,
              [removedLineKey]: true,
            }));
            setOptimisticCartProducts((current) => {
              const next = { ...current };
              delete next[optimisticProductKey];
              return next;
            });
            const savedLocally = await appendLocalCartItem({
              localPosSessionId: operableActiveSession._id.toString(),
              payload: buildLocalCartItemPayloadFromCartItem({
                item,
                localItemId: itemId.toString(),
                quantity: 0,
              }),
            });
            if (!savedLocally) {
              setOptimisticallyRemovedCartLineKeys((current) => {
                const next = { ...current };
                delete next[removedLineKey];
                return next;
              });
              setOptimisticCartProducts((current) => ({
                ...current,
                [optimisticProductKey]: item,
              }));
              presentOperatorError("Unable to update this sale. Try again.");
              return;
            }
            noteLocalRegisterEventChanged();
            return;
          }

          const savedLocally = await appendLocalCartItem({
            localPosSessionId: operableActiveSession._id.toString(),
            payload: buildLocalCartItemPayloadFromCartItem({
              item,
              localItemId: itemId.toString(),
              quantity,
            }),
          });
          if (!savedLocally) {
            presentOperatorError("Unable to update this sale. Try again.");
            return;
          }
          noteLocalRegisterEventChanged();
          setOptimisticallyRemovedCartLineKeys((current) => {
            const next = { ...current };
            delete next[removedLineKey];
            return next;
          });
          setOptimisticCartProducts((current) => ({
            ...current,
            [optimisticCartProductKeyFromCartItem(item)]: {
              ...item,
              quantity,
            },
          }));
          return;
        }

        if (quantity <= 0) {
          setOptimisticallyRemovedCartLineKeys((current) => ({
            ...current,
            [removedLineKey]: true,
          }));
          setOptimisticCartQuantities((current) => ({
            ...current,
            [itemId]: 0,
          }));

          const savedLocally = await appendLocalCartItem({
            localPosSessionId: operableActiveSession._id.toString(),
            payload: buildLocalCartItemPayloadFromCartItem({
              item,
              localItemId: itemId.toString(),
              quantity: 0,
            }),
          });

          if (!savedLocally) {
            setOptimisticallyRemovedCartLineKeys((current) => {
              const next = { ...current };
              delete next[removedLineKey];
              return next;
            });
            setOptimisticCartQuantities((current) => {
              const next = { ...current };
              delete next[itemId];
              return next;
            });
            presentOperatorError("Unable to update this sale. Try again.");
            return;
          }
          noteLocalRegisterEventChanged();
          return;
        }

        if (!item.productId || !item.skuId) {
          toast.error("Item details unavailable. Remove it and add it again.");
          return;
        }

        setOptimisticCartQuantities((current) => ({
          ...current,
          [itemId]: quantity,
        }));
        setOptimisticallyRemovedCartLineKeys((current) => {
          const next = { ...current };
          delete next[removedLineKey];
          return next;
        });

        const savedLocally = await appendLocalCartItem({
          localPosSessionId: operableActiveSession._id.toString(),
          payload: buildLocalCartItemPayloadFromCartItem({
            item,
            localItemId: itemId.toString(),
            quantity,
          }),
        });

        if (!savedLocally) {
          setOptimisticCartQuantities((current) => {
            const next = { ...current };
            delete next[itemId];
            return next;
          });
          presentOperatorError("Unable to update this sale. Try again.");
          return;
        }
        noteLocalRegisterEventChanged();
      });
    },
    [
      operableActiveSession,
      activeSessionHasBlockedRegisterBinding,
      activeCartItems,
      appendLocalCartItem,
      enqueueCartMutation,
      noteLocalRegisterEventChanged,
      readCurrentLocalRegisterModel,
      registerCatalogAvailabilityBySkuId,
      registerCatalogSkuIds,
      staffProfileId,
    ],
  );

  const handleRemoveItem = useCallback(
    async (itemId: Id<"posSessionItem">) => {
      if (!operableActiveSession || !staffProfileId) {
        return;
      }

      if (activeSessionHasBlockedRegisterBinding) {
        toast.error(
          "Drawer closed. Open the drawer before updating this sale.",
        );
        return;
      }

      const item = activeCartItems.find((candidate) => candidate.id === itemId);
      if (!item) {
        return;
      }

      const itemIsLocalOnly = item.id.toString().startsWith("optimistic:");
      const optimisticProductKey = optimisticCartProductKeyFromCartItem(item);
      const removedLineKey = removedCartLineKeyFromCartItem(item);

      setOptimisticallyRemovedCartLineKeys((current) => ({
        ...current,
        [removedLineKey]: true,
      }));
      if (itemIsLocalOnly) {
        setOptimisticCartProducts((current) => {
          const next = { ...current };
          delete next[optimisticProductKey];
          return next;
        });
      } else {
        setOptimisticCartQuantities((current) => ({
          ...current,
          [itemId]: 0,
        }));
      }

      return enqueueCartMutation(async () => {
        if (itemIsLocalOnly) {
          if (!item.skuId) return;
          const savedLocally = await appendLocalCartItem({
            localPosSessionId: operableActiveSession._id.toString(),
            payload: buildLocalCartItemPayloadFromCartItem({
              item,
              localItemId: itemId.toString(),
              quantity: 0,
            }),
          });
          if (!savedLocally) {
            setOptimisticallyRemovedCartLineKeys((current) => {
              const next = { ...current };
              delete next[removedLineKey];
              return next;
            });
            setOptimisticCartProducts((current) => ({
              ...current,
              [optimisticProductKey]: item,
            }));
            presentOperatorError("Unable to update this sale. Try again.");
            return;
          }
          noteLocalRegisterEventChanged();
          return;
        }

        const savedLocally = await appendLocalCartItem({
          localPosSessionId: operableActiveSession._id.toString(),
          payload: buildLocalCartItemPayloadFromCartItem({
            item,
            localItemId: itemId.toString(),
            quantity: 0,
          }),
        });

        if (!savedLocally) {
          setOptimisticallyRemovedCartLineKeys((current) => {
            const next = { ...current };
            delete next[removedLineKey];
            return next;
          });
          setOptimisticCartQuantities((current) => {
            const next = { ...current };
            delete next[itemId];
            return next;
          });
          presentOperatorError("Unable to update this sale. Try again.");
          return;
        }

        noteLocalRegisterEventChanged();
      });
    },
    [
      operableActiveSession,
      activeSessionHasBlockedRegisterBinding,
      activeCartItems,
      appendLocalCartItem,
      enqueueCartMutation,
      noteLocalRegisterEventChanged,
      staffProfileId,
    ],
  );

  const handleClearCart = useCallback(async () => {
    if (checkoutMutationLockedRef.current) {
      toast.error(
        "Finish the current checkout update before clearing the sale.",
      );
      return;
    }

    if (!operableActiveSession || !staffProfileId) {
      return;
    }

    if (activeSessionHasBlockedRegisterBinding) {
      toast.error("Drawer closed. Open the drawer before updating this sale.");
      return;
    }

    setCheckoutMutationLocked(true);
    try {
      await waitForCheckoutMutationQueues();

      if (!activeStoreId || !terminal?._id) {
        presentOperatorError("Unable to update this sale. Try again.");
        return;
      }

      const localPosSessionId =
        serviceLineDrafts.length > 0
          ? await ensureLocalPosSessionId()
          : operableActiveSession._id.toString();
      if (!localPosSessionId) return;

      const savedLocally = await localCommandGateway.clearCart({
        terminalId: terminal._id,
        storeId: activeStoreId!,
        registerNumber,
        localRegisterSessionId: localEventRegisterSessionId ?? registerNumber,
        localPosSessionId,
        staffProfileId,
        reason: "Cart cleared",
      });

      if (!savedLocally) {
        presentOperatorError("Unable to update this sale. Try again.");
        return;
      }

      setOptimisticCartQuantities((current) => {
        const next = { ...current };
        for (const item of operableActiveSession.cartItems) {
          next[item.id] = 0;
        }
        return next;
      });
      setOptimisticallyRemovedCartLineKeys((current) => {
        const next = { ...current };
        for (const item of activeCartItems) {
          next[removedCartLineKeyFromCartItem(item)] = true;
        }
        return next;
      });
      setOptimisticCartProducts({});
      setServiceLineDrafts([]);
      noteLocalRegisterEventChanged();
      setPaymentState([]);
      if (activeCartItems.length > 0 || serviceLineDrafts.length > 0) {
        toast.success("Sale cleared");
      }
    } finally {
      setCheckoutMutationLocked(false);
    }
  }, [
    operableActiveSession,
    activeSessionHasBlockedRegisterBinding,
    localEventRegisterSessionId,
    activeCartItems,
    activeStoreId,
    checkoutMutationLockedRef,
    ensureLocalPosSessionId,
    localCommandGateway,
    noteLocalRegisterEventChanged,
    registerNumber,
    serviceLineDrafts.length,
    setCheckoutMutationLocked,
    setPaymentState,
    staffProfileId,
    terminal?._id,
    waitForCheckoutMutationQueues,
  ]);

  const handleBarcodeSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!productSearchQuery.trim()) {
        return;
      }

      if (registerSearchState.intent !== "exact") {
        return;
      }

      if (
        await addExactSearchProductOnce({
          allowAnyExactIdentifier: true,
        })
      ) {
        return;
      }

      const blockedExactProduct =
        exactSearchProduct ??
        (registerSearchProducts.length === 1
          ? registerSearchProducts[0]
          : null);

      if (blockedExactProduct && !registerSearchState.canAutoAdd) {
        await handleAddProduct(blockedExactProduct);
        return;
      }

      if (registerSearchState.results.length === 0) {
        toast.error("Item not found. Scan again or search by name.");
      }
    },
    [
      addExactSearchProductOnce,
      exactSearchProduct,
      handleAddProduct,
      productSearchQuery,
      registerSearchProducts,
      registerSearchState,
    ],
  );

  useEffect(() => {
    if (!isTransactionCompleted && showProductEntry) {
      const timer = setTimeout(() => {
        const searchInput = document.querySelector(
          'input[placeholder*="Lookup product"]',
        ) as HTMLInputElement | null;
        searchInput?.focus();
      }, 150);

      return () => clearTimeout(timer);
    }
  }, [isTransactionCompleted, showProductEntry]);

  const handleCashierAuthenticated = useCallback(
    (result: StaffAuthenticationResult | Id<"staffProfile">) => {
      let authenticatedStaffProfileId: Id<"staffProfile">;
      if (typeof result === "string") {
        authenticatedStaffProfileId = result as Id<"staffProfile">;
        staffProfileIdRef.current = authenticatedStaffProfileId;
        staffProofTokenRef.current = null;
        setStaffProfileId(authenticatedStaffProfileId);
        setStaffProofToken(null);
        setLocalAuthenticatedStaff(null);
      } else {
        authenticatedStaffProfileId = result.staffProfileId;
        const authenticatedStaffProofToken =
          readStaffProofFromAuthResult(result);
        staffProfileIdRef.current = authenticatedStaffProfileId;
        staffProofTokenRef.current = authenticatedStaffProofToken;
        setStaffProfileId(authenticatedStaffProfileId);
        setStaffProofToken(authenticatedStaffProofToken);
        setLocalAuthenticatedStaff({
          activeRoles: result.activeRoles ?? [],
          displayName: getStaffDisplayNameFromAuthResult(result),
        });

        const localAuthority = result.localStaffAuthority;
        if (
          activeStoreId &&
          activeStoreOrganizationId &&
          activeOperatingDate &&
          terminal?._id &&
          localAuthority?.wrappedPosLocalStaffProof
        ) {
          const now = Date.now();
          const expiresAt = Math.min(
            localAuthority.expiresAt,
            result.posLocalStaffProof?.expiresAt ??
              localAuthority.wrappedPosLocalStaffProof.expiresAt,
            localAuthority.wrappedPosLocalStaffProof.expiresAt,
          );
          const offlineFreshUntil = Math.min(
            expiresAt,
            now + POS_CASHIER_PRESENCE_OFFLINE_FRESHNESS_MS,
          );

          void (localStore as CashierPresenceStore)
            .writeCashierPresence?.({
              activeRoles: localAuthority.activeRoles,
              credentialId: localAuthority.credentialId,
              credentialVersion: localAuthority.credentialVersion,
              displayName: localAuthority.displayName,
              expiresAt,
              lastValidatedAt: now,
              offlineFreshUntil,
              operatingDate: activeOperatingDate,
              organizationId: activeStoreOrganizationId,
              signedInAt: now,
              staffProfileId: authenticatedStaffProfileId,
              storeId: activeStoreId,
              terminalId: terminal._id,
              username: localAuthority.username,
              wrappedPosLocalStaffProof:
                localAuthority.wrappedPosLocalStaffProof,
            })
            .then((writeResult) => {
              if (writeResult && !writeResult.ok) {
                logger.warn("[POS] Cashier presence could not be stored", {
                  code: writeResult.error?.code,
                  staffProfileId: authenticatedStaffProfileId,
                  storeId: activeStoreId,
                  terminalId: terminal._id,
                });
              }
            });
        }
      }
      setCashierPresenceRestore({ status: "restored" });
      requestBootstrap();
    },
    [
      activeOperatingDate,
      activeStoreId,
      activeStoreOrganizationId,
      localStore,
      requestBootstrap,
      terminal?._id,
    ],
  );

  const handleNavigateBack = useCallback(async () => {
    if (
      !operableActiveSession &&
      (activeCartItems.length > 0 || serviceLineDrafts.length > 0)
    ) {
      toast.error(
        "Complete or clear this local sale before leaving the register.",
      );
      return;
    }

    if (operableActiveSession) {
      const hasDraftState =
        operableActiveSession.cartItems.length > 0 ||
        serviceLineDrafts.length > 0;
      const isEmptyLocalSale =
        !hasDraftState &&
        (isLocalOperableSession(operableActiveSession) ||
          localRegisterReadModel?.activeSale?.localPosSessionId ===
            operableActiveSession._id.toString());

      if (isEmptyLocalSale && !staffProfileId) {
        resetDraftState();
        navigateBack();
        return;
      }

      const handled = hasDraftState
        ? await holdCurrentSession("Navigating away from register")
        : await voidCurrentSession();

      if (!handled) {
        return;
      }
    }

    resetDraftState();
    navigateBack();
  }, [
    operableActiveSession,
    activeCartItems.length,
    holdCurrentSession,
    localRegisterReadModel?.activeSale?.localPosSessionId,
    voidCurrentSession,
    navigateBack,
    resetDraftState,
    serviceLineDrafts.length,
    staffProfileId,
  ]);

  const handleCashierSignOut = useCallback(async () => {
    const clearStoredCashierPresence = async () => {
      if (!activeStoreId || !terminal?._id) {
        return true;
      }

      const presenceStore = localStore as CashierPresenceStore;
      const clearResult = activeStoreOrganizationId
        ? await presenceStore.clearCashierPresence?.({
            operatingDate: activeOperatingDate,
            organizationId: activeStoreOrganizationId,
            storeId: activeStoreId,
            terminalId: terminal._id,
          })
        : await presenceStore.invalidateCashierPresenceForTerminal?.({
            storeId: activeStoreId,
            terminalId: terminal._id,
          });
      if (clearResult && !clearResult.ok) {
        logger.warn("[POS] Cashier presence could not be cleared on sign-out", {
          storeId: activeStoreId,
          terminalId: terminal._id,
        });
        toast.error("Cashier sign-out could not finish. Try again.");
        return false;
      }

      return true;
    };

    const isRecoveringLocalSale = Boolean(
      drawerGateMode === "recovery" &&
      operableActiveSession &&
      (isLocalOperableSession(operableActiveSession) ||
        localRegisterReadModel?.activeSale?.localPosSessionId ===
          operableActiveSession._id.toString()),
    );

    if (isRecoveringLocalSale) {
      if (!(await clearStoredCashierPresence())) {
        return;
      }
      staffProfileIdRef.current = null;
      staffProofTokenRef.current = null;
      resetDraftState();
      setDrawerErrorMessage(null);
      requestBootstrap();
      return;
    }

    if (
      !operableActiveSession &&
      (activeCartItems.length > 0 || serviceLineDrafts.length > 0)
    ) {
      toast.error(
        "Complete or clear this local sale before leaving the register.",
      );
      return;
    }

    if (operableActiveSession) {
      const hasDraftState =
        operableActiveSession.cartItems.length > 0 ||
        serviceLineDrafts.length > 0;

      const handled = hasDraftState
        ? await holdCurrentSession("Signing out")
        : await voidCurrentSession();

      if (!handled) {
        return;
      }
    }

    if (!(await clearStoredCashierPresence())) {
      return;
    }
    resetDraftState();
  }, [
    activeOperatingDate,
    activeStoreId,
    activeStoreOrganizationId,
    drawerGateMode,
    operableActiveSession,
    activeCartItems.length,
    holdCurrentSession,
    localStore,
    localRegisterReadModel?.activeSale?.localPosSessionId,
    requestBootstrap,
    resetDraftState,
    serviceLineDrafts.length,
    terminal?._id,
    voidCurrentSession,
  ]);

  const handleCompleteTransaction = useCallback(async () => {
    if (checkoutMutationLockedRef.current) {
      toast.error(
        "Finish the current checkout update before completing the sale.",
      );
      return false;
    }

    if (!operableActiveSession || !staffProfileId) {
      toast.error("No sale in progress. Start a sale before taking payment.");
      return false;
    }

    if (isCashierPresenceBlockingSale(cashierPresenceRestore.status)) {
      toast.error("Cashier sign-in required. Sign in to continue this sale.");
      return false;
    }

    if (activeSessionHasBlockedRegisterBinding) {
      toast.error(
        "Drawer closed. Open the drawer before completing this sale.",
      );
      return false;
    }

    setCheckoutMutationLocked(true);
    try {
      await waitForCheckoutMutationQueues();

      let currentPayments = paymentsRef.current;
      const localPosSessionId = operableActiveSession._id.toString();
      const currentCartItemsForLocalProjection =
        activeCartItems.length > 0 &&
        activeSession?._id.toString() === localPosSessionId
          ? mergeCartItemsBySku(activeSession.cartItems, activeCartItems)
          : activeCartItems;
      const refreshedLocalCartItems = cartItemsFromLocalRegisterModel(
        await readCurrentLocalRegisterModel(),
        localPosSessionId,
        currentCartItemsForLocalProjection,
      );
      const saleCartItems = refreshedLocalCartItems ?? activeCartItems;
      const productSaleTotals = refreshedLocalCartItems
        ? totalsFromCartItems(saleCartItems)
        : activeTotals;
      const saleTotals = {
        subtotal: productSaleTotals.subtotal + serviceSubtotal,
        tax: productSaleTotals.tax,
        total: productSaleTotals.total + serviceSubtotal,
      };
      if (saleCartItems.length === 0 && serviceLineDrafts.length === 0) {
        toast.error("Add an item before completing the sale.");
        return false;
      }
      if (serviceCheckoutBlockMessage) {
        toast.error(serviceCheckoutBlockMessage);
        return false;
      }
      const paidTotal = currentPayments.reduce(
        (sum, payment) => sum + payment.amount,
        0,
      );
      if (saleTotals.total > 0 && paidTotal < saleTotals.total) {
        toast.error(
          "Payment required. Add payment before completing the sale.",
        );
        return false;
      }
      const paymentAdjustment = normalizeNonCashOverpayment(
        currentPayments,
        saleTotals.total,
      );
      if (paymentAdjustment.changed) {
        const checkoutStateVersion = allocateCheckoutStateVersion();
        const saved = await persistCheckoutStateLocally({
          checkoutStateVersion,
          nextPayments: paymentAdjustment.adjustedPayments,
          stage: "paymentUpdated",
        });
        if (saved) {
          currentPayments = paymentAdjustment.adjustedPayments;
          setPaymentState(paymentAdjustment.adjustedPayments);
        }
      }
      const finishCompletedSale = (input: {
        localTransactionId: string;
        orderNumber: string;
        transactionId?: Id<"posTransaction">;
      }) => {
        setIsTransactionCompleted(true);
        setCompletedOrderNumber(input.orderNumber);
        setCompletedTransactionData({
          paymentMethod: currentPayments[0]?.method ?? "cash",
          payments: [...currentPayments],
          transactionId: input.transactionId,
          localTransactionId: input.localTransactionId,
          completedAt: new Date(),
          cartItems: [...saleCartItems],
          subtotal: saleTotals.subtotal,
          tax: saleTotals.tax,
          total: saleTotals.total,
          customerInfo: completedCustomerInfo(customerInfo),
          serviceLines: serviceLineDrafts.map((item) => ({
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.price,
            totalPrice: item.price * item.quantity,
            serviceMode: item.serviceMode,
          })),
        });
      };
      const buildSalePayload = (input: {
        localTransactionId: string;
        receiptNumber: string;
      }) =>
        buildCompletedSalePayload({
          cartItems: saleCartItems,
          customerInfo,
          localPosSessionId,
          localTransactionId: input.localTransactionId,
          localReceiptNumber: input.localTransactionId,
          payments: currentPayments,
          receiptNumber: input.receiptNumber,
          serviceItems: serviceLineDrafts,
          totals: saleTotals,
        });

      if (!(await hasProvisionedLocalSyncSeed())) {
        toast.error(
          "Terminal setup required. Register this terminal before completing the sale.",
        );
        return false;
      }

      if (!activeStoreId || !terminal?._id) {
        presentOperatorError("Unable to complete this sale. Try again.");
        return false;
      }

      const localTransactionId = createLocalFallbackId("local-txn");
      const receiptNumber = buildLocalReceiptNumber();
      const savedLocally = await localCommandGateway.completeTransaction({
        terminalId: terminal._id,
        storeId: activeStoreId!,
        registerNumber,
        localRegisterSessionId: localEventRegisterSessionId ?? registerNumber,
        localPosSessionId,
        localTransactionId,
        staffProfileId,
        validationMetadata: localSaleValidationMetadata,
        payload: buildSalePayload({
          localTransactionId,
          receiptNumber,
        }),
      });
      if (!savedLocally) {
        presentOperatorError("Unable to complete this sale. Try again.");
        return false;
      }

      noteLocalRegisterEventChanged();
      locallyCompletedSessionIdsRef.current.add(localPosSessionId);
      finishCompletedSale({
        localTransactionId,
        orderNumber: receiptNumber,
      });
      return true;
    } finally {
      setCheckoutMutationLocked(false);
    }
  }, [
    activeCartItems,
    activeSession?._id,
    activeSession?.cartItems,
    activeSessionHasBlockedRegisterBinding,
    localEventRegisterSessionId,
    activeStoreId,
    activeTotals,
    allocateCheckoutStateVersion,
    cashierPresenceRestore.status,
    checkoutMutationLockedRef,
    setCheckoutMutationLocked,
    serviceSubtotal,
    serviceLineDrafts,
    serviceCheckoutBlockMessage,
    operableActiveSession,
    customerInfo,
    hasProvisionedLocalSyncSeed,
    localCommandGateway,
    localSaleValidationMetadata,
    noteLocalRegisterEventChanged,
    paymentsRef,
    persistCheckoutStateLocally,
    readCurrentLocalRegisterModel,
    registerNumber,
    setPaymentState,
    staffProfileId,
    terminal?._id,
    waitForCheckoutMutationQueues,
  ]);

  const handleStartNewTransaction = useCallback(async () => {
    resetDraftState({
      keepCashier: true,
    });
    requestBootstrap();
    await handleStartNewSession({ force: true });
  }, [handleStartNewSession, requestBootstrap, resetDraftState]);

  const enqueuePaymentMutation = useCallback(
    (
      buildMutation: (
        currentPayments: Payment[],
      ) => RegisterPaymentMutationDraft | null,
    ) => {
      if (checkoutMutationLockedRef.current) {
        toast.error(
          "Finish the current checkout update before changing payments.",
        );
        return Promise.resolve(false);
      }

      const runMutation = async (): Promise<boolean> => {
        const mutation = buildMutation(paymentsRef.current);
        if (!mutation) return false;

        const checkoutStateVersion = allocateCheckoutStateVersion();
        const saved = await persistCheckoutStateLocally({
          checkoutStateVersion,
          nextPayments: mutation.nextPayments,
          stage: mutation.stage,
          paymentMethod: mutation.paymentMethod,
          amount: mutation.amount,
          previousAmount: mutation.previousAmount,
        });

        if (!saved) {
          toast.error("Unable to update this payment. Try again.");
          return false;
        }

        setPaymentState(mutation.nextPayments);
        return true;
      };

      return enqueuePaymentQueueMutation(runMutation);
    },
    [
      allocateCheckoutStateVersion,
      checkoutMutationLockedRef,
      enqueuePaymentQueueMutation,
      paymentsRef,
      persistCheckoutStateLocally,
      setPaymentState,
    ],
  );

  const handleAddPayment = useCallback(
    async (method: PosPaymentMethod, amount: number) => {
      const nextPayment = {
        id: createPaymentId(),
        method,
        amount,
        timestamp: Date.now(),
      };
      return enqueuePaymentMutation((currentPayments) => ({
        amount,
        nextPayments: combinePaymentsByMethod([
          ...currentPayments,
          nextPayment,
        ]),
        paymentMethod: method,
        stage: "paymentAdded",
      }));
    },
    [enqueuePaymentMutation],
  );

  const handleUpdatePayment = useCallback(
    async (paymentId: string, amount: number) => {
      return enqueuePaymentMutation((currentPayments) => {
        const previousPayment = currentPayments.find(
          (payment) => payment.id === paymentId,
        );
        if (!previousPayment) {
          return null;
        }

        const nextPayments = currentPayments.map((payment) =>
          payment.id === paymentId ? { ...payment, amount } : payment,
        );

        return {
          amount,
          nextPayments,
          stage: "paymentUpdated",
          paymentMethod: previousPayment.method,
          previousAmount: previousPayment.amount,
        };
      });
    },
    [enqueuePaymentMutation],
  );

  const handleRemovePayment = useCallback(
    async (paymentId: string) => {
      return enqueuePaymentMutation((currentPayments) => {
        const removedPayment = currentPayments.find(
          (payment) => payment.id === paymentId,
        );
        if (!removedPayment) {
          return null;
        }

        const nextPayments = currentPayments.filter(
          (payment) => payment.id !== paymentId,
        );

        return {
          amount: removedPayment.amount,
          nextPayments,
          stage: "paymentRemoved",
          paymentMethod: removedPayment.method,
        };
      });
    },
    [enqueuePaymentMutation],
  );

  const handleClearPayments = useCallback(async () => {
    return enqueuePaymentMutation((currentPayments) =>
      currentPayments.length === 0
        ? null
        : {
            nextPayments: [],
            stage: "paymentsCleared",
          },
    );
  }, [enqueuePaymentMutation]);

  const header = useMemo(
    () =>
      buildRegisterHeaderState({
        isSessionActive: isRegisterSessionActive(operableActiveSession),
      }),
    [operableActiveSession],
  );

  const registerInfo = useMemo(
    () =>
      buildRegisterInfoState({
        customerName: hasCustomerDetails(customerInfo)
          ? customerInfo.name || undefined
          : undefined,
        registerLabel: terminal?.displayName || "No terminal configured",
        hasTerminal: Boolean(terminal),
      }),
    [customerInfo, terminal],
  );
  const onboarding = useMemo<RegisterViewModel["onboarding"]>(() => {
    const isTerminalLookupResolved = terminal !== undefined;
    const terminalReady = Boolean(terminal);
    const cashierSetupReady =
      !isStaffRosterLoaded || activeRegisterOperatorCount > 0;
    const cashierSignedIn = Boolean(staffProfileId);
    const shouldShow =
      (isTerminalLookupResolved && !terminalReady) ||
      (isStaffRosterLoaded && activeRegisterOperatorCount === 0);
    const nextStep =
      isTerminalLookupResolved && !terminalReady
        ? "terminal"
        : isStaffRosterLoaded && activeRegisterOperatorCount === 0
          ? "cashierSetup"
          : "ready";

    return {
      shouldShow,
      terminalReady,
      cashierSetupReady,
      cashierSignedIn,
      cashierCount: activeRegisterOperatorCount,
      nextStep,
    };
  }, [
    activeRegisterOperatorCount,
    isStaffRosterLoaded,
    staffProfileId,
    terminal,
  ]);
  const cashierPresenceBlocksSale = isCashierPresenceBlockingSale(
    cashierPresenceRestore.status,
  );

  const sessionPanel =
    activeStoreId && terminal?._id && staffProfileId
      ? {
          activeSessionNumber: operableActiveSession?.sessionNumber ?? null,
          activeSessionTraceId: operableActiveSession?.workflowTraceId ?? null,
          hasExpiredSession: false,
          canHoldSession: Boolean(operableActiveSession) && hasActiveCartDraft,
          canClearSale: hasClearableSaleState,
          disableNewSession: Boolean(
            cashierPresenceBlocksSale ||
            operableActiveSession?.status === "active",
          ),
          heldSessions:
            heldSessions?.map((session) => ({
              _id: session._id as Id<"posSession">,
              expiresAt: session.expiresAt,
              sessionNumber: session.sessionNumber,
              cartItems: session.cartItems,
              subtotal: session.subtotal,
              total: session.total,
              heldAt: session.heldAt,
              updatedAt: session.updatedAt,
              workflowTraceId: session.workflowTraceId,
              holdReason: session.holdReason,
              customer: session.customer
                ? {
                    name: session.customer.name,
                    email: session.customer.email,
                    phone: session.customer.phone,
                  }
                : null,
            })) ?? [],
          onHoldCurrentSession: async () => {
            await holdCurrentSession();
          },
          onVoidCurrentSession: async () => {
            await voidCurrentSession();
          },
          onResumeSession: handleResumeSession,
          onVoidHeldSession: async (sessionId: Id<"posSession">) => {
            const result = await voidSession({ sessionId });
            if (result.kind !== "ok") {
              presentOperatorError(result.error.message);
              return;
            }

            toast.success("Held sale cleared");
          },
          onStartNewSession: handleStartNewSession,
        }
      : null;

  const hasSignedInStaff = Boolean(cashier || localAuthenticatedStaff);
  const cashierCard =
    activeStoreId && terminal?._id && staffProfileId && hasSignedInStaff
      ? {
          cashierName: cashier
            ? getCashierDisplayName(cashier)
            : (localAuthenticatedStaff?.displayName ?? ""),
          onSignOut: handleCashierSignOut,
        }
      : null;
  const parsedCloseoutCountedCash =
    parseDisplayAmountInput(closeoutCountedCash);
  const shouldShowDrawerGate = Boolean(
    requiresDrawerGate ||
    activeCloseoutRegisterSession ||
    activeOpeningFloatCorrectionRegisterSession,
  );
  const handleRetryLocalSync = useCallback(() => {
    localRuntimeSyncSource?.onRetrySync?.();
    requestBootstrap();
  }, [localRuntimeSyncSource, requestBootstrap]);

  const drawerGate =
    activeStoreId && terminal?._id && staffProfileId && shouldShowDrawerGate
      ? drawerGateMode === "openingFloatCorrection"
        ? {
            mode: drawerGateMode,
            registerLabel: terminal.displayName,
            registerNumber,
            currency: activeStoreCurrency,
            currentOpeningFloat:
              activeOpeningFloatCorrectionRegisterSession?.openingFloat,
            correctedOpeningFloat,
            correctionReason: openingFloatCorrectionReason,
            expectedCash:
              activeOpeningFloatCorrectionRegisterSession?.expectedCash,
            errorMessage: drawerErrorMessage,
            hasSignedInStaff,
            isCorrectingOpeningFloat,
            onCancelOpeningFloatCorrection: () => {
              setCorrectedOpeningFloat("");
              setOpeningFloatCorrectionReason("");
              setIsOpeningFloatCorrectionRequested(false);
              setDrawerErrorMessage(null);
            },
            onCorrectedOpeningFloatChange: (value: string) => {
              setCorrectedOpeningFloat(value);
              setDrawerErrorMessage(null);
            },
            onCorrectionReasonChange: (value: string) => {
              setOpeningFloatCorrectionReason(value);
              setDrawerErrorMessage(null);
            },
            onSubmitOpeningFloatCorrection: handleSubmitOpeningFloatCorrection,
            onSignOut: handleCashierSignOut,
          }
        : drawerGateMode === "closeoutBlocked"
          ? {
              mode: drawerGateMode,
              isRecovery: closeoutBlockedGateIsRecovery,
              registerLabel: terminal.displayName,
              registerNumber,
              currency: activeStoreCurrency,
              closeoutCountedCash,
              closeoutDraftVariance:
                parsedCloseoutCountedCash !== undefined &&
                activeCloseoutRegisterSession
                  ? parsedCloseoutCountedCash -
                    activeCloseoutRegisterSession.expectedCash
                  : undefined,
              closeoutSubmittedCountedCash:
                activeCloseoutRegisterSession?.countedCash,
              closeoutSubmittedVariance:
                activeCloseoutRegisterSession?.variance,
              closeoutNotes,
              closeoutSubmittedReason: activeCloseoutSubmittedReason,
              closeoutSecondaryActionLabel: closeoutBlockedRegisterSession
                ? "Reopen register"
                : "Return to sale",
              onCloseoutSecondaryAction: closeoutBlockedRegisterSession
                ? isCashierManager
                  ? activeCloseoutRegisterSessionHasSyncReview
                    ? undefined
                    : handleReopenRegisterCloseout
                  : undefined
                : handleCancelRegisterCloseout,
              expectedCash: activeCloseoutRegisterSession?.expectedCash,
              canOpenCashControls: isCashierManager,
              cashControlsRegisterSessionId: getCloseoutCloudRegisterSessionId(
                activeCloseoutRegisterSession,
              ),
              hasPendingCloseoutApproval: Boolean(
                activeCloseoutRegisterSession?.managerApprovalRequestId ||
                activeCloseoutRegisterSessionHasSyncReview,
              ),
              errorMessage: drawerErrorMessage,
              hasSignedInStaff,
              isCloseoutSubmitting: isSubmittingCloseout,
              isReopeningCloseout,
              onCloseoutCountedCashChange: (value: string) => {
                setCloseoutCountedCash(value);
                setDrawerErrorMessage(null);
              },
              onCloseoutNotesChange: (value: string) => {
                setCloseoutNotes(value);
                setDrawerErrorMessage(null);
              },
              onSubmitCloseout: activeCloseoutSubmittedReason
                ? undefined
                : handleSubmitRegisterCloseout,
              onReopenRegister:
                isCashierManager && !activeCloseoutRegisterSessionHasSyncReview
                  ? handleReopenRegisterCloseout
                  : undefined,
              onSignOut: handleCashierSignOut,
            }
          : {
              mode: drawerGateMode,
              registerLabel: terminal.displayName,
              registerNumber,
              currency: activeStoreCurrency,
              canOpenCashControls: isCashierManager,
              canOpenDrawer: canSignedInStaffOpenDrawer,
              openingFloat: drawerOpeningFloat,
              notes: drawerNotes,
              errorMessage:
                drawerErrorMessage ??
                (activeSessionHasMismatchedRegisterBinding
                  ? "Sale assigned to a different drawer. Open that drawer before continuing."
                  : null),
              hasSignedInStaff,
              isSubmitting: isOpeningDrawer,
              isRepairingTerminalSetup,
              onOpeningFloatChange: (value: string) => {
                setDrawerOpeningFloat(value);
                setDrawerErrorMessage(null);
              },
              onNotesChange: (value: string) => {
                setDrawerNotes(value);
                setDrawerErrorMessage(null);
              },
              onSubmit: handleOpenDrawer,
              onRetrySync:
                drawerGateMode === "drawerAuthorityRepair"
                  ? handleRetryLocalSync
                  : undefined,
              onRepairTerminalSetup:
                drawerGateMode === "terminalRepair"
                  ? handleRepairTerminalSetup
                  : undefined,
              onSignOut: handleCashierSignOut,
            }
      : null;
  const closeoutControl =
    activeStoreId && terminal?._id && staffProfileId
      ? {
          canCloseout: Boolean(
            (usableActiveRegisterSession ?? localCloseoutRegisterSession) &&
            !requiresDrawerGate &&
            !isOpeningFloatCorrectionRequested &&
            !hasActiveCartDraft &&
            payments.length === 0 &&
            !isTransactionCompleted,
          ),
          canShowOpeningFloatCorrection: isCashierManager,
          canCorrectOpeningFloat: Boolean(
            usableActiveRegisterSession &&
            isCashierManager &&
            !requiresDrawerGate &&
            !isCloseoutRequested &&
            !isTransactionCompleted,
          ),
          onRequestCloseout: () => {
            if (guardActiveSessionConflict()) {
              return;
            }

            setProductSearchQuery("");
            setIsCloseoutRequested(true);
            setIsOpeningFloatCorrectionRequested(false);
            setDrawerErrorMessage(null);
          },
          onRequestOpeningFloatCorrection: () => {
            if (guardActiveSessionConflict()) {
              return;
            }

            if (usableActiveRegisterSession) {
              setCorrectedOpeningFloat(
                String(usableActiveRegisterSession.openingFloat / 100),
              );
            }
            setProductSearchQuery("");
            setIsCloseoutRequested(false);
            setIsOpeningFloatCorrectionRequested(true);
            setDrawerErrorMessage(null);
          },
        }
      : null;
  const localRuntimeStatusSource = localRuntimeSyncSource?.status
    ? localRuntimeSyncSource
    : null;
  const localRuntimeStatusSourceForPresentation =
    localRuntimeStatusSource?.status === "needs_review" &&
    localStaffHasSyncedSaleEvents &&
    localStaffPendingUploadCount === 0
      ? null
      : localRuntimeStatusSource;
  const localReadModelPendingUploadCount = localStaffPendingUploadCount;
  const localOperableRegisterPendingCount =
    localReadModelPendingUploadCount > 0
      ? localReadModelPendingUploadCount
      : localRegisterReadModel?.sourceEvents.length
        ? 0
        : staffProfileId
          ? 1
          : 0;
  const localReadModelSyncSource =
    localRegisterReadModel &&
    localRegisterReadModel.syncStatus.state !== "synced" &&
    localReadModelPendingUploadCount > 0
      ? {
          localSyncStatus: {
            status:
              localRegisterReadModel.syncStatus.state === "needs_review" ||
              localRegisterReadModel.syncStatus.state === "failed"
                ? "needs_review"
                : localRegisterReadModel.activeRegisterSession?.status ===
                    "closing"
                  ? "locally_closed_pending_sync"
                  : "pending_sync",
            pendingEventCount: localReadModelPendingUploadCount,
          },
        }
      : null;
  const localOperableRegisterSyncSource =
    locallyOperableRegisterSession &&
    localOperableRegisterPendingCount > 0 &&
    !(
      localRegisterReadModel?.activeRegisterSession?.localRegisterSessionId ===
        locallyOperableRegisterSession.localRegisterSessionId &&
      localRegisterReadModel.syncStatus.state === "synced"
    )
      ? {
          localSyncStatus: {
            status: "pending_sync",
            pendingEventCount: localOperableRegisterPendingCount,
          },
        }
      : null;
  const localSyncSource = readLocalSyncStatus(
    localRuntimeStatusSourceForPresentation
      ? { localSyncStatus: localRuntimeStatusSourceForPresentation }
      : null,
    operableActiveSession,
    localReadModelSyncSource,
    localOperableRegisterSyncSource,
    activeCloseoutRegisterSession,
    registerState?.activeRegisterSession,
    registerState,
  );
  const hasSyncedLocalEvents =
    (localStaffHasSyncedSaleEvents || localStaffHasUploadedEvents) &&
    localReadModelPendingUploadCount === 0 &&
    !localRuntimeStatusSourceForPresentation;
  const shouldShowSyncStatus = Boolean(localSyncSource || hasSyncedLocalEvents);
  const syncStatus =
    activeStoreId && terminal?._id && shouldShowSyncStatus
      ? {
          ...buildPosSyncStatusPresentation(localSyncSource),
          onRetrySync: () => {
            localSyncSource?.onRetrySync?.();
            handleRetryLocalSync();
          },
        }
      : null;
  const shouldOpenCashierAuth =
    cashierPresenceRestore.status === "validation_pending" ||
    (!staffProfileId && cashierPresenceRestore.status !== "pending");
  const updateApplyBlocker = buildRegisterUpdateApplyBlockerState({
    hasActiveSaleWork: hasInProgressSaleDraft && !isTransactionCompleted,
    hasCheckoutMutationInFlight: isCheckoutMutationInFlight,
    hasDrawerTransitionInFlight:
      isOpeningDrawer ||
      isSubmittingCloseout ||
      isReopeningCloseout ||
      isCorrectingOpeningFloat ||
      isRepairingTerminalSetup,
    hasLocalRuntimeApplyRisk: Boolean(
      hasInProgressSaleDraft && localRuntimeStatusSourceForPresentation,
    ),
  });

  const authDialog =
    activeStoreId && terminal?._id
      ? {
          open: shouldOpenCashierAuth,
          restoredCashier:
            cashierPresenceRestore.status === "validation_pending" &&
            cashierPresenceRestore.username
              ? {
                  displayName: cashierPresenceRestore.displayName ?? null,
                  username: cashierPresenceRestore.username,
                }
              : null,
          storeId: activeStoreId!,
          terminalId: terminal._id,
          onAuthenticated: (
            result: StaffAuthenticationResult | Id<"staffProfile">,
          ) => {
            handleCashierAuthenticated(result);
          },
          onDismiss: handleNavigateBack,
        }
      : null;

  const commandApprovalDialog =
    closeoutApprovalRunner.approvalDialog as RegisterCommandApprovalDialogState | null;

  return {
    hasActiveStore: Boolean(activeStoreId),
    debug: {
      activeStoreSource: activeStore
        ? "live"
        : activeStoreId
          ? "local"
          : "missing",
      appSessionRecovery: appSessionRecovery?.status ?? null,
      authDialogOpen: Boolean(authDialog?.open),
      cashierPresence: cashierPresenceRestore.status,
      hasLiveActiveStore: Boolean(activeStore),
      localStaffAuthorityStatus,
      localEntryStatus: localEntryContext.status,
      online: globalThis.navigator?.onLine ?? true,
      staffSignedIn: Boolean(staffProfileId),
      ...(activeStoreId ? { storeId: activeStoreId } : {}),
      syncFlow: {
        checkInPublishAttemptedAt:
          localRuntimeSyncSource?.debug?.checkInPublishAttemptedAt,
        checkInPublishCompletedAt:
          localRuntimeSyncSource?.debug?.checkInPublishCompletedAt,
        checkInPublishMessage:
          localRuntimeSyncSource?.debug?.checkInPublishMessage,
        checkInPublishReason:
          localRuntimeSyncSource?.debug?.checkInPublishReason,
        checkInPublishStatus:
          localRuntimeSyncSource?.debug?.checkInPublishStatus,
        eventAppendToken: localSyncEventAppendToken,
        failureCount: localRuntimeSyncSource?.debug?.failureCount,
        failedEventCount: localRuntimeSyncSource?.debug?.failedEventCount,
        lastBatchEventCount: localRuntimeSyncSource?.debug?.lastBatchEventCount,
        lastFailure: localRuntimeSyncSource?.debug?.lastFailure,
        lastHeldEventCount: localRuntimeSyncSource?.debug?.lastHeldEventCount,
        lastLocalSequence: localRegisterReadModel?.syncStatus.lastLocalSequence,
        lastReviewEventCount:
          localRuntimeSyncSource?.debug?.lastReviewEventCount,
        lastRuntimeTrigger:
          localRuntimeSyncSource?.debug?.lastTrigger ?? "none",
        lastRuntimeTriggerAt: localRuntimeSyncSource?.debug?.lastTriggerAt,
        lastRuntimeTriggerPriority:
          localRuntimeSyncSource?.debug?.lastTriggerPriority ?? "normal",
        lastSyncedSequence:
          localRegisterReadModel?.syncStatus.lastSyncedSequence,
        localOnlyEventCount: localRuntimeSyncSource?.debug?.localOnlyEventCount,
        mode: localRuntimeSyncSource?.debug?.mode,
        nextPendingSequence:
          localRegisterReadModel?.syncStatus.nextPendingSequence,
        oldestPendingEventAt:
          localRuntimeSyncSource?.debug?.oldestPendingEventAt,
        oldestPendingEventId:
          localRuntimeSyncSource?.debug?.oldestPendingEventId,
        oldestPendingEventSequence:
          localRuntimeSyncSource?.debug?.oldestPendingEventSequence,
        oldestPendingUploadSequence:
          localRuntimeSyncSource?.debug?.oldestPendingUploadSequence,
        nextPendingUploadSequence:
          localRuntimeSyncSource?.debug?.nextPendingUploadSequence,
        pendingEventCount: syncStatus?.pendingEventCount ?? 0,
        pendingUploadEventCount:
          localRuntimeSyncSource?.debug?.pendingUploadEventCount,
        reviewEventCount: localRuntimeSyncSource?.debug?.reviewEventCount,
        schedulerBackoffUntil:
          localRuntimeSyncSource?.debug?.schedulerBackoffUntil,
        schedulerRunning: localRuntimeSyncSource?.debug?.schedulerRunning,
        schedulerScheduled: localRuntimeSyncSource?.debug?.schedulerScheduled,
        source: localRuntimeStatusSource
          ? "runtime"
          : localReadModelSyncSource
            ? "local-read-model"
            : localSyncSource
              ? "register-state"
              : "none",
        staffProof: staffProofToken ? "present" : "missing",
        status: syncStatus?.status ?? "synced",
      },
      ...(terminal?._id ? { terminalId: terminal._id } : {}),
      terminalSource: terminal
        ? terminal.status === "local"
          ? "local"
          : "live"
        : "missing",
    },
    header,
    registerInfo,
    onboarding,
    customerPanel: {
      isOpen: showCustomerPanel,
      onOpenChange: setShowCustomerPanel,
      customerInfo: getRegisterCustomerInfo(customerInfo),
      onCustomerCommitted: commitCustomerInfoBestEffort,
      setCustomerInfo,
    },
    productEntry: {
      canSearchProducts: terminalCanTransactProducts,
      canSearchServices: terminalCanTransactServices,
      disabled:
        !terminal ||
        !staffProfileId ||
        cashierPresenceBlocksSale ||
        shouldShowDrawerGate ||
        cloudRegisterSessionBlocksLocalProjection ||
        activeSessionHasBlockedRegisterBinding ||
        isOpeningDrawer,
      showProductLookup: showProductEntry,
      setShowProductLookup: setShowProductEntry,
      productSearchQuery,
      setProductSearchQuery,
      onBarcodeSubmit: handleBarcodeSubmit,
      onAddProduct: handleAddProduct,
      searchResults: registerSearchProducts,
      isSearchLoading: isRegisterSearchLoading,
      isSearchReady: isRegisterCatalogReady,
      canQuickAddProduct: terminalCanTransactProducts && isCashierManager,
      canAddPendingCheckoutItem: terminalCanTransactProducts,
      pendingCheckoutContext:
        staffProfileId && terminal?._id && activeRegisterSessionId
          ? {
              createdByStaffProfileId: staffProfileId,
              registerSessionId: activeRegisterSessionId,
              terminalId: terminal._id,
            }
          : undefined,
    },
    serviceEntry: terminalCanTransactServices
      ? {
          disabled:
            !terminal ||
            !staffProfileId ||
            cashierPresenceBlocksSale ||
            shouldShowDrawerGate ||
            cloudRegisterSessionBlocksLocalProjection ||
            activeSessionHasBlockedRegisterBinding ||
            isOpeningDrawer,
          serviceSearchQuery: productSearchQuery,
          setServiceSearchQuery: setProductSearchQuery,
          searchResults: serviceSearchResults,
          isSearchLoading: serviceCatalogResult === undefined,
          isSearchReady: serviceCatalogResult !== undefined,
          items: serviceLineDrafts,
          onAddService: handleAddService,
          onUpdateServiceAmount: handleUpdateServiceAmount,
          onRemoveService: handleRemoveService,
          checkoutBlockMessage: serviceCheckoutBlockMessage,
        }
      : undefined,
    cart: {
      items: activeCartItems,
      serviceItems: serviceLineDrafts,
      onUpdateServiceAmount: handleUpdateServiceAmount,
      onRemoveService: handleRemoveService,
      onUpdateQuantity: async (itemId, quantity) => {
        await handleUpdateQuantity(itemId as Id<"posSessionItem">, quantity);
      },
      onRemoveItem: async (itemId) => {
        await handleRemoveItem(itemId as Id<"posSessionItem">);
      },
      onClearCart: handleClearCart,
    },
    checkout: {
      cartItems: activeCartItems,
      customerInfo: hasCustomerDetails(customerInfo)
        ? {
            name: customerInfo.name,
            email: customerInfo.email,
            phone: customerInfo.phone,
          }
        : undefined,
      registerNumber,
      currency: activeStoreCurrency,
      subtotal: combinedActiveTotals.subtotal,
      tax: combinedActiveTotals.tax,
      total: combinedActiveTotals.total,
      payments,
      hasTerminal: Boolean(terminal),
      isTransactionCompleted,
      completedOrderNumber,
      completionBlockMessage: serviceCheckoutBlockMessage,
      serviceLines: serviceLineDrafts.map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.price,
        totalPrice: item.price * item.quantity,
        serviceMode: item.serviceMode,
      })),
      completedTransactionData,
      cashierName: getCashierDisplayName(cashier),
      actorStaffProfileId: staffProfileId,
      onAddPayment: handleAddPayment,
      onUpdatePayment: handleUpdatePayment,
      onRemovePayment: handleRemovePayment,
      onClearPayments: handleClearPayments,
      onCompleteTransaction: handleCompleteTransaction,
      onStartNewTransaction: handleStartNewTransaction,
    },
    sessionPanel,
    cashierCard,
    cashierPresenceRestore,
    drawerGate,
    closeoutControl,
    updateApplyBlocker,
    syncStatus,
    authDialog,
    commandApprovalDialog,
    onNavigateBack: handleNavigateBack,
  };
}

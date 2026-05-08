import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";

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
import { bootstrapRegister } from "@/lib/pos/application/useCases/bootstrapRegister";
import { addItem as runAddItem } from "@/lib/pos/application/useCases/addItem";
import { completeTransaction as runCompleteTransaction } from "@/lib/pos/application/useCases/completeTransaction";
import { holdSession as runHoldSession } from "@/lib/pos/application/useCases/holdSession";
import { openDrawer as runOpenDrawer } from "@/lib/pos/application/useCases/openDrawer";
import { startSession as runStartSession } from "@/lib/pos/application/useCases/startSession";
import {
  calculatePosCartTotals,
  type PosPaymentMethod,
} from "@/lib/pos/domain";
import { parseDisplayAmountInput } from "@/lib/pos/displayAmounts";
import { toOperatorMessage } from "@/lib/errors/operatorMessages";
import { isApprovalRequiredResult, runCommand } from "@/lib/errors/runCommand";
import type { CommandApprovalProofResult } from "@/components/operations/CommandApprovalDialog";
import { useApprovedCommand } from "@/components/operations/useApprovedCommand";
import { logger } from "@/lib/logger";
import { useConvexCommandGateway } from "@/lib/pos/infrastructure/convex/commandGateway";
import {
  useConvexRegisterCatalog,
  useConvexRegisterCatalogAvailability,
} from "@/lib/pos/infrastructure/convex/catalogGateway";
import { useConvexRegisterState } from "@/lib/pos/infrastructure/convex/registerGateway";
import { isPosUsableRegisterSessionStatus } from "~/shared/registerSessionStatus";
import { userError, type CommandResult } from "~/shared/commandResult";
import type { ApprovalRequirement } from "~/shared/approvalPolicy";
import {
  useConvexActiveSession,
  useConvexHeldSessions,
  useConvexSessionActions,
  type PosSessionCustomer,
  type PosSessionDetail,
} from "@/lib/pos/infrastructure/convex/sessionGateway";

import type {
  RegisterCommandApprovalDialogState,
  RegisterViewModel,
} from "./registerUiState";
import { EMPTY_REGISTER_CUSTOMER_INFO } from "./registerUiState";
import {
  buildRegisterHeaderState,
  buildRegisterInfoState,
  getCashierDisplayName,
  getRegisterCustomerInfo,
  isRegisterSessionActive,
} from "./selectors";
import {
  searchRegisterCatalog,
  type RegisterCatalogSearchRow,
  type RegisterCatalogSearchResult,
} from "./catalogSearch";
import { useRegisterCatalogIndex } from "./useRegisterCatalogIndex";

function hasCustomerDetails(
  customer: CustomerInfo | undefined | null,
): boolean {
  if (!customer) {
    return false;
  }

  return Boolean(
    customer.customerProfileId ||
    customer.name.trim() ||
    customer.email.trim() ||
    customer.phone.trim(),
  );
}

function mapSessionCustomer(customer: PosSessionCustomer): CustomerInfo {
  if (!customer) {
    return EMPTY_REGISTER_CUSTOMER_INFO;
  }

  return {
    customerProfileId: customer.customerProfileId,
    name: customer.name,
    email: customer.email ?? "",
    phone: customer.phone ?? "",
  };
}

function combinePaymentsByMethod(payments: Payment[]): Payment[] {
  return payments.reduce<Payment[]>((combinedPayments, payment) => {
    const existingPayment = combinedPayments.find(
      (candidate) => candidate.method === payment.method,
    );

    if (!existingPayment) {
      combinedPayments.push(payment);
      return combinedPayments;
    }

    existingPayment.amount += payment.amount;
    existingPayment.timestamp = Math.max(
      existingPayment.timestamp,
      payment.timestamp,
    );
    return combinedPayments;
  }, []);
}

function createPaymentId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `payment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
}

function trimOptional(value: string): string | undefined {
  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

function presentOperatorError(message: string): void {
  toast.error(toOperatorMessage(message));
}

type RegisterCatalogAvailability = {
  inStock: boolean;
  quantityAvailable: number;
};

function mapCatalogRowToProduct(
  row: RegisterCatalogSearchRow,
  availability: RegisterCatalogAvailability | undefined,
): Product {
  return {
    id: row.productSkuId,
    name: row.name,
    sku: row.sku ?? "",
    barcode: row.barcode ?? "",
    price: row.price ?? 0,
    category: row.category ?? "",
    description: row.description ?? "",
    image: row.image ?? null,
    inStock: availability?.inStock ?? false,
    quantityAvailable: availability?.quantityAvailable ?? 0,
    size: row.size ?? "",
    length:
      typeof row.length === "number"
        ? row.length
        : row.length
          ? Number(row.length)
          : null,
    color: row.color ?? "",
    productId: row.productId as Id<"product">,
    skuId: row.productSkuId as Id<"productSku">,
    areProcessingFeesAbsorbed: Boolean(row.areProcessingFeesAbsorbed),
  };
}

function mapProductToOptimisticCartItem(
  product: Product,
  quantity: number,
): CartItem {
  return {
    id: `optimistic:${product.skuId ?? product.id}` as Id<"posSessionItem">,
    name: product.name,
    barcode: product.barcode,
    sku: product.sku,
    price: product.price,
    quantity,
    image: product.image ?? undefined,
    size: product.size,
    length: product.length,
    color: product.color,
    productId: product.productId,
    skuId: product.skuId,
    areProcessingFeesAbsorbed: product.areProcessingFeesAbsorbed,
  };
}

function normalizeExactInput(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

type StaffProfileRosterRow = {
  credentialStatus?: "pending" | "active" | "suspended" | "revoked" | null;
  primaryRole?:
    | "manager"
    | "front_desk"
    | "stylist"
    | "technician"
    | "cashier"
    | null;
  roles?: Array<
    "manager" | "front_desk" | "stylist" | "technician" | "cashier"
  >;
  status?: "active" | "inactive";
};

function canOperateRegister(staff: StaffProfileRosterRow): boolean {
  if (staff.status !== "active" || staff.credentialStatus !== "active") {
    return false;
  }

  const roles = staff.roles?.length ? staff.roles : [staff.primaryRole];
  return roles.some((role) => role === "cashier" || role === "manager");
}

export function useRegisterViewModel(): RegisterViewModel {
  const { activeStore } = useGetActiveStore();
  const { user } = useAuth();
  const terminal = useGetTerminal();
  const navigateBack = useNavigateBack();
  const [staffProfileId, setStaffProfileId] =
    useState<Id<"staffProfile"> | null>(null);
  const terminalRegisterNumber = terminal?.registerNumber
    ? trimOptional(terminal.registerNumber)
    : undefined;
  const [showCustomerPanel, setShowCustomerPanel] = useState(false);
  const [showProductEntry, setShowProductEntry] = useState(true);
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>(
    EMPTY_REGISTER_CUSTOMER_INFO,
  );
  const [payments, setPayments] = useState<Payment[]>([]);
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
  const paymentsRef = useRef<Payment[]>([]);
  const checkoutStateVersionRef = useRef(0);
  const activeSessionIdRef = useRef<Id<"posSession"> | null>(null);
  const isMountedRef = useRef(true);
  const customerCommitQueueRef = useRef<Promise<void>>(Promise.resolve());
  const drawerBindingRequestRef = useRef<string | null>(null);
  const unmountSessionRef = useRef<Id<"posSession"> | null>(null);
  const unmountSessionCartItemCountRef = useRef(0);
  const exactAddKeyRef = useRef<string | null>(null);
  const [optimisticCartQuantities, setOptimisticCartQuantities] = useState<
    Record<string, number>
  >({});
  const [optimisticCartProducts, setOptimisticCartProducts] = useState<
    Record<string, CartItem>
  >({});

  const registerState = useConvexRegisterState({
    storeId: activeStore?._id,
    terminalId: terminal?._id ?? null,
    staffProfileId,
    registerNumber: terminalRegisterNumber,
  });
  const bootstrapState = bootstrapRegister({
    registerState,
  });
  const staffRosterResult = useQuery(
    api.operations.staffProfiles.listStaffProfiles,
    activeStore?._id ? { storeId: activeStore._id } : "skip",
  ) as unknown;
  const isStaffRosterLoaded =
    !activeStore?._id || Array.isArray(staffRosterResult);
  const staffRoster = Array.isArray(staffRosterResult)
    ? (staffRosterResult as StaffProfileRosterRow[])
    : [];
  const activeRegisterOperatorCount =
    staffRoster.filter(canOperateRegister).length;
  const activeSession = useConvexActiveSession({
    storeId: activeStore?._id,
    terminalId: terminal?._id ?? null,
    staffProfileId,
    registerNumber: terminalRegisterNumber,
  });
  const registerCatalogRows = useConvexRegisterCatalog({
    storeId: activeStore?._id,
  });
  const registerCatalogIndex = useRegisterCatalogIndex(registerCatalogRows);
  const registerMetadataSearchState = useMemo(
    () => searchRegisterCatalog(registerCatalogIndex, productSearchQuery),
    [productSearchQuery, registerCatalogIndex],
  );
  const registerAvailabilityProductSkuIds = useMemo(
    () =>
      registerMetadataSearchState.results.map(
        (row) => row.productSkuId as Id<"productSku">,
      ),
    [registerMetadataSearchState.results],
  );
  const registerCatalogAvailabilityRows = useConvexRegisterCatalogAvailability({
    storeId: activeStore?._id,
    productSkuIds: registerAvailabilityProductSkuIds,
  });
  const registerCatalogAvailabilityBySkuId = useMemo(() => {
    const rows = registerCatalogAvailabilityRows ?? [];

    return new Map<string, RegisterCatalogAvailability>(
      rows.map((row) => [row.productSkuId, row]),
    );
  }, [registerCatalogAvailabilityRows]);
  const registerSearchState = useMemo<RegisterCatalogSearchResult>(() => {
    if (registerMetadataSearchState.intent !== "exact") {
      return registerMetadataSearchState;
    }

    const exactAvailability = registerMetadataSearchState.exactMatch
      ? registerCatalogAvailabilityBySkuId.get(
          registerMetadataSearchState.exactMatch.productSkuId,
        )
      : undefined;

    return {
      ...registerMetadataSearchState,
      canAutoAdd: Boolean(
        registerMetadataSearchState.exactMatch &&
        exactAvailability &&
        exactAvailability.quantityAvailable > 0,
      ),
    };
  }, [registerCatalogAvailabilityBySkuId, registerMetadataSearchState]);
  const registerSearchProducts = useMemo(
    () =>
      registerSearchState.results.map((row) =>
        mapCatalogRowToProduct(
          row,
          registerCatalogAvailabilityBySkuId.get(row.productSkuId),
        ),
      ),
    [registerCatalogAvailabilityBySkuId, registerSearchState.results],
  );
  const exactSearchProduct = registerSearchState.exactMatch
    ? mapCatalogRowToProduct(
        registerSearchState.exactMatch,
        registerCatalogAvailabilityBySkuId.get(
          registerSearchState.exactMatch.productSkuId,
        ),
      )
    : null;
  const isRegisterCatalogReady = registerCatalogRows !== undefined;
  const isRegisterSearchLoading =
    productSearchQuery.trim().length > 0 && !isRegisterCatalogReady;

  useEffect(() => {
    isMountedRef.current = true;
    activeSessionIdRef.current = activeSession?._id
      ? (activeSession._id as Id<"posSession">)
      : null;
  }, [activeSession?._id]);
  const usableActiveRegisterSession =
    registerState?.activeRegisterSession &&
    isPosUsableRegisterSessionStatus(registerState.activeRegisterSession.status)
      ? registerState.activeRegisterSession
      : null;
  const closeoutBlockedRegisterSession =
    registerState?.activeRegisterSession?.status === "closing"
      ? registerState.activeRegisterSession
      : null;
  const activeRegisterNumber =
    activeSession?.registerNumber ??
    usableActiveRegisterSession?.registerNumber ??
    closeoutBlockedRegisterSession?.registerNumber ??
    registerState?.activeSession?.registerNumber ??
    registerState?.resumableSession?.registerNumber;
  const activeRegisterSessionId = usableActiveRegisterSession?._id as
    | Id<"registerSession">
    | undefined;
  const registerNumber = activeRegisterNumber ?? terminalRegisterNumber ?? "";
  const heldSessions = useConvexHeldSessions({
    storeId: activeStore?._id,
    terminalId: terminal?._id ?? null,
    staffProfileId,
    limit: 10,
  });
  const cashier = registerState?.cashier ?? null;
  const isCashierManager = Boolean(cashier?.activeRoles?.includes("manager"));
  const activeSessionConflict = registerState?.activeSessionConflict ?? null;

  const {
    startSession: startSessionCommand,
    addItem: addItemCommand,
    holdSession: holdSessionCommand,
    openDrawer: openDrawerCommand,
    completeTransaction: completeTransactionCommand,
  } = useConvexCommandGateway();
  const submitRegisterSessionCloseout = useMutation(
    api.cashControls.closeouts.submitRegisterSessionCloseout,
  );
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
      if (!activeStore?._id) {
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
            storeId: activeStore._id,
            subject: args.subject,
            username: args.username,
          }) as Promise<CommandResult<CommandApprovalProofResult>>,
      );
    },
    [activeStore?._id, authenticateStaffCredentialForApproval],
  );
  const closeoutApprovalRunner = useApprovedCommand({
    storeId: activeStore?._id,
    onAuthenticateForApproval: authenticateForCloseoutApproval,
  });
  const reopenRegisterSessionCloseout = useMutation(
    api.cashControls.closeouts.reopenRegisterSessionCloseout,
  );
  const correctRegisterSessionOpeningFloat = useMutation(
    api.cashControls.closeouts.correctRegisterSessionOpeningFloat,
  );
  const {
    resumeSession,
    bindSessionToRegisterSession,
    voidSession,
    updateSession,
    syncSessionCheckoutState,
    releaseSessionInventoryHoldsAndDeleteItems,
    removeItem,
  } = useConvexSessionActions();
  const voidSessionRef = useRef<typeof voidSession>(voidSession);

  const operableActiveSession = activeSession;
  const serverCartItems = useMemo(
    () => operableActiveSession?.cartItems ?? [],
    [operableActiveSession?.cartItems],
  );
  const activeCartItems = useMemo(() => {
    const cartItems = serverCartItems
      .map((item) => {
        const optimisticQuantity = optimisticCartQuantities[item.id];
        return optimisticQuantity === undefined
          ? item
          : { ...item, quantity: optimisticQuantity };
      })
      .filter((item) => item.quantity > 0);

    for (const optimisticProduct of Object.values(optimisticCartProducts)) {
      if (!optimisticProduct.skuId) {
        cartItems.push(optimisticProduct);
        continue;
      }

      const existingIndex = cartItems.findIndex(
        (item) => item.skuId === optimisticProduct.skuId,
      );
      if (existingIndex >= 0) {
        const existingItem = cartItems[existingIndex];
        const optimisticQuantity = optimisticCartQuantities[existingItem.id];
        cartItems[existingIndex] =
          optimisticQuantity === undefined
            ? { ...existingItem, quantity: optimisticProduct.quantity }
            : existingItem;
      } else {
        cartItems.push(optimisticProduct);
      }
    }

    return cartItems;
  }, [optimisticCartProducts, optimisticCartQuantities, serverCartItems]);
  if (operableActiveSession?._id) {
    unmountSessionRef.current = operableActiveSession._id as Id<"posSession">;
    unmountSessionCartItemCountRef.current = activeCartItems.length;
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
  const hasActiveCustomerDetails = hasCustomerDetails(customerInfo);
  const hasActiveCartDraft = activeCartItems.length > 0;
  const hasClearableSaleState = Boolean(
    operableActiveSession &&
    (hasActiveCartDraft || hasActiveCustomerDetails || payments.length > 0),
  );
  const hasActivePosSession = Boolean(operableActiveSession?._id);
  const activeSessionNeedsRegisterBinding = Boolean(
    operableActiveSession?._id && !operableActiveSession.registerSessionId,
  );
  const activeSessionHasMismatchedRegisterBinding = Boolean(
    operableActiveSession?._id &&
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
    !usableActiveRegisterSession,
  );
  const hasMissingDrawerStartupState = Boolean(
    bootstrapState &&
    (bootstrapState.phase === "readyToStart" ||
      bootstrapState.phase === "resumable") &&
    !usableActiveRegisterSession,
  );
  const hasMissingDrawerRecoveryState = Boolean(
    bootstrapState &&
    !usableActiveRegisterSession &&
    (bootstrapState.phase === "active" ||
      bootstrapState.phase === "resumable" ||
      hasActivePosSession),
  );
  const requiresDrawerGate = Boolean(
    activeStore?._id &&
    terminal?._id &&
    staffProfileId &&
    bootstrapState &&
    (hasMissingDrawerStartupState ||
      hasCloseoutBlockedDrawerState ||
      hasMissingDrawerRecoveryState ||
      activeSessionHasBlockedRegisterBinding),
  );
  const closeoutBlockedGateIsRecovery = Boolean(
    hasCloseoutBlockedDrawerState &&
    (hasMissingDrawerRecoveryState || activeSessionHasBlockedRegisterBinding),
  );
  const activeCloseoutRegisterSession =
    closeoutBlockedRegisterSession ??
    (isCloseoutRequested ? usableActiveRegisterSession : null);
  const activeOpeningFloatCorrectionRegisterSession =
    isOpeningFloatCorrectionRequested && usableActiveRegisterSession
      ? usableActiveRegisterSession
      : null;
  const drawerGateMode:
    | "initialSetup"
    | "recovery"
    | "closeoutBlocked"
    | "openingFloatCorrection" = activeOpeningFloatCorrectionRegisterSession
    ? "openingFloatCorrection"
    : hasCloseoutBlockedDrawerState || activeCloseoutRegisterSession
      ? "closeoutBlocked"
      : hasMissingDrawerRecoveryState || activeSessionHasBlockedRegisterBinding
        ? "recovery"
        : "initialSetup";
  const setPaymentState = useCallback((nextPayments: Payment[]) => {
    paymentsRef.current = nextPayments;
    setPayments(nextPayments);
  }, []);
  const allocateCheckoutStateVersion = useCallback(() => {
    const nextVersion = Math.max(
      checkoutStateVersionRef.current + 1,
      Date.now(),
    );
    checkoutStateVersionRef.current = nextVersion;
    return nextVersion;
  }, []);

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
      setCustomerInfo(EMPTY_REGISTER_CUSTOMER_INFO);
      setPaymentState([]);

      if (!options?.keepTransactionCompletion) {
        setIsTransactionCompleted(false);
        setCompletedOrderNumber(null);
        setCompletedTransactionData(null);
      }

      if (!options?.keepCashier) {
        setStaffProfileId(null);
      }
    },
    [setPaymentState],
  );

  const requestBootstrap = useCallback(() => {
    bootstrapInitialized.current = false;
  }, []);

  useEffect(() => {
    if (!activeRegisterSessionId) {
      return;
    }

    setDrawerOpeningFloat("");
    setDrawerNotes("");
    setDrawerErrorMessage(null);
    setIsOpeningDrawer(false);
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
    activeStore?._id,
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
      checkoutStateVersionRef.current = 0;
      if (!isTransactionCompleted) {
        setCustomerInfo(EMPTY_REGISTER_CUSTOMER_INFO);
        setPaymentState([]);
        setShowCustomerPanel(false);
      }
      return;
    }

    checkoutStateVersionRef.current = 0;
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
    setPaymentState,
  ]);

  const ensureSessionId = useCallback(async () => {
    if (operableActiveSession?._id) {
      return operableActiveSession._id as Id<"posSession">;
    }

    if (registerState?.activeSession?._id) {
      return registerState.activeSession._id as Id<"posSession">;
    }

    if (!activeRegisterSessionId) {
      toast.error("Drawer closed. Open the drawer before adding items.");
      return null;
    }

    if (!activeStore?._id || !terminal?._id || !staffProfileId) {
      toast.error("Register sign-in required. Sign in before adding items.");
      return null;
    }

    const result = await runStartSession({
      gateway: {
        startSession: startSessionCommand,
      },
      command: {
        storeId: activeStore._id,
        terminalId: terminal._id,
        staffProfileId,
        registerNumber,
        registerSessionId: activeRegisterSessionId,
      },
    });

    if (!result.ok) {
      presentOperatorError(result.message);
      return null;
    }

    bootstrapInitialized.current = true;
    return result.data.sessionId;
  }, [
    operableActiveSession?._id,
    activeRegisterSessionId,
    activeStore?._id,
    staffProfileId,
    registerNumber,
    registerState?.activeSession?._id,
    startSessionCommand,
    terminal?._id,
  ]);

  const persistSessionMetadata = useCallback(
    async (session: PosSessionDetail | null | undefined) => {
      if (!session?._id || !staffProfileId) {
        return true;
      }

      const result = await updateSession({
        sessionId: session._id as Id<"posSession">,
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
      if (!operableActiveSession?._id || !staffProfileId) {
        return;
      }

      const sessionId = operableActiveSession._id as Id<"posSession">;
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
      operableActiveSession?._id,
      activeTotals.subtotal,
      activeTotals.tax,
      activeTotals.total,
      staffProfileId,
      updateSession,
    ],
  );

  const syncCheckoutStateBestEffort = useCallback(
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
        return;
      }

      if (activeSessionHasBlockedRegisterBinding) {
        logger.warn(
          "[POS] Skipped checkout sync while drawer recovery is required",
          {
            sessionId: operableActiveSession._id,
            stage: args.stage,
          },
        );
        return;
      }

      const result = await syncSessionCheckoutState({
        sessionId: operableActiveSession._id as Id<"posSession">,
        staffProfileId,
        checkoutStateVersion: args.checkoutStateVersion,
        payments: args.nextPayments.map(({ method, amount, timestamp }) => ({
          method,
          amount,
          timestamp,
        })),
        stage: args.stage,
        paymentMethod: args.paymentMethod,
        amount: args.amount,
        previousAmount: args.previousAmount,
      });

      if (result.kind !== "ok") {
        logger.warn("[POS] Failed to sync checkout state", {
          sessionId: operableActiveSession._id,
          stage: args.stage,
          error: result.error.message,
        });
      }
    },
    [
      operableActiveSession?._id,
      activeSessionHasBlockedRegisterBinding,
      staffProfileId,
      syncSessionCheckoutState,
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
    setPaymentState([]);
    void syncCheckoutStateBestEffort({
      checkoutStateVersion,
      nextPayments: [],
      stage: "paymentsCleared",
    });
  }, [
    activeCartItems.length,
    allocateCheckoutStateVersion,
    isTransactionCompleted,
    payments.length,
    setPaymentState,
    syncCheckoutStateBestEffort,
  ]);

  const holdCurrentSession = useCallback(
    async (reason?: string) => {
      if (!operableActiveSession || !staffProfileId) {
        toast.error(
          "No sale in progress. Start a sale before placing it on hold.",
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
          sessionId: operableActiveSession._id as Id<"posSession">,
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

    const result = await voidSession({
      sessionId: operableActiveSession._id as Id<"posSession">,
    });

    if (result.kind !== "ok") {
      presentOperatorError(result.error.message);
      return false;
    }

    const hadCartItems = operableActiveSession.cartItems.length > 0;

    resetDraftState({
      keepCashier: true,
    });
    if (hadCartItems) {
      toast.success("Sale cleared");
    }
    return true;
  }, [operableActiveSession, resetDraftState, voidSession]);

  const handleResumeSession = useCallback(
    async (sessionId: Id<"posSession">) => {
      if (!staffProfileId || !terminal?._id) {
        toast.error(
          "Register sign-in required. Sign in before resuming a sale.",
        );
        return;
      }

      if (operableActiveSession && operableActiveSession._id !== sessionId) {
        const hasDraftState = operableActiveSession.cartItems.length > 0;
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
      staffProfileId,
      holdCurrentSession,
      resumeSession,
      setPaymentState,
      terminal?._id,
    ],
  );

  const handleStartNewSession = useCallback(async () => {
    if (guardActiveSessionConflict()) {
      return;
    }

    if (!activeStore?._id || !terminal?._id || !staffProfileId) {
      toast.error("Register sign-in required. Sign in before starting a sale.");
      return;
    }

    if (!activeRegisterSessionId) {
      toast.error("Drawer closed. Open the drawer before starting a sale.");
      return;
    }

    if (operableActiveSession) {
      const hasDraftState = operableActiveSession.cartItems.length > 0;
      const handled = hasDraftState
        ? await holdCurrentSession("Auto-held for new session")
        : true;

      if (!handled) {
        return;
      }
    }

    const result = await runStartSession({
      gateway: {
        startSession: startSessionCommand,
      },
      command: {
        storeId: activeStore._id,
        terminalId: terminal._id,
        staffProfileId,
        registerNumber,
        registerSessionId: activeRegisterSessionId,
      },
    });

    if (!result.ok) {
      presentOperatorError(result.message);
      return;
    }

    resetDraftState({
      keepCashier: true,
    });
    bootstrapInitialized.current = true;
    toast.success("Sale started");
  }, [
    operableActiveSession,
    activeRegisterSessionId,
    activeStore?._id,
    staffProfileId,
    guardActiveSessionConflict,
    holdCurrentSession,
    registerNumber,
    resetDraftState,
    startSessionCommand,
    terminal?._id,
  ]);

  const handleOpenDrawer = useCallback(async () => {
    if (!activeStore?._id || !terminal?._id || !staffProfileId) {
      setDrawerErrorMessage(
        "Register sign-in required. Sign in before opening the drawer.",
      );
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

    const result = await runOpenDrawer({
      gateway: {
        openDrawer: openDrawerCommand,
      },
      command: {
        storeId: activeStore._id,
        terminalId: terminal._id,
        staffProfileId,
        registerNumber,
        openingFloat: parsedOpeningFloat,
        notes: trimOptional(drawerNotes),
      },
    });

    setIsOpeningDrawer(false);

    if (!result.ok) {
      setDrawerErrorMessage(toOperatorMessage(result.message));
      return;
    }

    requestBootstrap();
    toast.success("Drawer open");
  }, [
    activeStore?._id,
    staffProfileId,
    drawerNotes,
    drawerOpeningFloat,
    openDrawerCommand,
    registerNumber,
    requestBootstrap,
    terminal?._id,
  ]);

  const runRegisterCloseoutSubmit = useCallback(
    async (args: {
      approvalProofId?: Id<"approvalProof">;
      countedCash: number;
      notes?: string;
      registerSessionId: Id<"registerSession">;
      sameSubmissionApproval?: {
        pinHash: string;
        username: string;
      };
    }) => {
      if (!activeStore?._id || !user?._id || !staffProfileId) {
        setDrawerErrorMessage(
          "Register sign-in required. Sign in before submitting closeout.",
        );
        return;
      }

      setDrawerErrorMessage(null);
      await closeoutApprovalRunner.run({
        requestedByStaffProfileId: staffProfileId,
        sameSubmissionApproval: args.sameSubmissionApproval
          ? {
              canAttemptInlineManagerProof: isCashierManager,
              pinHash: args.sameSubmissionApproval.pinHash,
              requestedByStaffProfileId: staffProfileId,
              username: args.sameSubmissionApproval.username,
            }
          : undefined,
        execute: async (approvalArgs) => {
          setIsSubmittingCloseout(true);
          const result = await runCommand(() =>
            submitRegisterSessionCloseout({
              actorStaffProfileId: staffProfileId,
              actorUserId: user._id,
              approvalProofId:
                approvalArgs.approvalProofId ?? args.approvalProofId,
              countedCash: args.countedCash,
              notes: args.notes,
              registerSessionId: args.registerSessionId,
              storeId: activeStore._id,
            }),
          );
          setIsSubmittingCloseout(false);
          return result;
        },
        onApprovalRequired: (approval) => {
          const createdAsyncRequest = approval.resolutionModes.some(
            (mode) =>
              mode.kind === "async_request" && Boolean(mode.approvalRequestId),
          );

          if (createdAsyncRequest) {
            toast.success("Closeout submitted for manager review");
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

          setCloseoutCountedCash("");
          setCloseoutNotes("");
          if (result.data?.action === "closed") {
            setIsCloseoutRequested(false);
          }
          requestBootstrap();
          toast.success("Register session closed");
        },
      });
    },
    [
      activeStore?._id,
      closeoutApprovalRunner,
      isCashierManager,
      requestBootstrap,
      staffProfileId,
      submitRegisterSessionCloseout,
      user?._id,
    ],
  );

  const handleSubmitRegisterCloseout = useCallback(async () => {
    if (!activeStore?._id || !user?._id || !staffProfileId) {
      setDrawerErrorMessage(
        "Register sign-in required. Sign in before submitting closeout.",
      );
      return;
    }

    const registerSessionId = activeCloseoutRegisterSession?._id as
      | Id<"registerSession">
      | undefined;

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

    if (hasCloseoutVariance && !trimmedCloseoutNotes) {
      setDrawerErrorMessage(
        "Closeout notes required. Add notes before submitting a count with variance.",
      );
      return;
    }

    await runRegisterCloseoutSubmit({
      countedCash: parsedCountedCash,
      notes: trimmedCloseoutNotes,
      registerSessionId,
    });
  }, [
    activeStore?._id,
    activeCloseoutRegisterSession?._id,
    activeCloseoutRegisterSession?.expectedCash,
    closeoutCountedCash,
    closeoutNotes,
    runRegisterCloseoutSubmit,
    staffProfileId,
    user?._id,
  ]);

  const handleReopenRegisterCloseout = useCallback(async () => {
    if (!closeoutBlockedRegisterSession) {
      setIsCloseoutRequested(false);
      setCloseoutCountedCash("");
      setCloseoutNotes("");
      setDrawerErrorMessage(null);
      return;
    }

    if (!activeStore?._id || !user?._id || !staffProfileId) {
      setDrawerErrorMessage(
        "Register sign-in required. Sign in before reopening the register.",
      );
      return;
    }

    const registerSessionId = activeCloseoutRegisterSession?._id as
      | Id<"registerSession">
      | undefined;

    if (!registerSessionId) {
      setDrawerErrorMessage(
        "Reopen unavailable. Refresh the register and try again.",
      );
      return;
    }

    setDrawerErrorMessage(null);
    setIsReopeningCloseout(true);

    const result = await runCommand(() =>
      reopenRegisterSessionCloseout({
        actorStaffProfileId: staffProfileId,
        actorUserId: user._id,
        registerSessionId,
        storeId: activeStore._id,
      }),
    );

    setIsReopeningCloseout(false);

    if (result.kind !== "ok") {
      setDrawerErrorMessage(toOperatorMessage(result.error.message));
      return;
    }

    setCloseoutCountedCash("");
    setCloseoutNotes("");
    requestBootstrap();
    toast.success("Register reopened");
  }, [
    activeStore?._id,
    activeCloseoutRegisterSession?._id,
    closeoutBlockedRegisterSession,
    reopenRegisterSessionCloseout,
    requestBootstrap,
    staffProfileId,
    user?._id,
  ]);

  const handleSubmitOpeningFloatCorrection = useCallback(async () => {
    if (!activeStore?._id || !user?._id || !staffProfileId) {
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
              storeId: activeStore._id,
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
    activeStore?._id,
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
      !operableActiveSession?._id ||
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
        sessionId: operableActiveSession._id as Id<"posSession">,
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
    operableActiveSession?._id,
    operableActiveSession?.registerSessionId,
    bindSessionToRegisterSession,
    requestBootstrap,
    staffProfileId,
  ]);

  useEffect(() => {
    if (
      !activeStore?._id ||
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

      const result = await runStartSession({
        gateway: {
          startSession: startSessionCommand,
        },
        command: {
          storeId: activeStore._id,
          terminalId: terminal._id,
          staffProfileId,
          registerNumber,
          registerSessionId: activeRegisterSessionId,
        },
      });

      if (!result.ok) {
        presentOperatorError(result.message);
        bootstrapInitialized.current = false;
      }
    })();
  }, [
    activeStore?._id,
    activeRegisterSessionId,
    bootstrapState,
    staffProfileId,
    isTransactionCompleted,
    registerNumber,
    requiresDrawerGate,
    resumeSession,
    startSessionCommand,
    terminal?._id,
  ]);

  const handleAddProduct = useCallback(
    async (product: Product) => {
      if (!staffProfileId) {
        toast.error("Register sign-in required. Sign in before adding items.");
        return false;
      }

      if (!product.productId || !product.skuId) {
        toast.error("Item details unavailable. Try another item.");
        return false;
      }

      if (activeSessionHasBlockedRegisterBinding) {
        toast.error("Drawer closed. Open the drawer before adding items.");
        return false;
      }

      const sessionId = await ensureSessionId();
      if (!sessionId) {
        return false;
      }

      const existingItem = activeCartItems.find(
        (item) => item.skuId === product.skuId,
      );
      const nextQuantity = existingItem ? existingItem.quantity + 1 : 1;
      const optimisticProductKey = product.skuId;
      const previousOptimisticProduct = optimisticCartProducts[product.skuId];
      const isExistingOptimisticProduct = existingItem?.id
        .toString()
        .startsWith("optimistic:");
      if (existingItem && !isExistingOptimisticProduct) {
        setOptimisticCartQuantities((current) => ({
          ...current,
          [existingItem.id]: nextQuantity,
        }));
      } else {
        setOptimisticCartProducts((current) => ({
          ...current,
          [optimisticProductKey]: mapProductToOptimisticCartItem(
            product,
            nextQuantity,
          ),
        }));
      }

      const result = await runAddItem({
        gateway: {
          addItem: addItemCommand,
        },
        command: {
          sessionId,
          staffProfileId,
          productId: product.productId,
          productSkuId: product.skuId,
          productSku: product.sku || "",
          barcode: product.barcode || undefined,
          productName: product.name,
          price: product.price,
          quantity: nextQuantity,
          image: product.image || undefined,
          size: product.size || undefined,
          length: product.length || undefined,
          color: product.color || undefined,
          areProcessingFeesAbsorbed: product.areProcessingFeesAbsorbed,
        },
      });

      if (!result.ok) {
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
        presentOperatorError(result.message);
        return false;
      }

      setProductSearchQuery("");
      return true;
    },
    [
      activeCartItems,
      activeSessionHasBlockedRegisterBinding,
      addItemCommand,
      ensureSessionId,
      optimisticCartProducts,
      staffProfileId,
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

      const item = operableActiveSession.cartItems.find(
        (candidate) => candidate.id === itemId,
      );
      if (!item) {
        return;
      }

      if (quantity <= 0) {
        setOptimisticCartQuantities((current) => ({
          ...current,
          [itemId]: 0,
        }));

        const result = await removeItem({
          sessionId: operableActiveSession._id as Id<"posSession">,
          staffProfileId,
          itemId,
        });

        if (result.kind !== "ok") {
          setOptimisticCartQuantities((current) => {
            const next = { ...current };
            delete next[itemId];
            return next;
          });
          presentOperatorError(result.error.message);
        }

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

      const result = await runAddItem({
        gateway: {
          addItem: addItemCommand,
        },
        command: {
          sessionId: operableActiveSession._id as Id<"posSession">,
          staffProfileId,
          productId: item.productId,
          productSkuId: item.skuId,
          productSku: item.sku || "",
          barcode: item.barcode || undefined,
          productName: item.name,
          price: item.price,
          quantity,
          image: item.image || undefined,
          size: item.size || undefined,
          length: item.length || undefined,
          color: item.color || undefined,
          areProcessingFeesAbsorbed: item.areProcessingFeesAbsorbed,
        },
      });

      if (!result.ok) {
        setOptimisticCartQuantities((current) => {
          const next = { ...current };
          delete next[itemId];
          return next;
        });
        presentOperatorError(result.message);
      }
    },
    [
      operableActiveSession,
      activeSessionHasBlockedRegisterBinding,
      addItemCommand,
      removeItem,
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

      setOptimisticCartQuantities((current) => ({
        ...current,
        [itemId]: 0,
      }));

      const result = await removeItem({
        sessionId: operableActiveSession._id as Id<"posSession">,
        staffProfileId,
        itemId,
      });

      if (result.kind !== "ok") {
        setOptimisticCartQuantities((current) => {
          const next = { ...current };
          delete next[itemId];
          return next;
        });
        presentOperatorError(result.error.message);
      }
    },
    [
      operableActiveSession,
      activeSessionHasBlockedRegisterBinding,
      removeItem,
      staffProfileId,
    ],
  );

  const handleClearCart = useCallback(async () => {
    if (!operableActiveSession || !staffProfileId) {
      return;
    }

    if (activeSessionHasBlockedRegisterBinding) {
      toast.error("Drawer closed. Open the drawer before updating this sale.");
      return;
    }

    const checkoutStateVersion = allocateCheckoutStateVersion();
    const previousOptimisticCartQuantities = optimisticCartQuantities;
    const previousOptimisticCartProducts = optimisticCartProducts;
    setOptimisticCartQuantities((current) => {
      const next = { ...current };
      for (const item of operableActiveSession.cartItems) {
        next[item.id] = 0;
      }
      return next;
    });
    setOptimisticCartProducts({});

    const result = await releaseSessionInventoryHoldsAndDeleteItems({
      sessionId: operableActiveSession._id as Id<"posSession">,
      staffProfileId,
      checkoutStateVersion,
    });

    if (result.kind !== "ok") {
      setOptimisticCartQuantities(previousOptimisticCartQuantities);
      setOptimisticCartProducts(previousOptimisticCartProducts);
      presentOperatorError(result.error.message);
      return;
    }

    const hadCartItems = operableActiveSession.cartItems.length > 0;

    setPaymentState([]);
    if (hadCartItems) {
      toast.success("Sale cleared");
    }
  }, [
    operableActiveSession,
    activeSessionHasBlockedRegisterBinding,
    allocateCheckoutStateVersion,
    optimisticCartProducts,
    optimisticCartQuantities,
    releaseSessionInventoryHoldsAndDeleteItems,
    setPaymentState,
    staffProfileId,
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

      if (registerSearchState.results.length === 0) {
        toast.error("Item not found. Scan again or search by name.");
      }
    },
    [addExactSearchProductOnce, productSearchQuery, registerSearchState],
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
    (nextStaffProfileId: Id<"staffProfile">) => {
      setStaffProfileId(nextStaffProfileId);
      requestBootstrap();
    },
    [requestBootstrap],
  );

  const handleNavigateBack = useCallback(async () => {
    if (operableActiveSession) {
      const hasDraftState = operableActiveSession.cartItems.length > 0;

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
    holdCurrentSession,
    voidCurrentSession,
    navigateBack,
    resetDraftState,
  ]);

  const handleCashierSignOut = useCallback(async () => {
    if (operableActiveSession) {
      const hasDraftState = operableActiveSession.cartItems.length > 0;

      const handled = hasDraftState
        ? await holdCurrentSession("Signing out")
        : await voidCurrentSession();

      if (!handled) {
        return;
      }
    }

    resetDraftState();
  }, [
    operableActiveSession,
    holdCurrentSession,
    resetDraftState,
    voidCurrentSession,
  ]);

  const handleCompleteTransaction = useCallback(async () => {
    if (!operableActiveSession || !staffProfileId) {
      toast.error("No sale in progress. Start a sale before taking payment.");
      return false;
    }

    const currentPayments = paymentsRef.current;

    const persisted = await persistSessionMetadata(operableActiveSession);
    if (!persisted) {
      return false;
    }

    const result = await runCompleteTransaction({
      gateway: {
        completeTransaction: completeTransactionCommand,
      },
      command: {
        sessionId: operableActiveSession._id as Id<"posSession">,
        staffProfileId,
        payments: currentPayments.map((payment) => ({
          method: payment.method,
          amount: payment.amount,
          timestamp: payment.timestamp,
        })),
        notes: `Register: ${registerNumber ?? "unconfigured"}`,
        subtotal: activeTotals.subtotal,
        tax: activeTotals.tax,
        total: activeTotals.total,
      },
    });

    if (!result.ok) {
      presentOperatorError(result.message);
      return false;
    }

    setIsTransactionCompleted(true);
    setCompletedOrderNumber(result.data.transactionNumber);
    setCompletedTransactionData({
      paymentMethod: currentPayments[0]?.method ?? "cash",
      payments: [...currentPayments],
      transactionId: result.data.transactionId,
      completedAt: new Date(),
      cartItems: [...activeCartItems],
      subtotal: activeTotals.subtotal,
      tax: activeTotals.tax,
      total: activeTotals.total,
      customerInfo: hasCustomerDetails(customerInfo)
        ? {
            name: customerInfo.name,
            email: customerInfo.email,
            phone: customerInfo.phone,
          }
        : undefined,
    });
    toast.success(
      `Sale completed. Transaction ${result.data.transactionNumber} recorded.`,
    );
    return true;
  }, [
    activeCartItems,
    operableActiveSession,
    activeTotals.subtotal,
    activeTotals.tax,
    activeTotals.total,
    completeTransactionCommand,
    customerInfo,
    persistSessionMetadata,
    registerNumber,
    staffProfileId,
  ]);

  const handleStartNewTransaction = useCallback(() => {
    resetDraftState({
      keepCashier: true,
    });
    requestBootstrap();
  }, [requestBootstrap, resetDraftState]);

  const handleAddPayment = useCallback(
    (method: PosPaymentMethod, amount: number) => {
      const currentPayments = paymentsRef.current;
      const checkoutStateVersion = allocateCheckoutStateVersion();
      const nextPayment = {
        id: createPaymentId(),
        method,
        amount,
        timestamp: Date.now(),
      };
      const nextPayments = combinePaymentsByMethod([
        ...currentPayments,
        nextPayment,
      ]);
      setPaymentState(nextPayments);
      void syncCheckoutStateBestEffort({
        checkoutStateVersion,
        nextPayments,
        stage: "paymentAdded",
        paymentMethod: method,
        amount,
      });
    },
    [
      allocateCheckoutStateVersion,
      setPaymentState,
      syncCheckoutStateBestEffort,
    ],
  );

  const handleUpdatePayment = useCallback(
    (paymentId: string, amount: number) => {
      const currentPayments = paymentsRef.current;
      const checkoutStateVersion = allocateCheckoutStateVersion();
      const previousPayment = currentPayments.find(
        (payment) => payment.id === paymentId,
      );
      const nextPayments = currentPayments.map((payment) =>
        payment.id === paymentId ? { ...payment, amount } : payment,
      );

      setPaymentState(nextPayments);

      if (!previousPayment) {
        return;
      }

      void syncCheckoutStateBestEffort({
        checkoutStateVersion,
        nextPayments,
        stage: "paymentUpdated",
        paymentMethod: previousPayment.method,
        amount,
        previousAmount: previousPayment.amount,
      });
    },
    [
      allocateCheckoutStateVersion,
      setPaymentState,
      syncCheckoutStateBestEffort,
    ],
  );

  const handleRemovePayment = useCallback(
    (paymentId: string) => {
      const currentPayments = paymentsRef.current;
      const checkoutStateVersion = allocateCheckoutStateVersion();
      const removedPayment = currentPayments.find(
        (payment) => payment.id === paymentId,
      );
      const nextPayments = currentPayments.filter(
        (payment) => payment.id !== paymentId,
      );
      setPaymentState(nextPayments);

      if (!removedPayment) {
        return;
      }

      void syncCheckoutStateBestEffort({
        checkoutStateVersion,
        nextPayments,
        stage: "paymentRemoved",
        paymentMethod: removedPayment.method,
        amount: removedPayment.amount,
      });
    },
    [
      allocateCheckoutStateVersion,
      setPaymentState,
      syncCheckoutStateBestEffort,
    ],
  );

  const handleClearPayments = useCallback(() => {
    if (paymentsRef.current.length === 0) {
      return;
    }

    const checkoutStateVersion = allocateCheckoutStateVersion();
    setPaymentState([]);
    void syncCheckoutStateBestEffort({
      checkoutStateVersion,
      nextPayments: [],
      stage: "paymentsCleared",
    });
  }, [
    allocateCheckoutStateVersion,
    setPaymentState,
    syncCheckoutStateBestEffort,
  ]);

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

  const sessionPanel =
    activeStore?._id && terminal?._id && staffProfileId
      ? {
          activeSessionNumber: operableActiveSession?.sessionNumber ?? null,
          activeSessionTraceId: operableActiveSession?.workflowTraceId ?? null,
          hasExpiredSession: false,
          canHoldSession: Boolean(operableActiveSession) && hasActiveCartDraft,
          canClearSale: hasClearableSaleState,
          disableNewSession: Boolean(
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

  const cashierCard =
    activeStore?._id && terminal?._id && staffProfileId
      ? {
          cashierName: getCashierDisplayName(cashier),
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

  const drawerGate =
    activeStore?._id && terminal?._id && staffProfileId && shouldShowDrawerGate
      ? drawerGateMode === "openingFloatCorrection"
        ? {
            mode: drawerGateMode,
            registerLabel: terminal.displayName,
            registerNumber,
            currency: activeStore.currency,
            currentOpeningFloat:
              activeOpeningFloatCorrectionRegisterSession?.openingFloat,
            correctedOpeningFloat,
            correctionReason: openingFloatCorrectionReason,
            expectedCash:
              activeOpeningFloatCorrectionRegisterSession?.expectedCash,
            errorMessage: drawerErrorMessage,
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
              currency: activeStore.currency,
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
              closeoutSecondaryActionLabel: closeoutBlockedRegisterSession
                ? "Reopen register"
                : "Return to sale",
              expectedCash: activeCloseoutRegisterSession?.expectedCash,
              canOpenCashControls: isCashierManager,
              cashControlsRegisterSessionId:
                activeCloseoutRegisterSession?._id as
                  | Id<"registerSession">
                  | undefined,
              hasPendingCloseoutApproval: Boolean(
                activeCloseoutRegisterSession?.managerApprovalRequestId,
              ),
              errorMessage: drawerErrorMessage,
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
              onSubmitCloseout: handleSubmitRegisterCloseout,
              onReopenRegister: handleReopenRegisterCloseout,
              onSignOut: handleCashierSignOut,
            }
          : {
              mode: drawerGateMode,
              registerLabel: terminal.displayName,
              registerNumber,
              currency: activeStore.currency,
              canOpenCashControls: isCashierManager,
              canOpenDrawer: isCashierManager,
              openingFloat: drawerOpeningFloat,
              notes: drawerNotes,
              errorMessage:
                drawerErrorMessage ??
                (activeSessionHasMismatchedRegisterBinding
                  ? "Sale assigned to a different drawer. Open that drawer before continuing."
                  : null),
              isSubmitting: isOpeningDrawer,
              onOpeningFloatChange: (value: string) => {
                setDrawerOpeningFloat(value);
                setDrawerErrorMessage(null);
              },
              onNotesChange: (value: string) => {
                setDrawerNotes(value);
                setDrawerErrorMessage(null);
              },
              onSubmit: handleOpenDrawer,
              onSignOut: handleCashierSignOut,
            }
      : null;
  const closeoutControl =
    activeStore?._id && terminal?._id && staffProfileId
      ? {
          canCloseout: Boolean(
            usableActiveRegisterSession &&
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

  const authDialog =
    activeStore?._id && terminal?._id
      ? {
          open: !staffProfileId,
          storeId: activeStore._id,
          terminalId: terminal._id,
          onAuthenticated: handleCashierAuthenticated,
          onDismiss: handleNavigateBack,
        }
      : null;

  const commandApprovalDialog =
    closeoutApprovalRunner.approvalDialog as RegisterCommandApprovalDialogState | null;

  return {
    hasActiveStore: Boolean(activeStore),
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
      disabled:
        !terminal ||
        !staffProfileId ||
        shouldShowDrawerGate ||
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
      canQuickAddProduct: isCashierManager,
    },
    cart: {
      items: activeCartItems,
      onUpdateQuantity: (itemId, quantity) =>
        handleUpdateQuantity(itemId as Id<"posSessionItem">, quantity),
      onRemoveItem: (itemId) =>
        handleRemoveItem(itemId as Id<"posSessionItem">),
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
      subtotal: activeTotals.subtotal,
      tax: activeTotals.tax,
      total: activeTotals.total,
      payments,
      hasTerminal: Boolean(terminal),
      isTransactionCompleted,
      completedOrderNumber,
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
    drawerGate,
    closeoutControl,
    authDialog,
    commandApprovalDialog,
    onNavigateBack: handleNavigateBack,
  };
}

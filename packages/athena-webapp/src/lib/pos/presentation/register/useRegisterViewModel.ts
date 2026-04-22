import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useQuery } from "convex/react";
import { toast } from "sonner";

import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";

import type { CustomerInfo, Payment, Product } from "@/components/pos/types";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { useDebounce } from "@/hooks/useDebounce";
import { useGetTerminal } from "@/hooks/useGetTerminal";
import { useNavigateBack } from "@/hooks/use-navigate-back";
import {
  usePOSBarcodeSearch,
  usePOSProductIdSearch,
} from "@/hooks/usePOSProducts";
import {
  bootstrapRegister,
} from "@/lib/pos/application/useCases/bootstrapRegister";
import { addItem as runAddItem } from "@/lib/pos/application/useCases/addItem";
import { completeTransaction as runCompleteTransaction } from "@/lib/pos/application/useCases/completeTransaction";
import { holdSession as runHoldSession } from "@/lib/pos/application/useCases/holdSession";
import { startSession as runStartSession } from "@/lib/pos/application/useCases/startSession";
import {
  calculatePosCartTotals,
  type PosPaymentMethod,
} from "@/lib/pos/domain";
import {
  extractBarcodeFromInput,
  type ExtractResult,
} from "@/lib/pos/barcodeUtils";
import {
  POS_AUTO_ADD_DELAY_MS,
  POS_SEARCH_DEBOUNCE_MS,
} from "@/lib/pos/constants";
import { logger } from "@/lib/logger";
import { useConvexCommandGateway } from "@/lib/pos/infrastructure/convex/commandGateway";
import { useConvexRegisterState } from "@/lib/pos/infrastructure/convex/registerGateway";
import {
  useConvexActiveSession,
  useConvexHeldSessions,
  useConvexSessionActions,
  type PosSessionCustomer,
  type PosSessionDetail,
} from "@/lib/pos/infrastructure/convex/sessionGateway";

import type { RegisterViewModel } from "./registerUiState";
import { EMPTY_REGISTER_CUSTOMER_INFO } from "./registerUiState";
import {
  buildRegisterHeaderState,
  buildRegisterInfoState,
  getCashierDisplayName,
  getRegisterCustomerInfo,
  isRegisterSessionActive,
} from "./selectors";

function hasCustomerDetails(customer: CustomerInfo | undefined | null): boolean {
  if (!customer) {
    return false;
  }

  return Boolean(
    customer.customerId ||
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
    customerId: customer._id,
    name: customer.name,
    email: customer.email ?? "",
    phone: customer.phone ?? "",
  };
}

function createPaymentId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `payment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
}

export function useRegisterViewModel(): RegisterViewModel {
  const { activeStore } = useGetActiveStore();
  const terminal = useGetTerminal();
  const navigateBack = useNavigateBack();
  const [defaultRegisterNumber] = useState("1");
  const [registerNumberOverride, setRegisterNumberOverride] = useState<
    string | undefined
  >(undefined);
  const [cashierId, setCashierId] = useState<Id<"cashier"> | null>(null);
  const [showCustomerPanel, setShowCustomerPanel] = useState(false);
  const [showProductEntry, setShowProductEntry] = useState(true);
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>(
    EMPTY_REGISTER_CUSTOMER_INFO,
  );
  const [payments, setPayments] = useState<Payment[]>([]);
  const [isTransactionCompleted, setIsTransactionCompleted] = useState(false);
  const [completedOrderNumber, setCompletedOrderNumber] = useState<string | null>(
    null,
  );
  const [completedTransactionData, setCompletedTransactionData] =
    useState<RegisterViewModel["checkout"]["completedTransactionData"]>(null);
  const bootstrapInitialized = useRef(false);
  const syncedSessionId = useRef<string | null>(null);
  const paymentsRef = useRef<Payment[]>([]);
  const checkoutStateVersionRef = useRef(0);

  const registerState = useConvexRegisterState({
    storeId: activeStore?._id,
    terminalId: terminal?._id ?? null,
    cashierId,
    registerNumber: registerNumberOverride,
  });
  const bootstrapState = bootstrapRegister({
    registerState,
  });
  const activeSession = useConvexActiveSession({
    storeId: activeStore?._id,
    terminalId: terminal?._id ?? null,
    cashierId,
    registerNumber: registerNumberOverride,
  });
  const activeRegisterNumber =
    activeSession?.registerNumber ??
    registerState?.activeSession?.registerNumber ??
    registerState?.resumableSession?.registerNumber;
  const registerNumber =
    activeRegisterNumber ?? registerNumberOverride ?? defaultRegisterNumber;
  const heldSessions = useConvexHeldSessions({
    storeId: activeStore?._id,
    terminalId: terminal?._id ?? null,
    cashierId,
    limit: 10,
  });
  const cashier = useQuery(
    api.inventory.cashier.getById,
    cashierId ? { id: cashierId } : "skip",
  );

  useEffect(() => {
    if (activeRegisterNumber && activeRegisterNumber !== registerNumberOverride) {
      setRegisterNumberOverride(activeRegisterNumber);
    }
  }, [activeRegisterNumber, registerNumberOverride]);

  const {
    startSession: startSessionCommand,
    addItem: addItemCommand,
    holdSession: holdSessionCommand,
    completeTransaction: completeTransactionCommand,
  } = useConvexCommandGateway();
  const {
    resumeSession,
    voidSession,
    updateSession,
    syncSessionCheckoutState,
    releaseSessionInventoryHoldsAndDeleteItems,
    removeItem,
  } = useConvexSessionActions();

  const activeCartItems = activeSession?.cartItems ?? [];
  const activeTotals = useMemo(
    () => calculatePosCartTotals(activeCartItems),
    [activeCartItems],
  );
  const hasActiveCustomerDetails = hasCustomerDetails(customerInfo);
  const hasActiveCartDraft = activeCartItems.length > 0;
  const setPaymentState = useCallback((nextPayments: Payment[]) => {
    paymentsRef.current = nextPayments;
    setPayments(nextPayments);
  }, []);
  const allocateCheckoutStateVersion = useCallback(() => {
    const nextVersion = Math.max(checkoutStateVersionRef.current + 1, Date.now());
    checkoutStateVersionRef.current = nextVersion;
    return nextVersion;
  }, []);

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
        setCashierId(null);
      }
    },
    [setPaymentState],
  );

  const requestBootstrap = useCallback(() => {
    bootstrapInitialized.current = false;
  }, []);

  const handleSessionExpired = useCallback(() => {
    logger.warn("[POS] Session expired, clearing cashier and local draft state", {
      sessionId: activeSession?._id,
    });
    requestBootstrap();
    syncedSessionId.current = null;
    resetDraftState();
  }, [activeSession?._id, requestBootstrap, resetDraftState]);

  useEffect(() => {
    requestBootstrap();
  }, [
    requestBootstrap,
    activeStore?._id,
    terminal?._id,
    cashierId,
    registerNumberOverride,
  ]);

  useEffect(() => {
    const sessionId = activeSession?._id ?? null;
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
    setCustomerInfo(mapSessionCustomer(activeSession?.customer ?? null));
    setPaymentState(
      (activeSession?.payments ?? []).map((payment) => ({
        id: createPaymentId(),
        method: payment.method as PosPaymentMethod,
        amount: payment.amount,
        timestamp: payment.timestamp,
      })),
    );
    setShowCustomerPanel(Boolean(activeSession?.customer));
    setIsTransactionCompleted(false);
    setCompletedOrderNumber(null);
    setCompletedTransactionData(null);
  }, [
    activeSession?._id,
    activeSession?.customer,
    activeSession?.payments,
    isTransactionCompleted,
    setPaymentState,
  ]);

  useEffect(() => {
    if (isTransactionCompleted || activeCartItems.length > 0 || payments.length === 0) {
      return;
    }

    setPaymentState([]);
  }, [activeCartItems.length, isTransactionCompleted, payments.length, setPaymentState]);

  useEffect(() => {
    if (!activeSession?.expiresAt) {
      return;
    }

    const timeUntilExpiry = activeSession.expiresAt - Date.now();
    if (timeUntilExpiry <= 0) {
      handleSessionExpired();
      return;
    }

    const timeoutId = setTimeout(handleSessionExpired, timeUntilExpiry);
    return () => clearTimeout(timeoutId);
  }, [activeSession?._id, activeSession?.expiresAt, handleSessionExpired]);

  const ensureSessionId = useCallback(async () => {
    if (activeSession?._id) {
      return activeSession._id as Id<"posSession">;
    }

    if (registerState?.activeSession?._id) {
      return registerState.activeSession._id as Id<"posSession">;
    }

    if (!activeStore?._id || !terminal?._id || !cashierId) {
      toast.error("Sign in at a registered terminal before adding products");
      return null;
    }

    const result = await runStartSession({
      gateway: {
        startSession: startSessionCommand,
      },
      command: {
        storeId: activeStore._id,
        terminalId: terminal._id,
        cashierId,
        registerNumber,
      },
    });

    if (!result.ok) {
      toast.error(result.message);
      return null;
    }

    bootstrapInitialized.current = true;
    return result.data.sessionId;
  }, [
    activeSession?._id,
    activeStore?._id,
    cashierId,
    registerNumber,
    registerState?.activeSession?._id,
    startSessionCommand,
    terminal?._id,
  ]);

  const persistSessionMetadata = useCallback(
    async (session: PosSessionDetail | null | undefined) => {
      if (!session?._id || !cashierId) {
        return true;
      }

      try {
        await updateSession({
          sessionId: session._id as Id<"posSession">,
          cashierId,
          customerId: customerInfo.customerId,
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

        return true;
      } catch (error) {
        logger.error(
          "[POS] Failed to update session metadata",
          error instanceof Error ? error : new Error(String(error)),
        );
        toast.error("Failed to save session details");
        return false;
      }
    },
    [activeTotals.subtotal, activeTotals.tax, activeTotals.total, cashierId, customerInfo, updateSession],
  );

  const commitCustomerInfoBestEffort = useCallback(
    async (nextCustomerInfo: CustomerInfo) => {
      if (!activeSession?._id || !cashierId) {
        return;
      }

      try {
        await updateSession({
          sessionId: activeSession._id as Id<"posSession">,
          cashierId,
          customerId: nextCustomerInfo.customerId,
          customerInfo: hasCustomerDetails(nextCustomerInfo)
            ? {
                name: nextCustomerInfo.name || undefined,
                email: nextCustomerInfo.email || undefined,
                phone: nextCustomerInfo.phone || undefined,
              }
            : undefined,
          subtotal: activeTotals.subtotal,
          tax: activeTotals.tax,
          total: activeTotals.total,
        });
      } catch (error) {
        logger.warn("[POS] Failed to sync committed customer details", {
          sessionId: activeSession._id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [
      activeSession?._id,
      activeTotals.subtotal,
      activeTotals.tax,
      activeTotals.total,
      cashierId,
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
      if (!activeSession?._id || !cashierId) {
        return;
      }

      try {
        await syncSessionCheckoutState({
          sessionId: activeSession._id as Id<"posSession">,
          cashierId,
          checkoutStateVersion: args.checkoutStateVersion,
          payments: args.nextPayments.map(({ id, ...payment }) => payment),
          stage: args.stage,
          paymentMethod: args.paymentMethod,
          amount: args.amount,
          previousAmount: args.previousAmount,
        });
      } catch (error) {
        logger.warn("[POS] Failed to sync checkout state", {
          sessionId: activeSession._id,
          stage: args.stage,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [activeSession?._id, cashierId, syncSessionCheckoutState],
  );

  const holdCurrentSession = useCallback(async (reason?: string) => {
    if (!activeSession || !cashierId) {
      toast.error("No active session to hold");
      return false;
    }

    const persisted = await persistSessionMetadata(activeSession);
    if (!persisted) {
      return false;
    }

    const result = await runHoldSession({
      gateway: {
        holdSession: holdSessionCommand,
      },
      command: {
        sessionId: activeSession._id as Id<"posSession">,
        cashierId,
        reason,
      },
    });

    if (!result.ok) {
      toast.error(result.message);
      return false;
    }

    resetDraftState({
      keepCashier: true,
    });
    toast.success("Session held");
    return true;
  }, [
    activeSession,
    cashierId,
    holdSessionCommand,
    persistSessionMetadata,
    resetDraftState,
  ]);

  const voidCurrentSession = useCallback(async () => {
    if (!activeSession) {
      toast.error("No active session to void");
      return false;
    }

    const result = await voidSession({
      sessionId: activeSession._id as Id<"posSession">,
    });

    if (!result.success) {
      toast.error(result.message);
      return false;
    }

    resetDraftState({
      keepCashier: true,
    });
    toast.success("Session voided");
    return true;
  }, [activeSession, resetDraftState, voidSession]);

  const handleResumeSession = useCallback(async (
    sessionId: Id<"posSession">,
  ) => {
    if (!cashierId || !terminal?._id) {
      toast.error("Sign in at a registered terminal before resuming a session");
      return;
    }

    if (activeSession && activeSession._id !== sessionId) {
      const hasDraftState = activeSession.cartItems.length > 0;
      const handled = hasDraftState
        ? await holdCurrentSession("Auto-held before resuming a different session")
        : true;

      if (!handled) {
        return;
      }
    }

    const result = await resumeSession({
      sessionId,
      cashierId,
      terminalId: terminal._id,
    });

    if (!result.success) {
      toast.error(result.message);
      return;
    }

    setPaymentState([]);
    setShowCustomerPanel(false);
    bootstrapInitialized.current = true;
    toast.success("Session resumed");
  }, [
    activeSession,
    cashierId,
    holdCurrentSession,
    resumeSession,
    setPaymentState,
    terminal?._id,
  ]);

  const handleStartNewSession = useCallback(async () => {
    if (!activeStore?._id || !terminal?._id || !cashierId) {
      toast.error("Sign in at a registered terminal before starting a session");
      return;
    }

    if (activeSession) {
      const hasDraftState = activeSession.cartItems.length > 0;
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
        cashierId,
        registerNumber,
      },
    });

    if (!result.ok) {
      toast.error(result.message);
      return;
    }

    resetDraftState({
      keepCashier: true,
    });
    bootstrapInitialized.current = true;
    toast.success("New session created");
  }, [
    activeSession,
    activeStore?._id,
    cashierId,
    customerInfo,
    holdCurrentSession,
    registerNumber,
    resetDraftState,
    startSessionCommand,
    terminal?._id,
  ]);

  useEffect(() => {
    if (
      !activeStore?._id ||
      !terminal?._id ||
      !cashierId ||
      !bootstrapState ||
      isTransactionCompleted ||
      bootstrapInitialized.current
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
          cashierId,
          terminalId: terminal._id,
        });

        if (!result.success) {
          toast.error(result.message);
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
          cashierId,
          registerNumber: registerNumberOverride,
        },
      });

      if (!result.ok) {
        toast.error(result.message);
        bootstrapInitialized.current = false;
      }
    })();
  }, [
    activeStore?._id,
    bootstrapState,
    cashierId,
    isTransactionCompleted,
    registerNumberOverride,
    resumeSession,
    startSessionCommand,
    terminal?._id,
  ]);

  const extractionCacheRef = useRef<ExtractResult | null>(null);
  const rawExtraction = extractBarcodeFromInput(productSearchQuery);
  const shouldReuseCachedProductId =
    rawExtraction.type === "barcode" &&
    extractionCacheRef.current?.type === "productId" &&
    extractionCacheRef.current.value === rawExtraction.value;

  const extractResult = shouldReuseCachedProductId
    ? extractionCacheRef.current!
    : rawExtraction;
  const extractedValue = extractResult.value;

  useEffect(() => {
    if (
      !extractionCacheRef.current ||
      extractionCacheRef.current.type !== extractResult.type ||
      extractionCacheRef.current.value !== extractResult.value
    ) {
      extractionCacheRef.current = extractResult;
    }
  }, [extractResult.type, extractResult.value]);

  const debouncedValue = useDebounce(extractedValue, POS_SEARCH_DEBOUNCE_MS);
  const productIdSearchResults = usePOSProductIdSearch(
    activeStore?._id,
    extractResult.type === "productId" ? debouncedValue : "",
  );
  const barcodeSearchResult = usePOSBarcodeSearch(
    activeStore?._id,
    extractResult.type === "barcode" ? debouncedValue : "",
  );

  const handleAddProduct = useCallback(async (product: Product) => {
    if (!cashierId) {
      toast.error("A cashier must sign in before products can be added");
      return;
    }

    if (!product.productId || !product.skuId) {
      toast.error("Product is missing SKU details");
      return;
    }

    const sessionId = await ensureSessionId();
    if (!sessionId) {
      return;
    }

    const existingItem = activeCartItems.find((item) => item.skuId === product.skuId);
    const nextQuantity = existingItem ? existingItem.quantity + 1 : 1;

    const result = await runAddItem({
      gateway: {
        addItem: addItemCommand,
      },
      command: {
        sessionId,
        cashierId,
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
      toast.error(result.message);
      return;
    }

    setProductSearchQuery("");
  }, [activeCartItems, addItemCommand, cashierId, ensureSessionId]);

  const handleUpdateQuantity = useCallback(async (
    itemId: Id<"posSessionItem">,
    quantity: number,
  ) => {
    if (!activeSession || !cashierId) {
      return;
    }

    const item = activeSession.cartItems.find((candidate) => candidate.id === itemId);
    if (!item) {
      return;
    }

    if (quantity <= 0) {
      const result = await removeItem({
        sessionId: activeSession._id as Id<"posSession">,
        cashierId,
        itemId,
      });

      if (!result.success) {
        toast.error(result.message);
      }

      return;
    }

    if (!item.productId || !item.skuId) {
      toast.error("Item is missing product details");
      return;
    }

    const result = await runAddItem({
      gateway: {
        addItem: addItemCommand,
      },
      command: {
        sessionId: activeSession._id as Id<"posSession">,
        cashierId,
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
      toast.error(result.message);
    }
  }, [activeSession, addItemCommand, cashierId, removeItem]);

  const handleRemoveItem = useCallback(async (
    itemId: Id<"posSessionItem">,
  ) => {
    if (!activeSession || !cashierId) {
      return;
    }

    const result = await removeItem({
      sessionId: activeSession._id as Id<"posSession">,
      cashierId,
      itemId,
    });

    if (!result.success) {
      toast.error(result.message);
    }
  }, [activeSession, cashierId, removeItem]);

  const handleClearCart = useCallback(async () => {
    if (!activeSession) {
      return;
    }

    const result = await releaseSessionInventoryHoldsAndDeleteItems({
      sessionId: activeSession._id as Id<"posSession">,
    });

    if (!result.success) {
      toast.error(result.message);
      return;
    }

    setPaymentState([]);
    toast.success("Cart cleared");
  }, [activeSession, releaseSessionInventoryHoldsAndDeleteItems, setPaymentState]);

  useEffect(() => {
    if (!extractedValue.trim()) {
      return;
    }

    if (
      extractResult.type === "productId" &&
      productIdSearchResults &&
      productIdSearchResults.length === 1 &&
      productIdSearchResults[0].quantityAvailable > 0
    ) {
      const timeoutId = setTimeout(() => {
        void handleAddProduct(productIdSearchResults[0]);
      }, POS_AUTO_ADD_DELAY_MS);

      return () => clearTimeout(timeoutId);
    }

    if (extractResult.type === "barcode" && barcodeSearchResult) {
      const shouldAutoAdd = Array.isArray(barcodeSearchResult)
        ? barcodeSearchResult.length === 1 &&
          (barcodeSearchResult[0]?.quantityAvailable ?? 0) > 0
        : true;

      if (shouldAutoAdd) {
        const timeoutId = setTimeout(() => {
          const result = Array.isArray(barcodeSearchResult)
            ? barcodeSearchResult[0]
            : barcodeSearchResult;

          if (result) {
            void handleAddProduct(result);
          }
        }, POS_AUTO_ADD_DELAY_MS);

        return () => clearTimeout(timeoutId);
      }
    }
  }, [
    barcodeSearchResult,
    extractResult.type,
    extractedValue,
    handleAddProduct,
    productIdSearchResults,
  ]);

  const handleBarcodeSubmit = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    if (!productSearchQuery.trim()) {
      return;
    }

    if (extractResult.type === "productId" && productIdSearchResults) {
      if (productIdSearchResults.length === 1) {
        await handleAddProduct(productIdSearchResults[0]);
      }
      return;
    }

    if (extractResult.type === "barcode" && barcodeSearchResult) {
      const resolvedProduct = Array.isArray(barcodeSearchResult)
        ? barcodeSearchResult.length === 1
          ? barcodeSearchResult[0]
          : null
        : barcodeSearchResult;

      if (resolvedProduct) {
        await handleAddProduct(resolvedProduct);
        return;
      }
    }

    if (extractResult.type === "barcode") {
      logger.warn("[POS] Barcode not found", {
        barcode: extractedValue,
        storeId: activeStore?._id,
      });
      toast.error("Barcode not found");
    }
  }, [
    activeStore?._id,
    barcodeSearchResult,
    extractResult.type,
    extractedValue,
    handleAddProduct,
    productIdSearchResults,
    productSearchQuery,
  ]);

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

  const handleCashierAuthenticated = useCallback((nextCashierId: Id<"cashier">) => {
    setCashierId(nextCashierId);
    requestBootstrap();
  }, [requestBootstrap]);

  const handleNavigateBack = useCallback(async () => {
    if (activeSession) {
      const hasDraftState = activeSession.cartItems.length > 0;

      const handled = hasDraftState
        ? await holdCurrentSession("Navigating away from register")
        : true;

      if (!handled) {
        return;
      }
    }

    resetDraftState();
    navigateBack();
  }, [
    activeSession,
    customerInfo,
    holdCurrentSession,
    navigateBack,
    resetDraftState,
  ]);

  const handleCashierSignOut = useCallback(async () => {
    if (activeSession) {
      const hasDraftState = activeSession.cartItems.length > 0;

      const handled = hasDraftState
        ? await holdCurrentSession("Signing out")
        : await voidCurrentSession();

      if (!handled) {
        return;
      }
    }

    resetDraftState();
  }, [
    activeSession,
    customerInfo,
    holdCurrentSession,
    resetDraftState,
    voidCurrentSession,
  ]);

  const handleCompleteTransaction = useCallback(async () => {
    if (!activeSession) {
      toast.error("No active session to complete");
      return false;
    }

    const currentPayments = paymentsRef.current;

    const persisted = await persistSessionMetadata(activeSession);
    if (!persisted) {
      return false;
    }

    const result = await runCompleteTransaction({
      gateway: {
        completeTransaction: completeTransactionCommand,
      },
      command: {
        sessionId: activeSession._id as Id<"posSession">,
        payments: currentPayments.map((payment) => ({
          method: payment.method,
          amount: payment.amount,
          timestamp: payment.timestamp,
        })),
        notes: `Register: ${registerNumber}`,
        subtotal: activeTotals.subtotal,
        tax: activeTotals.tax,
        total: activeTotals.total,
      },
    });

    if (!result.ok) {
      toast.error(result.message);
      return false;
    }

    setIsTransactionCompleted(true);
    setCompletedOrderNumber(result.data.transactionNumber);
    setCompletedTransactionData({
      paymentMethod: currentPayments[0]?.method ?? "cash",
      payments: [...currentPayments],
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
    toast.success(`Transaction completed: ${result.data.transactionNumber}`);
    return true;
  }, [
    activeCartItems,
    activeSession,
    activeTotals.subtotal,
    activeTotals.tax,
    activeTotals.total,
    completeTransactionCommand,
    customerInfo,
    persistSessionMetadata,
    registerNumber,
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
      const nextPayments = [...currentPayments, nextPayment];
      setPaymentState(nextPayments);
      void syncCheckoutStateBestEffort({
        checkoutStateVersion,
        nextPayments,
        stage: "paymentAdded",
        paymentMethod: method,
        amount,
      });
    },
    [allocateCheckoutStateVersion, setPaymentState, syncCheckoutStateBestEffort],
  );

  const handleUpdatePayment = useCallback((paymentId: string, amount: number) => {
    const currentPayments = paymentsRef.current;
    const checkoutStateVersion = allocateCheckoutStateVersion();
    const previousPayment = currentPayments.find((payment) => payment.id === paymentId);
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
  }, [allocateCheckoutStateVersion, setPaymentState, syncCheckoutStateBestEffort]);

  const handleRemovePayment = useCallback((paymentId: string) => {
    const currentPayments = paymentsRef.current;
    const checkoutStateVersion = allocateCheckoutStateVersion();
    const removedPayment = currentPayments.find((payment) => payment.id === paymentId);
    const nextPayments = currentPayments.filter((payment) => payment.id !== paymentId);
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
  }, [allocateCheckoutStateVersion, setPaymentState, syncCheckoutStateBestEffort]);

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
  }, [allocateCheckoutStateVersion, setPaymentState, syncCheckoutStateBestEffort]);

  const header = useMemo(
    () =>
      buildRegisterHeaderState({
        isSessionActive: isRegisterSessionActive(activeSession),
      }),
    [activeSession],
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

  const sessionPanel =
    activeStore?._id && terminal?._id && cashierId
      ? {
          activeSessionNumber: activeSession?.sessionNumber ?? null,
          hasExpiredSession: Boolean(
            activeSession?.expiresAt && activeSession.expiresAt < Date.now(),
          ),
          canHoldSession: Boolean(activeSession) && hasActiveCartDraft,
          disableNewSession: Boolean(activeSession?.status === "active"),
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
            if (!result.success) {
              toast.error(result.message);
              return;
            }

            toast.success("Held session voided");
          },
          onStartNewSession: handleStartNewSession,
        }
      : null;

  const cashierCard =
    activeStore?._id && terminal?._id && cashierId
      ? {
          cashierName: getCashierDisplayName(cashier),
          onSignOut: handleCashierSignOut,
        }
      : null;

  const authDialog =
    activeStore?._id && terminal?._id
      ? {
          open: !cashierId,
          storeId: activeStore._id,
          terminalId: terminal._id,
          onAuthenticated: handleCashierAuthenticated,
          onDismiss: handleNavigateBack,
        }
      : null;

  return {
    hasActiveStore: Boolean(activeStore),
    header,
    registerInfo,
    customerPanel: {
      isOpen: showCustomerPanel,
      onOpenChange: setShowCustomerPanel,
      customerInfo: getRegisterCustomerInfo(customerInfo),
      onCustomerCommitted: commitCustomerInfoBestEffort,
      setCustomerInfo,
    },
    productEntry: {
      disabled: !terminal || !cashierId,
      showProductLookup: showProductEntry,
      setShowProductLookup: setShowProductEntry,
      productSearchQuery,
      setProductSearchQuery,
      onBarcodeSubmit: handleBarcodeSubmit,
      onAddProduct: handleAddProduct,
      barcodeSearchResult,
      productIdSearchResults: productIdSearchResults ?? null,
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
      onAddPayment: handleAddPayment,
      onUpdatePayment: handleUpdatePayment,
      onRemovePayment: handleRemovePayment,
      onClearPayments: handleClearPayments,
      onCompleteTransaction: handleCompleteTransaction,
      onStartNewTransaction: handleStartNewTransaction,
    },
    sessionPanel,
    cashierCard,
    authDialog,
    onNavigateBack: handleNavigateBack,
  };
}

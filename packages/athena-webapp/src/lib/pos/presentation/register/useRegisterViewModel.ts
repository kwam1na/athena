import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useParams } from "@tanstack/react-router";
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
import { holdSession as runHoldSession } from "@/lib/pos/application/useCases/holdSession";
import {
  calculatePosCartTotals,
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
import {
  createIndexedDbPosLocalStorageAdapter,
  createPosLocalStore,
} from "@/lib/pos/infrastructure/local/posLocalStore";
import { createLocalCommandGateway } from "@/lib/pos/infrastructure/local/localCommandGateway";
import {
  type PosLocalCartItemReadModel,
  type PosLocalRegisterReadModel,
} from "@/lib/pos/infrastructure/local/registerReadModel";
import { readProjectedLocalRegisterModel } from "@/lib/pos/infrastructure/local/localRegisterReader";
import { usePosLocalSyncRuntimeStatus } from "@/lib/pos/infrastructure/local/usePosLocalSyncRuntime";
import { useLocalPosEntryContext } from "@/lib/pos/infrastructure/local/localPosEntryContext";
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
  type RegisterCatalogSearchResult,
} from "./catalogSearch";
import {
  mapCatalogRowToProduct,
  normalizeExactInput,
  POS_AVAILABILITY_NOT_READY_MESSAGE,
  POS_NO_TRUSTED_AVAILABILITY_REMAINING_MESSAGE,
  type RegisterCatalogAvailability,
} from "./catalogSearchPresentation";
import { useRegisterCatalogIndex } from "./useRegisterCatalogIndex";
import {
  buildPosSyncStatusPresentation,
  type PosReconciliationItem,
} from "@/lib/pos/presentation/syncStatusPresentation";

type LocalSyncStatusSource = {
  description?: string | null;
  label?: string | null;
  onRetrySync?: (() => void) | null;
  pendingEventCount?: number | null;
  reconciliationItems?: PosReconciliationItem[] | null;
  status?: string | null;
};

type LocalSyncRecord = {
  localSyncStatus?: LocalSyncStatusSource | null;
  syncStatus?: LocalSyncStatusSource | string | null;
};

type LocalAuthenticatedStaff = {
  activeRoles: string[];
  displayName: string;
} | null;

function readStaffProofFromAuthResult(
  result: StaffAuthenticationResult,
): string | null {
  const proof = (result as { posLocalStaffProof?: unknown }).posLocalStaffProof;
  if (!proof || typeof proof !== "object") {
    return null;
  }

  const { expiresAt, token } = proof as {
    expiresAt?: unknown;
    token?: unknown;
  };
  if (typeof expiresAt !== "number" || typeof token !== "string") {
    return null;
  }

  return token;
}

function getStaffDisplayNameFromAuthResult(result: StaffAuthenticationResult) {
  return (
    result.staffProfile.fullName ||
    [result.staffProfile.firstName, result.staffProfile.lastName]
      .filter(Boolean)
      .join(" ")
  );
}

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
      combinedPayments.push({ ...payment });
      return combinedPayments;
    }

    combinedPayments[combinedPayments.indexOf(existingPayment)] = {
      ...existingPayment,
      amount: existingPayment.amount + payment.amount,
      timestamp: Math.max(existingPayment.timestamp, payment.timestamp),
    };
    return combinedPayments;
  }, []);
}

function createPaymentId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `payment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
}

function isPosPaymentMethod(method: string): method is PosPaymentMethod {
  return method === "cash" || method === "card" || method === "mobile_money";
}

function mapLocalPaymentToPayment(payment: {
  amount: number;
  id?: string;
  method: Payment["method"] | string;
  timestamp: number;
}): Payment {
  const method = isPosPaymentMethod(payment.method) ? payment.method : "cash";

  return {
    id: payment.id ?? createPaymentId(),
    method,
    amount: payment.amount,
    timestamp: payment.timestamp,
  };
}

function createLocalFallbackId(prefix: string): string {
  const uniqueId =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${uniqueId}`;
}

function getCloseoutLocalRegisterSessionId(
  session:
    | { _id?: Id<"registerSession"> | string; localRegisterSessionId?: string }
    | null
    | undefined,
): string | undefined {
  return session?.localRegisterSessionId ?? session?._id?.toString();
}

function getCloseoutCloudRegisterSessionId(
  session:
    | { _id?: Id<"registerSession"> | string; localRegisterSessionId?: string }
    | null
    | undefined,
): Id<"registerSession"> | undefined {
  return session?.localRegisterSessionId
    ? undefined
    : (session?._id as Id<"registerSession"> | undefined);
}

function trimOptional(value: string): string | undefined {
  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

function presentOperatorError(message: string): void {
  toast.error(toOperatorMessage(message));
}

function readLocalSyncStatus(
  ...sources: Array<unknown>
): LocalSyncStatusSource | null {
  for (const source of sources) {
    if (!source || typeof source !== "object") {
      continue;
    }

    const record = source as LocalSyncRecord;
    if (record.localSyncStatus && typeof record.localSyncStatus === "object") {
      return record.localSyncStatus;
    }

    if (typeof record.syncStatus === "string") {
      return { status: record.syncStatus };
    }

    if (record.syncStatus && typeof record.syncStatus === "object") {
      return record.syncStatus;
    }
  }

  return null;
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

function buildLocalCartItemPayload(input: {
  localItemId: string;
  product: Product;
  quantity: number;
}) {
  const { localItemId, product, quantity } = input;
  return {
    localItemId,
    productId: product.productId,
    productSkuId: product.skuId,
    productSku: product.sku || "",
    barcode: product.barcode || null,
    productName: product.name,
    price: product.price,
    quantity,
    quantityAvailable: product.quantityAvailable,
    image: product.image || null,
    size: product.size || null,
    length: product.length || null,
    color: product.color || null,
    areProcessingFeesAbsorbed: product.areProcessingFeesAbsorbed,
  };
}

function buildLocalCartItemPayloadFromCartItem(input: {
  item: CartItem;
  localItemId: string;
  quantity: number;
}) {
  const { item, localItemId, quantity } = input;
  return {
    localItemId,
    productId: item.productId,
    productSkuId: item.skuId,
    productSku: item.sku || "",
    barcode: item.barcode || null,
    productName: item.name,
    price: item.price,
    quantity,
    image: item.image || null,
    size: item.size || null,
    length: item.length || null,
    color: item.color || null,
    areProcessingFeesAbsorbed: item.areProcessingFeesAbsorbed,
  };
}

function getProductAvailabilityStatus(product: Product) {
  if (product.availabilityStatus) {
    return product.availabilityStatus;
  }

  if (typeof product.quantityAvailable === "number") {
    return product.inStock && product.quantityAvailable > 0
      ? "available"
      : "out_of_stock";
  }

  return product.inStock ? "available" : "unknown";
}

function buildCompletedSalePayload(input: {
  cartItems: CartItem[];
  customerInfo: CustomerInfo;
  localPosSessionId: string;
  localTransactionId: string;
  payments: Payment[];
  receiptNumber: string;
  totals: { subtotal: number; tax: number; total: number };
}) {
  const customer = hasCustomerDetails(input.customerInfo)
    ? input.customerInfo
    : null;

  return {
    localPosSessionId: input.localPosSessionId,
    localTransactionId: input.localTransactionId,
    receiptNumber: input.receiptNumber,
    customerProfileId: customer?.customerProfileId,
    customerName: customer?.name || undefined,
    customerEmail: customer?.email || undefined,
    customerPhone: customer?.phone || undefined,
    subtotal: input.totals.subtotal,
    tax: input.totals.tax,
    total: input.totals.total,
    items: input.cartItems.map((item) => ({
      localItemId: item.id.toString(),
      productId: item.productId,
      productSkuId: item.skuId,
      productSku: item.sku || "",
      barcode: item.barcode || null,
      productName: item.name,
      price: item.price,
      quantity: item.quantity,
      image: item.image || null,
    })),
    payments: input.payments.map((payment) => ({
      localPaymentId: payment.id,
      method: payment.method,
      amount: payment.amount,
      timestamp: payment.timestamp,
    })),
  };
}

function mapLocalCartItemToCartItem(item: PosLocalCartItemReadModel): CartItem {
  return {
    id: item.localItemId as Id<"posSessionItem">,
    name: item.productName,
    barcode: item.barcode || "",
    sku: item.productSku,
    price: item.price,
    quantity: item.quantity,
    image: item.image,
    size: item.size,
    length: item.length,
    color: item.color,
    productId: item.productId as Id<"product">,
    skuId: item.productSkuId as Id<"productSku">,
    areProcessingFeesAbsorbed: item.areProcessingFeesAbsorbed,
  };
}

function recordFromPayload(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : {};
}

function stringFromPayload(
  payload: Record<string, unknown>,
  field: string,
): string {
  const value = payload[field];
  return typeof value === "string" ? value : "";
}

function cartItemSkuEntry(item: CartItem): readonly [string, CartItem][] {
  const skuId = item.skuId;
  return skuId ? [[skuId.toString(), item]] : [];
}

function addLocalAvailabilityConsumption(
  quantities: Map<string, number>,
  item: PosLocalCartItemReadModel,
) {
  if (!item.productSkuId) return;

  quantities.set(
    item.productSkuId,
    (quantities.get(item.productSkuId) ?? 0) + item.quantity,
  );
}

function localPosSessionIdFromEvent(event: {
  localPosSessionId?: string;
  payload: unknown;
}) {
  return (
    event.localPosSessionId ||
    stringFromPayload(recordFromPayload(event.payload), "localPosSessionId")
  );
}

type LocalAvailabilityEventIndexEntry = {
  hasUnsyncedEvents: boolean;
  syncedCartQuantityBySku: Map<string, number>;
};

function buildLocalAvailabilityEventIndex(model: PosLocalRegisterReadModel) {
  const index = new Map<string, LocalAvailabilityEventIndexEntry>();
  const lastSyncedSequence = model.syncStatus.lastSyncedSequence;

  for (const event of model.sourceEvents) {
    const localPosSessionId = localPosSessionIdFromEvent(event);
    if (!localPosSessionId) {
      continue;
    }

    const entry = index.get(localPosSessionId) ?? {
      hasUnsyncedEvents: false,
      syncedCartQuantityBySku: new Map<string, number>(),
    };
    index.set(localPosSessionId, entry);

    if (event.sequence > lastSyncedSequence) {
      entry.hasUnsyncedEvents = true;
      continue;
    }

    if (event.type !== "cart.item_added") {
      continue;
    }

    const payload = recordFromPayload(event.payload);
    const productSkuId = stringFromPayload(payload, "productSkuId");
    const quantity = payload.quantity;
    if (!productSkuId || typeof quantity !== "number") {
      continue;
    }

    entry.syncedCartQuantityBySku.set(productSkuId, Math.max(0, quantity));
  }

  return index;
}

function addLocalAvailabilityDeltaConsumption(input: {
  quantities: Map<string, number>;
  items: PosLocalCartItemReadModel[];
  syncedCartQuantityBySku: Map<string, number>;
}) {
  for (const item of input.items) {
    if (!item.productSkuId) continue;

    const unsyncedQuantity = Math.max(
      0,
      item.quantity - (input.syncedCartQuantityBySku.get(item.productSkuId) ?? 0),
    );
    if (unsyncedQuantity <= 0) continue;

    input.quantities.set(
      item.productSkuId,
      (input.quantities.get(item.productSkuId) ?? 0) + unsyncedQuantity,
    );
  }
}

function localAvailabilityConsumptionFromReadModel(
  model: PosLocalRegisterReadModel | null,
) {
  const quantities = new Map<string, number>();
  if (!model) return quantities;

  const eventIndex = buildLocalAvailabilityEventIndex(model);

  if (model.activeSale) {
    const saleEventIndex = eventIndex.get(model.activeSale.localPosSessionId);
    const hasUnsyncedSaleEvents = Boolean(saleEventIndex?.hasUnsyncedEvents);

    if (!model.activeSale.cloudPosSessionId) {
      for (const item of model.activeSale.items) {
        addLocalAvailabilityConsumption(quantities, item);
      }
    } else if (hasUnsyncedSaleEvents) {
      addLocalAvailabilityDeltaConsumption({
        quantities,
        items: model.activeSale.items,
        syncedCartQuantityBySku:
          saleEventIndex?.syncedCartQuantityBySku ?? new Map<string, number>(),
      });
    }
  }

  for (const sale of model.completedSales) {
    const saleEventIndex = eventIndex.get(sale.localPosSessionId);
    const hasUnsyncedSaleEvents = Boolean(saleEventIndex?.hasUnsyncedEvents);

    if (sale.cloudTransactionId) {
      if (!hasUnsyncedSaleEvents) continue;

      addLocalAvailabilityDeltaConsumption({
        quantities,
        items: sale.items,
        syncedCartQuantityBySku:
          saleEventIndex?.syncedCartQuantityBySku ?? new Map<string, number>(),
      });
    } else {
      for (const item of sale.items) {
        addLocalAvailabilityConsumption(quantities, item);
      }
    }
  }

  return quantities;
}

function cartItemsFromLocalRegisterModel(
  model: PosLocalRegisterReadModel | null,
  localPosSessionId: string,
  currentCartItems: CartItem[],
) {
  const sale =
    model?.activeSale?.localPosSessionId === localPosSessionId
      ? model.activeSale
      : null;
  if (!model || !sale) return null;

  const localItems = sale.items.map(mapLocalCartItemToCartItem);
  const localItemsBySku = new Map(localItems.flatMap(cartItemSkuEntry));
  const removedProductSkuIds = new Set<string>();
  const removedLocalItemIds = new Set<string>();

  for (const event of model.sourceEvents) {
    if (event.type !== "cart.item_added") continue;
    const payload = recordFromPayload(event.payload);
    const eventLocalPosSessionId =
      event.localPosSessionId || stringFromPayload(payload, "localPosSessionId");
    if (eventLocalPosSessionId !== localPosSessionId) continue;

    const productSkuId = stringFromPayload(payload, "productSkuId");
    const localItemId = stringFromPayload(payload, "localItemId");
    const quantity = payload.quantity;
    if ((!productSkuId && !localItemId) || typeof quantity !== "number") {
      continue;
    }

    if (quantity <= 0 && !localItemsBySku.has(productSkuId)) {
      if (productSkuId) removedProductSkuIds.add(productSkuId);
      if (localItemId) removedLocalItemIds.add(localItemId);
    } else {
      removedProductSkuIds.delete(productSkuId);
      removedLocalItemIds.delete(localItemId);
    }
  }

  const mergedItemsBySku = new Map(
    currentCartItems.flatMap((item) => {
      const skuId = item.skuId;
      if (!skuId) return [];
      if (removedProductSkuIds.has(skuId.toString())) return [];
      if (removedLocalItemIds.has(item.id.toString())) return [];
      return cartItemSkuEntry(item);
    }),
  );
  for (const [skuId, item] of localItemsBySku) {
    mergedItemsBySku.set(skuId, item);
  }

  return Array.from(mergedItemsBySku.values());
}

function totalsFromCartItems(cartItems: CartItem[]) {
  const subtotal = cartItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  return { subtotal, tax: 0, total: subtotal };
}

function mergeCartItemsBySku(
  baseItems: CartItem[],
  overlayItems: CartItem[],
): CartItem[] {
  const mergedItemsBySku = new Map(
    baseItems.flatMap(cartItemSkuEntry),
  );

  for (const item of overlayItems) {
    const skuId = item.skuId;
    if (!skuId) continue;
    mergedItemsBySku.set(skuId.toString(), item);
  }

  return Array.from(mergedItemsBySku.values());
}

function completedCustomerInfo(customerInfo: CustomerInfo) {
  return hasCustomerDetails(customerInfo)
    ? {
        name: customerInfo.name,
        email: customerInfo.email,
        phone: customerInfo.phone,
      }
    : undefined;
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

type LocalOperableRegisterSession = {
  expectedCash: number;
  localRegisterSessionId: string;
  openedAt: number;
  openingFloat: number;
  registerNumber: string;
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
};

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
  const activeStoreCurrency = activeStore?.currency ?? "GHS";
  const navigateBack = useNavigateBack();
  const [staffProfileId, setStaffProfileId] =
    useState<Id<"staffProfile"> | null>(null);
  const [staffProofToken, setStaffProofToken] = useState<string | null>(null);
  const [localAuthenticatedStaff, setLocalAuthenticatedStaff] =
    useState<LocalAuthenticatedStaff>(null);
  const terminalRegisterNumber = terminal?.registerNumber
    ? trimOptional(terminal.registerNumber)
    : undefined;
  const [localStaffAuthorityStatus, setLocalStaffAuthorityStatus] =
    useState("unknown");
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
  const locallyCompletedSessionIdsRef = useRef<Set<string>>(new Set());
  const paymentsRef = useRef<Payment[]>([]);
  const checkoutMutationLockedRef = useRef(false);
  const cartMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const paymentMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
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
  const [localOperableRegisterSession, setLocalOperableRegisterSession] =
    useState<LocalOperableRegisterSession | null>(null);
  const [localOperablePosSession, setLocalOperablePosSession] =
    useState<LocalOperablePosSession | null>(null);
  const [localRegisterReadModel, setLocalRegisterReadModel] =
    useState<PosLocalRegisterReadModel | null>(null);
  const [localRegisterReadModelVersion, setLocalRegisterReadModelVersion] =
    useState(0);

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
  const registerAvailabilityProductSkuIds = useMemo(
    () =>
      registerMetadataSearchState.results.map(
        (row) => row.productSkuId as Id<"productSku">,
      ),
    [registerMetadataSearchState.results],
  );
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
    activeSessionIdRef.current = activeSession?._id
      ? (activeSession._id as Id<"posSession">)
      : null;
  }, [activeSession?._id]);
  const usableActiveRegisterSession =
    registerState?.activeRegisterSession &&
    isPosUsableRegisterSessionStatus(registerState.activeRegisterSession.status)
      ? registerState.activeRegisterSession
      : null;
  const projectedLocalRegisterSession =
    localRegisterReadModel?.activeRegisterSession &&
    activeStoreId &&
    terminal?._id &&
    isPosUsableRegisterSessionStatus(
      localRegisterReadModel.activeRegisterSession.status,
    )
      ? {
          expectedCash: localRegisterReadModel.activeRegisterSession.expectedCash,
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
  const projectedLocalCloseoutBlockedRegisterSession =
    localRegisterReadModel?.activeRegisterSession?.status === "closing" &&
    activeStoreId &&
    terminal?._id
      ? {
          localRegisterSessionId:
            localRegisterReadModel.activeRegisterSession.localRegisterSessionId,
          status: "closing" as const,
          terminalId: terminal._id,
          registerNumber:
            localRegisterReadModel.activeRegisterSession.registerNumber ?? "",
          openingFloat:
            localRegisterReadModel.activeRegisterSession.openingFloat,
          expectedCash:
            localRegisterReadModel.activeRegisterSession.expectedCash,
          countedCash: localRegisterReadModel.activeRegisterSession.countedCash,
          managerApprovalRequestId: undefined,
          openedAt: localRegisterReadModel.activeRegisterSession.openedAt,
          variance:
            localRegisterReadModel.activeRegisterSession.countedCash === undefined
              ? undefined
              : localRegisterReadModel.activeRegisterSession.countedCash -
                localRegisterReadModel.activeRegisterSession.expectedCash,
          localSyncStatus: {
            status:
              localRegisterReadModel.syncStatus.state === "needs_review" ||
              localRegisterReadModel.syncStatus.state === "failed"
                ? "needs_review"
                : "locally_closed_pending_sync",
            pendingEventCount:
              localRegisterReadModel.syncStatus.pendingCount +
              localRegisterReadModel.syncStatus.failedCount,
          },
        }
      : null;
  const locallyOperableRegisterSession =
    localOperableRegisterSession &&
    activeStoreId === localOperableRegisterSession.storeId &&
    terminal?._id === localOperableRegisterSession.terminalId
      ? localOperableRegisterSession
      : projectedLocalRegisterSession;
  const closeoutBlockedRegisterSession =
    registerState?.activeRegisterSession?.status === "closing"
      ? registerState.activeRegisterSession
      : projectedLocalCloseoutBlockedRegisterSession;
  const activeRegisterNumber =
    activeSession?.registerNumber ??
    usableActiveRegisterSession?.registerNumber ??
    closeoutBlockedRegisterSession?.registerNumber ??
    registerState?.activeSession?.registerNumber ??
    registerState?.resumableSession?.registerNumber;
  const activeRegisterSessionId = usableActiveRegisterSession?._id as
    | Id<"registerSession">
    | undefined;
  const cloudRegisterSessionId = activeRegisterSessionId?.toString();
  const localEventRegisterSessionId =
    locallyOperableRegisterSession?.localRegisterSessionId ??
    projectedLocalRegisterSession?.localRegisterSessionId ??
    cloudRegisterSessionId;
  const registerNumber = activeRegisterNumber ?? terminalRegisterNumber ?? "";
  const heldSessions = useConvexHeldSessions({
    storeId: activeStoreId,
    terminalId: terminal?._id ?? null,
    staffProfileId,
    limit: 10,
  });
  const cashier = registerState?.cashier ?? null;
  const isCashierManager = Boolean(
    cashier?.activeRoles?.includes("manager") ||
      localAuthenticatedStaff?.activeRoles.includes("manager"),
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
  const correctRegisterSessionOpeningFloat = useMutation(
    api.cashControls.closeouts.correctRegisterSessionOpeningFloat,
  );
  const {
    resumeSession,
    bindSessionToRegisterSession,
    voidSession,
    updateSession,
  } = useConvexSessionActions();
  const voidSessionRef = useRef<typeof voidSession>(voidSession);
  const localStore = useMemo(
    () =>
      createPosLocalStore({
        adapter: createIndexedDbPosLocalStorageAdapter(),
      }),
    [],
  );
  const localCommandGateway = useMemo(
    () =>
      createLocalCommandGateway({
        allowExplicitRegisterSessionWithoutProjection: true,
        store: localStore,
        createLocalId: (kind) => {
          if (kind === "local-register-session" && terminal?._id) {
            return createLocalFallbackId(`local-register-${terminal._id}`);
          }
          return createLocalFallbackId(kind);
        },
        staffProofToken: (requestedStaffProfileId) =>
          requestedStaffProfileId === staffProfileId
            ? (staffProofToken ?? undefined)
            : undefined,
      }),
    [localStore, staffProfileId, staffProofToken, terminal?._id],
  );
  useEffect(() => {
    if (!staffProfileId || !staffProofToken) {
      return;
    }

    void localStore.attachStaffProofTokenToPendingEvents({
      staffProfileId,
      staffProofToken,
    });
  }, [localStore, staffProfileId, staffProofToken]);
  useEffect(() => {
    let cancelled = false;

    async function refreshLocalStaffAuthorityStatus() {
      if (!activeStoreId || !terminal?._id || typeof indexedDB === "undefined") {
        setLocalStaffAuthorityStatus("unavailable");
        return;
      }

      try {
        const result = await localStore.getStaffAuthorityReadiness({
          storeId: activeStoreId,
          terminalId: terminal._id,
        });
        if (!cancelled) {
          setLocalStaffAuthorityStatus(
            result.ok ? result.value : "unavailable",
          );
        }
      } catch {
        if (!cancelled) {
          setLocalStaffAuthorityStatus("unavailable");
        }
      }
    }

    void refreshLocalStaffAuthorityStatus();

    return () => {
      cancelled = true;
    };
  }, [activeStoreId, localStore, terminal?._id, staffProfileId]);
  const hasProvisionedLocalSyncSeed = useCallback(async () => {
    if (!activeStoreId || !terminal?._id || typeof indexedDB === "undefined") {
      return false;
    }

    const result = await createPosLocalStore({
      adapter: createIndexedDbPosLocalStorageAdapter(),
    }).readProvisionedTerminalSeed();

    return Boolean(
      result.ok &&
        result.value &&
        result.value.storeId === activeStoreId! &&
        result.value.cloudTerminalId === terminal._id &&
        result.value.syncSecretHash,
    );
  }, [activeStoreId, terminal?._id]);
  const readCurrentLocalRegisterModel = useCallback(async () => {
    if (!activeStoreId || !terminal?._id || typeof indexedDB === "undefined") {
      return null;
    }

    const store = createPosLocalStore({
      adapter: createIndexedDbPosLocalStorageAdapter(),
    });
    if (
      typeof store.listEvents !== "function" ||
      typeof store.readProvisionedTerminalSeed !== "function"
    ) {
      return null;
    }

    const model = await readProjectedLocalRegisterModel({
      store,
      storeId: activeStoreId!,
      terminal,
      isOnline: globalThis.navigator?.onLine ?? false,
    });
    return model.ok ? model.value : null;
  }, [activeStoreId, terminal]);

  const refreshLocalRegisterReadModel = useCallback(async () => {
    const model = await readCurrentLocalRegisterModel();
    setLocalRegisterReadModel(model);
  }, [readCurrentLocalRegisterModel]);

  useEffect(() => {
    void refreshLocalRegisterReadModel();
  }, [localRegisterReadModelVersion, refreshLocalRegisterReadModel]);

  const noteLocalRegisterEventChanged = useCallback(() => {
    setLocalRegisterReadModelVersion((current) => current + 1);
  }, []);

  const enqueueCartMutation = useCallback(
    (mutation: () => Promise<boolean | void>) => {
      if (checkoutMutationLockedRef.current) {
        toast.error("Finish the current checkout update before changing the sale.");
        return Promise.resolve(false);
      }

      const queued = cartMutationQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          const result = await mutation();
          return result !== false;
        });
      cartMutationQueueRef.current = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    },
    [],
  );

  const waitForCheckoutMutationQueues = useCallback(async () => {
    await cartMutationQueueRef.current.catch(() => undefined);
    await paymentMutationQueueRef.current.catch(() => undefined);
  }, []);

  const localActiveSession = useMemo<LocalOperableActiveSession | null>(() => {
    if (localRegisterReadModel?.activeSale) {
      const sale = localRegisterReadModel.activeSale;
      if (locallyCompletedSessionIdsRef.current.has(sale.localPosSessionId)) {
        return null;
      }

      return {
        _id: sale.localPosSessionId,
        _creationTime: sale.startedAt,
        storeId: activeStoreId as Id<"store">,
        terminalId: sale.terminalId,
        staffProfileId: (sale.staffProfileId as Id<"staffProfile">) ?? undefined,
        status: "active",
        createdAt: sale.startedAt,
        expiresAt: Number.MAX_SAFE_INTEGER,
        sessionNumber: "Local sale",
        sessionSource: "local",
        updatedAt: sale.updatedAt,
        registerNumber: sale.registerNumber,
        localRegisterSessionId: sale.localRegisterSessionId,
        cartItems: sale.items.map(mapLocalCartItemToCartItem),
        payments: sale.payments.map(mapLocalPaymentToPayment),
        customer: null,
        localSyncStatus: {
          status: "pending_sync",
          pendingEventCount: localRegisterReadModel.syncStatus.pendingCount,
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
    localOperablePosSession,
    localRegisterReadModel,
    locallyOperableRegisterSession,
    staffProfileId,
  ]);
  const visibleActiveSession = asCloudOperableSession(
    activeSession &&
    !locallyCompletedSessionIdsRef.current.has(activeSession._id.toString()) &&
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
  const localAvailabilityConsumptionBySkuId = useMemo(() => {
    const quantities =
      localAvailabilityConsumptionFromReadModel(localRegisterReadModel);

    for (const product of Object.values(optimisticCartProducts)) {
      if (!product.skuId) continue;

      quantities.set(
        product.skuId,
        (quantities.get(product.skuId) ?? 0) + product.quantity,
      );
    }

    return quantities;
  }, [localRegisterReadModel, optimisticCartProducts]);
  const localRegisterCatalogAvailabilityBySkuId = useMemo(() => {
    const adjusted = new Map<string, RegisterCatalogAvailability>();

    for (const [productSkuId, availability] of registerCatalogAvailabilityBySkuId) {
      const quantityAvailable = Math.max(
        0,
        Math.trunc(availability.quantityAvailable) -
          (localAvailabilityConsumptionBySkuId.get(productSkuId) ?? 0),
      );

      adjusted.set(productSkuId, {
        ...availability,
        inStock: availability.inStock && quantityAvailable > 0,
        quantityAvailable,
      });
    }

    return adjusted;
  }, [localAvailabilityConsumptionBySkuId, registerCatalogAvailabilityBySkuId]);
  const registerSearchState = useMemo<RegisterCatalogSearchResult>(() => {
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
          exactAvailability.quantityAvailable > 0,
      ),
    };
  }, [localRegisterCatalogAvailabilityBySkuId, registerMetadataSearchState]);
  const registerSearchProducts = useMemo(
    () =>
      registerSearchState.results.map((row) =>
        mapCatalogRowToProduct(
          row,
          localRegisterCatalogAvailabilityBySkuId.get(row.productSkuId),
        ),
      ),
    [localRegisterCatalogAvailabilityBySkuId, registerSearchState.results],
  );
  const exactSearchProduct = registerSearchState.exactMatch
    ? mapCatalogRowToProduct(
        registerSearchState.exactMatch,
        localRegisterCatalogAvailabilityBySkuId.get(
          registerSearchState.exactMatch.productSkuId,
        ),
      )
    : null;
  if (
    isCloudOperableSession(operableActiveSession)
  ) {
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
  const hasActiveCustomerDetails = hasCustomerDetails(customerInfo);
  const hasActiveCartDraft = activeCartItems.length > 0;
  const hasClearableSaleState = Boolean(
    operableActiveSession &&
    (hasActiveCartDraft || hasActiveCustomerDetails || payments.length > 0),
  );
  const hasActivePosSession = Boolean(operableActiveSession?._id);
  const activeSessionNeedsRegisterBinding = Boolean(
    isCloudOperableSession(operableActiveSession) &&
      !operableActiveSession.registerSessionId,
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
    !usableActiveRegisterSession,
  );
  const hasMissingDrawerStartupState = Boolean(
    bootstrapState &&
    (bootstrapState.phase === "readyToStart" ||
      bootstrapState.phase === "resumable") &&
    !usableActiveRegisterSession &&
    !locallyOperableRegisterSession,
  );
  const hasMissingDrawerRecoveryState = Boolean(
    bootstrapState &&
    !usableActiveRegisterSession &&
    !locallyOperableRegisterSession &&
    (bootstrapState.phase === "active" ||
      bootstrapState.phase === "resumable" ||
      hasActivePosSession),
  );
  const requiresDrawerGate = Boolean(
    activeStoreId &&
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
      ? (usableActiveRegisterSession ?? localCloseoutRegisterSession)
      : null);
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
      setOptimisticCartProducts({});
      setOptimisticCartQuantities({});
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

  const ensureLocalRegisterSessionReady = useCallback(
    async (localRegisterSessionId: string) => {
      if (
        locallyOperableRegisterSession?.localRegisterSessionId ===
          localRegisterSessionId ||
        (localRegisterReadModel?.canSell &&
          localRegisterReadModel.activeRegisterSession?.localRegisterSessionId ===
            localRegisterSessionId)
      ) {
        return true;
      }

      if (
        !usableActiveRegisterSession ||
        usableActiveRegisterSession._id.toString() !== localRegisterSessionId ||
        !activeStoreId ||
        !terminal?._id ||
        !staffProfileId
      ) {
        return false;
      }

      const savedLocally = await localCommandGateway.seedRegisterSession({
        terminalId: terminal._id,
        storeId: activeStoreId!,
        registerNumber,
        localRegisterSessionId,
        staffProfileId,
        openingFloat: usableActiveRegisterSession.openingFloat,
        expectedCash: usableActiveRegisterSession.expectedCash,
        notes: usableActiveRegisterSession.notes ?? null,
        status: usableActiveRegisterSession.status,
      });
      if (savedLocally) {
        noteLocalRegisterEventChanged();
      }
      return Boolean(savedLocally);
    },
    [
      activeStoreId,
      localRegisterReadModel?.activeRegisterSession?.localRegisterSessionId,
      localRegisterReadModel?.canSell,
      localCommandGateway,
      locallyOperableRegisterSession?.localRegisterSessionId,
      noteLocalRegisterEventChanged,
      registerNumber,
      staffProfileId,
      terminal?._id,
      usableActiveRegisterSession,
    ],
  );

  const ensureLocalPosSessionId = useCallback(async (): Promise<string | null> => {
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
      const localSession = await localCommandGateway.startSession({
        storeId: activeStoreId!,
        terminalId: terminal._id as Id<"posTerminal">,
        staffProfileId,
        registerNumber,
        localRegisterSessionId,
        localPosSessionId: operableActiveSession._id.toString(),
      });
      if (localSession.kind !== "ok") {
        toast.error("Unable to save this sale locally. Try again.");
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

    if (!(await hasProvisionedLocalSyncSeed())) {
      toast.error("Terminal setup required. Register this terminal before selling.");
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
    });

    if (result.kind !== "ok") {
      toast.error("Unable to save this sale locally. Try again.");
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
    ensureLocalRegisterSessionReady,
    hasProvisionedLocalSyncSeed,
    localCommandGateway,
    locallyOperableRegisterSession,
    noteLocalRegisterEventChanged,
    staffProfileId,
    registerNumber,
    registerState?.activeSession?._id,
    terminal?._id,
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
        logger.warn("[POS] Skipped checkout persistence before terminal setup", {
          sessionId: operableActiveSession._id,
          stage: args.stage,
        });
        return false;
      }

      const savedLocally = await localCommandGateway.appendPaymentState({
        terminalId: terminal._id,
        storeId: activeStoreId!,
        registerNumber,
        localRegisterSessionId: localEventRegisterSessionId ?? registerNumber,
        localPosSessionId: operableActiveSession._id.toString(),
        staffProfileId,
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
      noteLocalRegisterEventChanged,
      registerNumber,
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

    if (isLocalOperableSession(operableActiveSession) || isProjectedLocalSale) {
      if (checkoutMutationLockedRef.current) {
        toast.error("Finish the current checkout update before clearing the sale.");
        return false;
      }

      if (!staffProfileId) {
        toast.error("Register sign-in required. Sign in before clearing it.");
        return false;
      }

      checkoutMutationLockedRef.current = true;
      const hadCartItems = activeCartItems.length > 0;
      try {
        await waitForCheckoutMutationQueues();

        if (!activeStoreId || !terminal?._id) {
          presentOperatorError("Unable to save this cart update locally.");
          return false;
        }
        const savedLocally = await localCommandGateway.clearCart({
          terminalId: terminal._id,
          storeId: activeStoreId!,
          registerNumber,
          localRegisterSessionId: localEventRegisterSessionId ?? registerNumber,
          localPosSessionId: localSaleId,
          staffProfileId,
          reason: "Sale cleared",
        });

        if (!savedLocally) {
          presentOperatorError("Unable to save this cart update locally.");
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
        checkoutMutationLockedRef.current = false;
      }
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
  }, [
    activeCartItems,
    localEventRegisterSessionId,
    activeStoreId,
    localCommandGateway,
    localRegisterReadModel?.activeSale?.localPosSessionId,
    noteLocalRegisterEventChanged,
    operableActiveSession,
    registerNumber,
    resetDraftState,
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

    if (!activeStoreId || !terminal?._id || !staffProfileId) {
      toast.error("Register sign-in required. Sign in before starting a sale.");
      return;
    }

    const localRegisterSessionId =
      locallyOperableRegisterSession?.localRegisterSessionId ??
      localEventRegisterSessionId;

    if (!localRegisterSessionId) {
      toast.error("Drawer closed. Open the drawer before starting a sale.");
      return;
    }

    if (!(await hasProvisionedLocalSyncSeed())) {
      toast.error("Terminal setup required. Register this terminal before selling.");
      return;
    }

    if (!(await ensureLocalRegisterSessionReady(localRegisterSessionId))) {
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

    const result = await localCommandGateway.startSession({
      storeId: activeStoreId!,
      terminalId: terminal._id as Id<"posTerminal">,
      staffProfileId,
      registerNumber,
      localRegisterSessionId,
    });

    if (result.kind !== "ok") {
      presentOperatorError("Unable to save this sale locally.");
      return;
    }

    const localPosSessionId = result.data.localPosSessionId;
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
    toast.success("Sale started");
  }, [
    operableActiveSession,
    localEventRegisterSessionId,
    activeStoreId,
    staffProfileId,
    guardActiveSessionConflict,
    ensureLocalRegisterSessionReady,
    hasProvisionedLocalSyncSeed,
    holdCurrentSession,
    localCommandGateway,
    locallyOperableRegisterSession?.localRegisterSessionId,
    noteLocalRegisterEventChanged,
    registerNumber,
    resetDraftState,
    terminal?._id,
  ]);

  const handleOpenDrawer = useCallback(async () => {
    if (!activeStoreId || !terminal?._id || !staffProfileId) {
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
      openingFloat: parsedOpeningFloat,
      notes: trimOptional(drawerNotes),
    });

    setIsOpeningDrawer(false);

    if (result.kind !== "ok" || !result.data) {
      setDrawerErrorMessage("Unable to save this drawer opening locally.");
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
    toast.success("Drawer opening saved locally. It will sync when ready.");
  }, [
    activeStoreId,
    staffProfileId,
    drawerNotes,
    drawerOpeningFloat,
    hasProvisionedLocalSyncSeed,
    localCommandGateway,
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

    if (hasCloseoutVariance && !trimmedCloseoutNotes) {
      setDrawerErrorMessage(
        "Closeout notes required. Add notes before submitting a count with variance.",
      );
      return;
    }

    setDrawerErrorMessage(null);
    setIsSubmittingCloseout(true);
    await waitForCheckoutMutationQueues();
    const savedLocally = await localCommandGateway.startCloseout({
      terminalId: terminal._id,
      storeId: activeStoreId!,
      registerNumber,
      localRegisterSessionId: registerSessionId,
      staffProfileId,
      countedCash: parsedCountedCash,
      notes: trimmedCloseoutNotes ?? null,
    });
    setIsSubmittingCloseout(false);

    if (!savedLocally) {
      setDrawerErrorMessage("Unable to save this closeout locally.");
      return;
    }

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
    toast.success("Register session closed locally. It will sync when ready.");
  }, [
    activeStoreId,
    activeCloseoutRegisterSession,
    closeoutCountedCash,
    closeoutNotes,
    localCommandGateway,
    locallyOperableRegisterSession?.localRegisterSessionId,
    noteLocalRegisterEventChanged,
    registerNumber,
    requestBootstrap,
    staffProfileId,
    terminal?._id,
    waitForCheckoutMutationQueues,
  ]);

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
      reason: "Register closeout reopened from POS drawer gate.",
    });
    setIsReopeningCloseout(false);

    if (!savedLocally) {
      setDrawerErrorMessage("Unable to save this reopen locally.");
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
    toast.success("Register reopened locally. It will sync when ready.");
  }, [
    activeStoreId,
    activeCloseoutRegisterSession,
    closeoutBlockedRegisterSession,
    isCashierManager,
    localCommandGateway,
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
        payload: input.payload,
      });
    },
    [
      localEventRegisterSessionId,
      activeStoreId,
      localCommandGateway,
      registerNumber,
      staffProfileId,
      terminal?._id,
    ],
  );

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

      if (
        availabilityStatus !== "available" ||
        (typeof product.quantityAvailable === "number" &&
          product.quantityAvailable <= 0)
      ) {
        toast.error(POS_NO_TRUSTED_AVAILABILITY_REMAINING_MESSAGE);
        return false;
      }

      return enqueueCartMutation(async () => {
      const localPosSessionId = await ensureLocalPosSessionId();
      if (!localPosSessionId) {
        return false;
      }

      const queuedReadModel = await readCurrentLocalRegisterModel();
      if (registerCatalogSkuIds.has(productSkuId)) {
        const availability = registerCatalogAvailabilityBySkuId.get(productSkuId);
        if (!availability) {
          toast.error(POS_AVAILABILITY_NOT_READY_MESSAGE);
          return false;
        }

        const localConsumption =
          localAvailabilityConsumptionFromReadModel(queuedReadModel).get(
            productSkuId,
          ) ?? 0;
        if (Math.trunc(availability.quantityAvailable) - localConsumption <= 0) {
          toast.error(POS_NO_TRUSTED_AVAILABILITY_REMAINING_MESSAGE);
          return false;
        }
      }

      const localSaleItem = queuedReadModel?.activeSale?.items.find(
        (item) => item.productSkuId === productSkuId,
      );
      const existingItem = activeCartItems.find(
        (item) => item.skuId === productSkuId,
      );
      const nextQuantity =
        (localSaleItem?.quantity ?? existingItem?.quantity ?? 0) + 1;
      const localItemId =
        localSaleItem?.localItemId ??
        existingItem?.id.toString() ??
        createLocalFallbackId("local-item");
      const optimisticProductKey = productSkuId;
      const previousOptimisticProduct = optimisticCartProducts[productSkuId];
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

      const savedLocally = await appendLocalCartItem({
        localPosSessionId,
        payload: buildLocalCartItemPayload({
          localItemId,
          product,
          quantity: nextQuantity,
        }),
      });

      if (!savedLocally) {
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
        presentOperatorError("Unable to save this item locally.");
        return false;
      }

      noteLocalRegisterEventChanged();
      setProductSearchQuery("");
      toast.success("Item added to local sale. Complete the sale to sync it.");
      return true;
      });
    },
    [
      activeCartItems,
      activeSessionHasBlockedRegisterBinding,
      enqueueCartMutation,
      appendLocalCartItem,
      ensureLocalPosSessionId,
      noteLocalRegisterEventChanged,
      optimisticCartProducts,
      readCurrentLocalRegisterModel,
      registerCatalogAvailabilityBySkuId,
      registerCatalogSkuIds,
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

      return enqueueCartMutation(async () => {
        const item = activeCartItems.find(
          (candidate) => candidate.id === itemId,
        );
        if (!item) {
          return;
        }

        const queuedReadModel = await readCurrentLocalRegisterModel();
        const queuedLocalItem = item.skuId
          ? queuedReadModel?.activeSale?.items.find(
              (candidate) =>
                candidate.localItemId === itemId.toString() ||
                candidate.productSkuId === item.skuId,
            )
          : undefined;
        const currentQuantity = queuedLocalItem?.quantity ?? item.quantity;

        if (
          item.skuId &&
          quantity > currentQuantity &&
          registerCatalogSkuIds.has(item.skuId)
        ) {
          const requestedIncrease = quantity - currentQuantity;
          const availability = registerCatalogAvailabilityBySkuId.get(item.skuId);
          if (!availability) {
            toast.error(POS_AVAILABILITY_NOT_READY_MESSAGE);
            return;
          }

          const localConsumption =
            localAvailabilityConsumptionFromReadModel(queuedReadModel).get(
              item.skuId,
            ) ?? 0;
          const trustedQuantityAvailable = Math.max(
            0,
            Math.trunc(availability.quantityAvailable) - localConsumption,
          );

          if (trustedQuantityAvailable < requestedIncrease) {
            toast.error(POS_NO_TRUSTED_AVAILABILITY_REMAINING_MESSAGE);
            return;
          }
        }

      const itemIsLocalOnly = item.id.toString().startsWith("optimistic:");
      if (itemIsLocalOnly) {
        if (!item.skuId) return;
        if (quantity <= 0) {
          const savedLocally = await appendLocalCartItem({
            localPosSessionId: operableActiveSession._id.toString(),
            payload: buildLocalCartItemPayloadFromCartItem({
              item,
              localItemId: itemId.toString(),
              quantity: 0,
            }),
          });
          if (!savedLocally) {
            presentOperatorError("Unable to save this cart update locally.");
            return;
          }
          noteLocalRegisterEventChanged();
          setOptimisticCartProducts((current) => {
            const next = { ...current };
            delete next[item.skuId!];
            return next;
          });
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
          presentOperatorError("Unable to save this cart update locally.");
          return;
        }
        noteLocalRegisterEventChanged();
        setOptimisticCartProducts((current) => ({
          ...current,
          [item.skuId!]: {
            ...item,
            quantity,
          },
        }));
        return;
      }

      if (quantity <= 0) {
        const savedLocally = await appendLocalCartItem({
          localPosSessionId: operableActiveSession._id.toString(),
          payload: buildLocalCartItemPayloadFromCartItem({
            item,
            localItemId: itemId.toString(),
            quantity: 0,
          }),
        });

        if (!savedLocally) {
          presentOperatorError("Unable to save this cart update locally.");
          return;
        }

        setOptimisticCartQuantities((current) => ({
          ...current,
          [itemId]: 0,
        }));
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
        presentOperatorError("Unable to save this cart update locally.");
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

      return enqueueCartMutation(async () => {
      const item = activeCartItems.find((candidate) => candidate.id === itemId);
      if (!item) {
        return;
      }

      if (item?.id.toString().startsWith("optimistic:")) {
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
          presentOperatorError("Unable to save this cart update locally.");
          return;
        }
        noteLocalRegisterEventChanged();
        setOptimisticCartProducts((current) => {
          const next = { ...current };
          delete next[item.skuId!];
          return next;
        });
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
        presentOperatorError("Unable to save this cart update locally.");
        return;
      }

      setOptimisticCartQuantities((current) => ({
        ...current,
        [itemId]: 0,
      }));
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
      toast.error("Finish the current checkout update before clearing the sale.");
      return;
    }

    if (!operableActiveSession || !staffProfileId) {
      return;
    }

    if (activeSessionHasBlockedRegisterBinding) {
      toast.error("Drawer closed. Open the drawer before updating this sale.");
      return;
    }

    checkoutMutationLockedRef.current = true;
    try {
      await waitForCheckoutMutationQueues();

      if (!activeStoreId || !terminal?._id) {
        presentOperatorError("Unable to save this cart update locally.");
        return;
      }

      const savedLocally = await localCommandGateway.clearCart({
        terminalId: terminal._id,
        storeId: activeStoreId!,
        registerNumber,
        localRegisterSessionId: localEventRegisterSessionId ?? registerNumber,
        localPosSessionId: operableActiveSession._id.toString(),
        staffProfileId,
        reason: "Cart cleared",
      });

      if (!savedLocally) {
        presentOperatorError("Unable to save this cart update locally.");
        return;
      }

      setOptimisticCartQuantities((current) => {
        const next = { ...current };
        for (const item of operableActiveSession.cartItems) {
          next[item.id] = 0;
        }
        return next;
      });
      setOptimisticCartProducts({});
      noteLocalRegisterEventChanged();
      setPaymentState([]);
      if (activeCartItems.length > 0) {
        toast.success("Sale cleared");
      }
    } finally {
      checkoutMutationLockedRef.current = false;
    }
  }, [
    operableActiveSession,
    activeSessionHasBlockedRegisterBinding,
    localEventRegisterSessionId,
    activeCartItems,
    activeStoreId,
    localCommandGateway,
    noteLocalRegisterEventChanged,
    registerNumber,
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
        (registerSearchProducts.length === 1 ? registerSearchProducts[0] : null);

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
      if (typeof result === "string") {
        setStaffProfileId(result as Id<"staffProfile">);
        setStaffProofToken(null);
        setLocalAuthenticatedStaff(null);
      } else {
        setStaffProfileId(result.staffProfileId);
        setStaffProofToken(readStaffProofFromAuthResult(result));
        setLocalAuthenticatedStaff({
          activeRoles: result.activeRoles ?? [],
          displayName: getStaffDisplayNameFromAuthResult(result),
        });
      }
      requestBootstrap();
    },
    [requestBootstrap],
  );

  const handleNavigateBack = useCallback(async () => {
    if (!operableActiveSession && activeCartItems.length > 0) {
      toast.error(
        "Complete or clear this local sale before leaving the register.",
      );
      return;
    }

    if (operableActiveSession) {
      const hasDraftState = operableActiveSession.cartItems.length > 0;
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
    staffProfileId,
  ]);

  const handleCashierSignOut = useCallback(async () => {
    if (!operableActiveSession && activeCartItems.length > 0) {
      toast.error(
        "Complete or clear this local sale before leaving the register.",
      );
      return;
    }

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
    activeCartItems.length,
    holdCurrentSession,
    resetDraftState,
    voidCurrentSession,
  ]);

  const handleCompleteTransaction = useCallback(async () => {
    if (checkoutMutationLockedRef.current) {
      toast.error("Finish the current checkout update before completing the sale.");
      return false;
    }

    if (!operableActiveSession || !staffProfileId) {
      toast.error("No sale in progress. Start a sale before taking payment.");
      return false;
    }

    checkoutMutationLockedRef.current = true;
    try {
      await waitForCheckoutMutationQueues();

      const currentPayments = paymentsRef.current;
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
      const saleTotals = refreshedLocalCartItems
        ? totalsFromCartItems(saleCartItems)
        : activeTotals;
      if (saleCartItems.length === 0) {
        toast.error("Add an item before completing the sale.");
        return false;
      }
      const paidTotal = currentPayments.reduce(
        (sum, payment) => sum + payment.amount,
        0,
      );
      if (saleTotals.total > 0 && paidTotal < saleTotals.total) {
        toast.error("Payment required. Add payment before completing the sale.");
        return false;
      }
      const finishCompletedSale = (input: {
        orderNumber: string;
        successMessage: string;
        transactionId?: Id<"posTransaction">;
      }) => {
        setIsTransactionCompleted(true);
        setCompletedOrderNumber(input.orderNumber);
        setCompletedTransactionData({
          paymentMethod: currentPayments[0]?.method ?? "cash",
          payments: [...currentPayments],
          transactionId: input.transactionId,
          completedAt: new Date(),
          cartItems: [...saleCartItems],
          subtotal: saleTotals.subtotal,
          tax: saleTotals.tax,
          total: saleTotals.total,
          customerInfo: completedCustomerInfo(customerInfo),
        });
        toast.success(input.successMessage);
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
          payments: currentPayments,
          receiptNumber: input.receiptNumber,
          totals: saleTotals,
        });

      if (!(await hasProvisionedLocalSyncSeed())) {
        toast.error("Terminal setup required. Register this terminal before completing the sale.");
        return false;
      }

      if (!activeStoreId || !terminal?._id) {
        presentOperatorError("Unable to save this sale locally.");
        return false;
      }

      const localTransactionId = createLocalFallbackId("local-txn");
      const savedLocally = await localCommandGateway.completeTransaction({
        terminalId: terminal._id,
        storeId: activeStoreId!,
        registerNumber,
        localRegisterSessionId: localEventRegisterSessionId ?? registerNumber,
        localPosSessionId,
        localTransactionId,
        staffProfileId,
        payload: buildSalePayload({
          localTransactionId,
          receiptNumber: localTransactionId,
        }),
      });
      if (!savedLocally) {
        presentOperatorError("Unable to save this sale locally.");
        return false;
      }

      noteLocalRegisterEventChanged();
      locallyCompletedSessionIdsRef.current.add(localPosSessionId);
      finishCompletedSale({
        orderNumber: localTransactionId,
        successMessage: "Sale completed locally. It will sync when ready.",
      });
      return true;
    } finally {
      checkoutMutationLockedRef.current = false;
    }
  }, [
    activeCartItems,
    activeSession?._id,
    activeSession?.cartItems,
    localEventRegisterSessionId,
    activeStoreId,
    activeTotals,
    operableActiveSession,
    customerInfo,
    hasProvisionedLocalSyncSeed,
    localCommandGateway,
    noteLocalRegisterEventChanged,
    readCurrentLocalRegisterModel,
    registerNumber,
    staffProfileId,
    terminal?._id,
    waitForCheckoutMutationQueues,
  ]);

  const handleStartNewTransaction = useCallback(() => {
    resetDraftState({
      keepCashier: true,
    });
    requestBootstrap();
  }, [requestBootstrap, resetDraftState]);

  const enqueuePaymentMutation = useCallback(
    (
      buildMutation: (currentPayments: Payment[]) => {
        amount?: number;
        nextPayments: Payment[];
        paymentMethod?: PosPaymentMethod;
        previousAmount?: number;
        stage:
          | "paymentAdded"
          | "paymentUpdated"
          | "paymentRemoved"
          | "paymentsCleared";
      } | null,
    ) => {
      if (checkoutMutationLockedRef.current) {
        toast.error("Finish the current checkout update before changing payments.");
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
          toast.error("Unable to save this payment locally.");
          return false;
        }

        setPaymentState(mutation.nextPayments);
        return true;
      };

      const queued = paymentMutationQueueRef.current
        .catch(() => undefined)
        .then(runMutation);
      paymentMutationQueueRef.current = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    },
    [allocateCheckoutStateVersion, persistCheckoutStateLocally, setPaymentState],
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

  const sessionPanel =
    activeStoreId && terminal?._id && staffProfileId
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
    activeStoreId && terminal?._id && staffProfileId
      ? {
          cashierName:
            cashier ? getCashierDisplayName(cashier) : localAuthenticatedStaff?.displayName ?? "",
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
              closeoutSecondaryActionLabel: closeoutBlockedRegisterSession
                ? "Reopen register"
                : "Return to sale",
              expectedCash: activeCloseoutRegisterSession?.expectedCash,
              canOpenCashControls: isCashierManager,
              cashControlsRegisterSessionId: getCloseoutCloudRegisterSessionId(
                activeCloseoutRegisterSession,
              ),
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
              onReopenRegister: isCashierManager
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
  const localRuntimeSyncSource = usePosLocalSyncRuntimeStatus({
    storeId: activeStoreId,
    terminalId: terminal?._id,
    onRetrySync: requestBootstrap,
    storeFactory: () => localStore,
  });
  const localSyncSource = readLocalSyncStatus(
    localRuntimeSyncSource
      ? { localSyncStatus: localRuntimeSyncSource }
      : null,
    operableActiveSession,
    locallyOperableRegisterSession
      ? {
          localSyncStatus: {
            status: "pending_sync",
            pendingEventCount: 1,
          },
        }
      : null,
    activeCloseoutRegisterSession,
    registerState?.activeRegisterSession,
    registerState,
  );
  const syncStatus =
    activeStoreId && terminal?._id
      ? {
          ...buildPosSyncStatusPresentation(localSyncSource),
          onRetrySync: () => {
            localSyncSource?.onRetrySync?.();
            requestBootstrap();
          },
        }
      : null;

  const authDialog =
    activeStoreId && terminal?._id
      ? {
          open: !staffProfileId,
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
      authDialogOpen: Boolean(authDialog?.open),
      hasLiveActiveStore: Boolean(activeStore),
      localStaffAuthorityStatus,
      localEntryStatus: localEntryContext.status,
      online: globalThis.navigator?.onLine ?? true,
      staffSignedIn: Boolean(staffProfileId),
      ...(activeStoreId ? { storeId: activeStoreId } : {}),
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
    syncStatus,
    authDialog,
    commandApprovalDialog,
    onNavigateBack: handleNavigateBack,
  };
}

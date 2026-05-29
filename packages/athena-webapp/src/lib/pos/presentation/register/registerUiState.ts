import type { FormEvent } from "react";

import type { CommandApprovalDialogProps } from "@/components/operations/CommandApprovalDialog";
import type { StaffAuthenticationResult } from "@/components/staff-auth/StaffAuthenticationDialog";
import type {
  CustomerInfo,
  CartItem,
  Payment,
  Product,
} from "@/components/pos/types";
import type { Id } from "~/convex/_generated/dataModel";
import type { PosPaymentMethod } from "@/lib/pos/domain";
import type { PosSyncStatusPresentation } from "@/lib/pos/presentation/syncStatusPresentation";

export interface RegisterHeaderState {
  title: string;
  isSessionActive: boolean;
}

export interface RegisterInfoState {
  customerName?: string;
  registerLabel: string;
  hasTerminal: boolean;
}

export interface RegisterCustomerPanelState {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  customerInfo: CustomerInfo;
  onCustomerCommitted: (customer: CustomerInfo) => Promise<void>;
  setCustomerInfo: (
    customer: CustomerInfo | ((currentCustomer: CustomerInfo) => CustomerInfo),
  ) => void;
}

export interface RegisterProductEntryState {
  disabled: boolean;
  showProductLookup: boolean;
  setShowProductLookup: (show: boolean) => void;
  productSearchQuery: string;
  setProductSearchQuery: (query: string) => void;
  onBarcodeSubmit: (event: FormEvent) => Promise<void>;
  onAddProduct: (product: Product) => Promise<boolean>;
  searchResults: Product[];
  isSearchLoading: boolean;
  isSearchReady: boolean;
  canQuickAddProduct: boolean;
}

export type RegisterLookupMode = "product" | "service";

export type RegisterServicePricingModel =
  | "fixed"
  | "starting_at"
  | "quote_after_consultation";

export type RegisterServiceMode =
  | "same_day"
  | "consultation"
  | "repair"
  | "revamp";

export interface RegisterServiceSearchResult {
  id: string;
  serviceCatalogId?: Id<"serviceCatalog">;
  name: string;
  description?: string;
  serviceMode: RegisterServiceMode;
  pricingModel: RegisterServicePricingModel;
  basePrice?: number;
  requiresManagerApproval?: boolean;
  updatedAt?: number;
}

export interface RegisterServiceLineState {
  id: string;
  serviceCatalogId?: Id<"serviceCatalog">;
  name: string;
  serviceMode: RegisterServiceMode;
  pricingModel: RegisterServicePricingModel;
  price: number;
  quantity: number;
  amountRequired: boolean;
  catalogUpdatedAt?: number;
}

export interface RegisterServiceEntryState {
  disabled: boolean;
  serviceSearchQuery: string;
  setServiceSearchQuery: (query: string) => void;
  searchResults: RegisterServiceSearchResult[];
  isSearchLoading: boolean;
  isSearchReady: boolean;
  items: RegisterServiceLineState[];
  onAddService: (
    service: RegisterServiceSearchResult,
    amount?: number,
  ) => Promise<boolean>;
  onUpdateServiceAmount: (lineId: string, amount: number) => Promise<void>;
  onRemoveService: (lineId: string) => Promise<void>;
  checkoutBlockMessage?: string;
}

export interface RegisterCartState {
  items: CartItem[];
  serviceItems?: RegisterServiceLineState[];
  onUpdateServiceAmount?: (lineId: string, amount: number) => Promise<void>;
  onRemoveService?: (lineId: string) => Promise<void>;
  onUpdateQuantity: (
    itemId: Id<"posSessionItem"> | Id<"expenseSessionItem">,
    quantity: number,
  ) => Promise<void>;
  onRemoveItem: (
    itemId: Id<"posSessionItem"> | Id<"expenseSessionItem">,
  ) => Promise<void>;
  onClearCart: () => Promise<void>;
}

export interface RegisterSessionPanelState {
  activeSessionNumber?: string | null;
  activeSessionTraceId?: string | null;
  hasExpiredSession: boolean;
  canHoldSession: boolean;
  canClearSale: boolean;
  disableNewSession: boolean;
  heldSessions: Array<{
    _id: Id<"posSession">;
    expiresAt: number;
    sessionNumber: string;
    cartItems: CartItem[];
    total?: number;
    subtotal?: number;
    heldAt?: number;
    updatedAt: number;
    workflowTraceId?: string;
    holdReason?: string;
    customer?: {
      name: string;
      email?: string;
      phone?: string;
    } | null;
  }>;
  onHoldCurrentSession: () => Promise<void>;
  onVoidCurrentSession: () => Promise<void>;
  onResumeSession: (sessionId: Id<"posSession">) => Promise<void>;
  onVoidHeldSession: (sessionId: Id<"posSession">) => Promise<void>;
  onStartNewSession: () => Promise<void>;
}

export interface RegisterCheckoutState {
  cartItems: CartItem[];
  customerInfo?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  registerNumber: string;
  currency?: string;
  subtotal: number;
  tax: number;
  total: number;
  payments: Payment[];
  hasTerminal: boolean;
  isTransactionCompleted: boolean;
  completedOrderNumber: string | null;
  completionBlockMessage?: string;
  completedTransactionData?: {
    paymentMethod: string;
    payments?: Payment[];
    transactionId?: Id<"posTransaction"> | Id<"expenseTransaction">;
    localTransactionId?: string;
    completedAt: Date;
    cartItems: CartItem[];
    subtotal: number;
    tax: number;
    total: number;
    serviceLines?: Array<{
      id: string;
      name: string;
      quantity?: number;
      unitPrice?: number;
      totalPrice: number;
      serviceCaseId?: string | null;
      serviceCaseTitle?: string | null;
      serviceCaseUnavailable?: boolean;
      serviceMode?: string | null;
      servicePaymentStatus?: string | null;
      serviceStatus?: string | null;
    }>;
    notes?: string | null;
    customerInfo?: {
      name: string;
      email: string;
      phone: string;
    };
  } | null;
  cashierName?: string;
  actorStaffProfileId?: Id<"staffProfile"> | null;
  onAddPayment: (method: PosPaymentMethod, amount: number) => Promise<boolean>;
  onUpdatePayment: (paymentId: string, amount: number) => Promise<boolean>;
  onRemovePayment: (paymentId: string) => Promise<boolean>;
  onClearPayments: () => Promise<boolean>;
  onCompleteTransaction: () => Promise<boolean>;
  onStartNewTransaction: () => void | Promise<void>;
}

export interface RegisterCashierCardState {
  cashierName: string;
  onSignOut: () => Promise<void>;
}

export interface RegisterDrawerGateState {
  mode:
    | "initialSetup"
    | "recovery"
    | "closeoutBlocked"
    | "openingFloatCorrection"
    | "terminalRepair"
    | "drawerAuthorityRepair";
  isRecovery?: boolean;
  registerLabel: string;
  registerNumber: string;
  currency?: string;
  currentOpeningFloat?: number;
  openingFloat?: string;
  correctedOpeningFloat?: string;
  correctionReason?: string;
  closeoutCountedCash?: string;
  closeoutDraftVariance?: number;
  closeoutSubmittedCountedCash?: number;
  closeoutSubmittedVariance?: number;
  closeoutNotes?: string;
  closeoutSubmittedReason?: "manager_review" | "pending_sync";
  closeoutSecondaryActionLabel?: string;
  expectedCash?: number;
  canOpenCashControls?: boolean;
  cashControlsRegisterSessionId?: Id<"registerSession">;
  canOpenDrawer?: boolean;
  hasPendingCloseoutApproval?: boolean;
  notes?: string;
  errorMessage: string | null;
  isCloseoutSubmitting?: boolean;
  isCorrectingOpeningFloat?: boolean;
  isReopeningCloseout?: boolean;
  isSubmitting?: boolean;
  onCloseoutCountedCashChange?: (value: string) => void;
  onCloseoutNotesChange?: (value: string) => void;
  onCloseoutSecondaryAction?: () => void | Promise<void>;
  onCorrectedOpeningFloatChange?: (value: string) => void;
  onCorrectionReasonChange?: (value: string) => void;
  onOpeningFloatChange?: (value: string) => void;
  onNotesChange?: (value: string) => void;
  onCancelOpeningFloatCorrection?: () => void;
  onSubmitOpeningFloatCorrection?: () => Promise<void>;
  onSubmitCloseout?: () => Promise<void>;
  onReopenRegister?: () => Promise<void>;
  onRetrySync?: () => void;
  onSubmit?: () => Promise<void>;
  onSignOut: () => Promise<void>;
}

export interface RegisterCloseoutControlState {
  canCloseout: boolean;
  canShowOpeningFloatCorrection: boolean;
  canCorrectOpeningFloat: boolean;
  onRequestCloseout: () => void;
  onRequestOpeningFloatCorrection: () => void;
}

export interface RegisterAuthDialogState {
  open: boolean;
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
  workflowMode?: RegisterWorkflowMode;
  onAuthenticated: (
    result: StaffAuthenticationResult | Id<"staffProfile">,
  ) => void;
  onDismiss: () => void;
}

export interface RegisterCommandApprovalDialogState {
  approval: CommandApprovalDialogProps["approval"];
  onApproved: CommandApprovalDialogProps["onApproved"];
  onAuthenticateForApproval: CommandApprovalDialogProps["onAuthenticateForApproval"];
  onDismiss: () => void;
  open: boolean;
  requestedByStaffProfileId?: Id<"staffProfile">;
  storeId: Id<"store">;
}

export type RegisterWorkflowMode = "pos" | "expense";

export interface RegisterOnboardingState {
  shouldShow: boolean;
  terminalReady: boolean;
  cashierSetupReady: boolean;
  cashierSignedIn: boolean;
  cashierCount: number;
  nextStep: "terminal" | "cashierSetup" | "ready";
}

export interface RegisterViewModel {
  workflowMode?: RegisterWorkflowMode;
  hasActiveStore: boolean;
  debug?: {
    activeStoreSource: "live" | "local" | "missing";
    authDialogOpen: boolean;
    hasLiveActiveStore: boolean;
    localStaffAuthorityStatus: string;
    localEntryStatus: string;
    online: boolean;
    staffSignedIn: boolean;
    storeId?: string;
    syncFlow: {
      checkInPublishAttemptedAt?: number;
      checkInPublishCompletedAt?: number;
      checkInPublishMessage?: string;
      checkInPublishReason?: string;
      checkInPublishStatus?: string;
      eventAppendToken: number;
      failureCount?: number;
      failedEventCount?: number;
      lastBatchEventCount?: number;
      lastFailure?: string | null;
      lastHeldEventCount?: number;
      lastLocalSequence?: number;
      lastReviewEventCount?: number;
      lastRuntimeTrigger?: string;
      lastRuntimeTriggerAt?: number;
      lastRuntimeTriggerPriority?: string;
      lastSyncedSequence?: number;
      localOnlyEventCount?: number;
      mode?: string;
      nextPendingSequence?: number | null;
      oldestPendingEventAt?: number;
      oldestPendingEventId?: string;
      oldestPendingEventSequence?: number;
      oldestPendingUploadSequence?: number;
      nextPendingUploadSequence?: number;
      pendingEventCount?: number;
      pendingUploadEventCount?: number;
      reviewEventCount?: number;
      schedulerBackoffUntil?: number | null;
      schedulerRunning?: boolean;
      schedulerScheduled?: boolean;
      source: string;
      staffProof: "present" | "missing";
      status: string;
    };
    terminalId?: string;
    terminalSource: "live" | "local" | "missing";
  };
  header: RegisterHeaderState;
  registerInfo: RegisterInfoState;
  onboarding: RegisterOnboardingState;
  customerPanel: RegisterCustomerPanelState;
  productEntry: RegisterProductEntryState;
  serviceEntry?: RegisterServiceEntryState;
  cart: RegisterCartState;
  checkout: RegisterCheckoutState;
  sessionPanel: RegisterSessionPanelState | null;
  cashierCard: RegisterCashierCardState | null;
  drawerGate: RegisterDrawerGateState | null;
  closeoutControl: RegisterCloseoutControlState | null;
  syncStatus?: (PosSyncStatusPresentation & {
    onRetrySync?: () => void;
  }) | null;
  authDialog: RegisterAuthDialogState | null;
  commandApprovalDialog: RegisterCommandApprovalDialogState | null;
  onNavigateBack: () => Promise<void>;
}

export const EMPTY_REGISTER_CUSTOMER_INFO: CustomerInfo = {
  customerProfileId: undefined,
  name: "",
  email: "",
  phone: "",
};

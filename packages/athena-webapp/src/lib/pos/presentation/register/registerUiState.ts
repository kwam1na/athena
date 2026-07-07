import type { FormEvent } from "react";

import type { CommandApprovalDialogProps } from "@/components/operations/CommandApprovalDialog";
import type { StaffAuthenticationResult } from "@/components/staff-auth/StaffAuthenticationDialog";
import type { UpdateApplyBlockerPriority } from "@/lib/app-update";
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
  canSearchProducts?: boolean;
  canSearchServices?: boolean;
  showProductLookup: boolean;
  setShowProductLookup: (show: boolean) => void;
  productSearchQuery: string;
  setProductSearchQuery: (query: string) => void;
  onBarcodeSubmit: (event: FormEvent) => Promise<void>;
  onAddProduct: (product: Product, quantity?: number) => Promise<boolean>;
  searchResults: Product[];
  isSearchLoading: boolean;
  isSearchReady: boolean;
  canQuickAddProduct: boolean;
  canAddPendingCheckoutItem?: boolean;
  pendingCheckoutContext?: {
    createdByStaffProfileId: Id<"staffProfile">;
    registerSessionId: Id<"registerSession">;
    terminalId: Id<"posTerminal">;
  };
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
  serviceLines?: Array<{
    id: string;
    name: string;
    quantity?: number;
    unitPrice?: number;
    totalPrice: number;
    serviceMode?: string | null;
  }>;
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
  registerSessionCode?: string;
  registerSessionCodeScope?: "cloud" | "local";
  expectedCash?: number;
  pendingCashVoidApprovals?: {
    cashAffectingCount: number;
    cashAdjustmentCount?: number;
    cashAdjustmentDelta?: number;
    cashAmount: number;
    expectedCashAfterApproval?: number;
  } | null;
  canOpenCashControls?: boolean;
  canViewCloseoutFinancials?: boolean;
  cashControlsRegisterSessionId?: Id<"registerSession">;
  canOpenDrawer?: boolean;
  hasSignedInStaff?: boolean;
  hasPendingCloseoutApproval?: boolean;
  notes?: string;
  errorMessage: string | null;
  isCloseoutSubmitting?: boolean;
  isCorrectingOpeningFloat?: boolean;
  isRepairingTerminalSetup?: boolean;
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
  onRepairTerminalSetup?: () => Promise<void>;
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

export interface RegisterUpdateApplyBlockerState {
  active: boolean;
  priority: UpdateApplyBlockerPriority;
  label: string;
  guidance: string;
}

export const REGISTER_UPDATE_APPLY_BLOCKER_PRIORITY: UpdateApplyBlockerPriority =
  "critical-workflow";

export function buildRegisterUpdateApplyBlockerState({
  hasActiveSaleWork,
  hasCheckoutMutationInFlight,
  hasDrawerTransitionInFlight,
  hasLocalRuntimeApplyRisk,
}: {
  hasActiveSaleWork: boolean;
  hasCheckoutMutationInFlight: boolean;
  hasDrawerTransitionInFlight: boolean;
  hasLocalRuntimeApplyRisk: boolean;
}): RegisterUpdateApplyBlockerState {
  if (hasCheckoutMutationInFlight) {
    return {
      active: true,
      priority: REGISTER_UPDATE_APPLY_BLOCKER_PRIORITY,
      label: "Sale update in progress",
      guidance: "Finish the current sale update before applying the update.",
    };
  }

  if (hasDrawerTransitionInFlight) {
    return {
      active: true,
      priority: REGISTER_UPDATE_APPLY_BLOCKER_PRIORITY,
      label: "Register change in progress",
      guidance: "Finish the register change before applying the update.",
    };
  }

  if (hasActiveSaleWork) {
    return {
      active: true,
      priority: REGISTER_UPDATE_APPLY_BLOCKER_PRIORITY,
      label: "Sale in progress",
      guidance:
        "Finish, hold, or clear this sale before applying the update.",
    };
  }

  if (hasLocalRuntimeApplyRisk) {
    return {
      active: true,
      priority: REGISTER_UPDATE_APPLY_BLOCKER_PRIORITY,
      label: "Register saving",
      guidance:
        "Wait for this register to finish saving before applying the update.",
    };
  }

  return {
    active: false,
    priority: REGISTER_UPDATE_APPLY_BLOCKER_PRIORITY,
    label: "Register ready",
    guidance: "Apply the update when you are ready.",
  };
}

export interface RegisterAuthDialogState {
  open: boolean;
  restoredCashier?: {
    displayName?: string | null;
    username: string;
  } | null;
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

export type RegisterReadinessGuardState =
  | {
      reason: "cashierPresence";
      status: "settling";
    }
  | {
      reason: "registerSetup";
      status: "settling" | "visible";
    };

export type CashierPresenceRestoreStatus =
  | "pending"
  | "restored"
  | "validation_pending"
  | "missing"
  | "expired"
  | "offline_freshness_expired"
  | "invalidated"
  | "failed";

export interface RegisterCashierPresenceRestoreState {
  status: CashierPresenceRestoreStatus;
  displayName?: string | null;
  message?: string;
  username?: string | null;
}

export interface RegisterViewModel {
  workflowMode?: RegisterWorkflowMode;
  hasActiveStore: boolean;
  debug?: {
    activeStoreSource: "live" | "local" | "missing";
    appSessionRecovery?: string | null;
    authDialogOpen: boolean;
    cashierPresence: CashierPresenceRestoreStatus;
    hasLiveActiveStore: boolean;
    localStaffAuthorityStatus: string;
    localEntryStatus: string;
    online: boolean;
    staffSignedIn: boolean;
    storeId?: string;
    runtimeState?: {
      heartbeat?: {
        activeRegisterSession?: {
          cloudRegisterSessionId?: string;
          localRegisterSessionId: string;
          observedAt?: number;
          openedAt?: number;
          registerNumber?: string;
          status: string;
        };
        drawerAuthority?: {
          cloudRegisterSessionId?: string;
          localRegisterSessionId: string;
          reason?: string;
          status: string;
        };
        localStore: {
          available: boolean;
          failureMessage?: string;
          schemaVersion?: number;
          terminalSeedReady: boolean;
        };
        reportedAt?: number;
        saleAuthority?: {
          staffProfileId?: string;
          status: string;
        };
        source?: string;
        staffAuthority: {
          expiresAt?: number;
          staffProfileId?: string;
          status: string;
        };
        sync: {
          failedEventCount?: number;
          lastSyncedSequence?: number;
          nextPendingUploadSequence?: number;
          pendingEventCount?: number;
          reviewEventCount?: number;
          reviewEvents?: Array<{
            createdAt: number;
            localEventId: string;
            localPosSessionId?: string;
            localRegisterSessionId?: string;
            localTransactionId?: string;
            sequence: number;
            staffProfileId?: string;
            status: string;
            type: string;
            uploaded?: boolean;
            uploadSequence?: number;
          }>;
          status: string;
          uploadableEventCount?: number;
        };
        terminalIntegrity?: {
          reason?: string;
          status: string;
        };
      };
      events?: Array<{
        createdAt: number;
        localEventId: string;
        localPosSessionId?: string;
        localRegisterSessionId?: string;
        localTransactionId?: string;
        sequence: number;
        staffProfileId?: string;
        status: string;
        syncUploadable?: boolean;
        type: string;
        uploaded?: boolean;
        uploadSequence?: number;
      }>;
      localReadModel?: {
        activeRegisterSession?: {
          cloudRegisterSessionId?: string;
          expectedCash?: number;
          localRegisterSessionId: string;
          openedAt?: number;
          openingFloat?: number;
          registerNumber?: string;
          status: string;
        };
        canSell: boolean;
        saleBlockReason?: string | null;
        sourceEventCount: number;
        syncStatus: {
          lastLocalSequence: number;
          lastSyncedSequence?: number;
          nextPendingSequence?: number | null;
          state: string;
        };
      };
      repair?: {
        directive?: {
          cloudRegisterSessionId: string;
          expectedCash: number;
          localRegisterSessionId: string;
          observedAt: number;
          openedAt: number;
          openingFloat: number;
          registerNumber?: string;
          staffProfileId?: string;
          status: string;
        };
        observedAt: number;
        seedResult: string;
      };
    };
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
  cashierPresenceRestore: RegisterCashierPresenceRestoreState;
  readinessGuard: RegisterReadinessGuardState | null;
  drawerGate: RegisterDrawerGateState | null;
  closeoutControl: RegisterCloseoutControlState | null;
  updateApplyBlocker: RegisterUpdateApplyBlockerState;
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

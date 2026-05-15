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

export interface RegisterCartState {
  items: CartItem[];
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
  subtotal: number;
  tax: number;
  total: number;
  payments: Payment[];
  hasTerminal: boolean;
  isTransactionCompleted: boolean;
  completedOrderNumber: string | null;
  completedTransactionData?: {
    paymentMethod: string;
    payments?: Payment[];
    transactionId?: Id<"posTransaction">;
    completedAt: Date;
    cartItems: CartItem[];
    subtotal: number;
    tax: number;
    total: number;
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
  onStartNewTransaction: () => void;
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
    | "openingFloatCorrection";
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
  onCorrectedOpeningFloatChange?: (value: string) => void;
  onCorrectionReasonChange?: (value: string) => void;
  onOpeningFloatChange?: (value: string) => void;
  onNotesChange?: (value: string) => void;
  onCancelOpeningFloatCorrection?: () => void;
  onSubmitOpeningFloatCorrection?: () => Promise<void>;
  onSubmitCloseout?: () => Promise<void>;
  onReopenRegister?: () => Promise<void>;
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
    terminalId?: string;
    terminalSource: "live" | "local" | "missing";
  };
  header: RegisterHeaderState;
  registerInfo: RegisterInfoState;
  onboarding: RegisterOnboardingState;
  customerPanel: RegisterCustomerPanelState;
  productEntry: RegisterProductEntryState;
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

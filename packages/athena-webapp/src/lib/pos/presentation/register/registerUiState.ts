import type { FormEvent } from "react";

import type {
  CustomerInfo,
  CartItem,
  Payment,
  Product,
} from "@/components/pos/types";
import type { Id } from "~/convex/_generated/dataModel";
import type { PosPaymentMethod } from "@/lib/pos/domain";

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
  onAddProduct: (product: Product) => Promise<void>;
  barcodeSearchResult?: Product | Product[] | null;
  productIdSearchResults?: Product[] | null;
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
  onAddPayment: (method: PosPaymentMethod, amount: number) => void;
  onUpdatePayment: (paymentId: string, amount: number) => void;
  onRemovePayment: (paymentId: string) => void;
  onClearPayments: () => void;
  onCompleteTransaction: () => Promise<boolean>;
  onStartNewTransaction: () => void;
}

export interface RegisterCashierCardState {
  cashierName: string;
  onSignOut: () => Promise<void>;
}

export interface RegisterDrawerGateState {
  mode: "initialSetup" | "recovery" | "closeoutBlocked";
  isRecovery?: boolean;
  registerLabel: string;
  registerNumber: string;
  currency?: string;
  openingFloat?: string;
  closeoutCountedCash?: string;
  closeoutDraftVariance?: number;
  closeoutNotes?: string;
  closeoutSecondaryActionLabel?: string;
  expectedCash?: number;
  notes?: string;
  errorMessage: string | null;
  isCloseoutSubmitting?: boolean;
  isReopeningCloseout?: boolean;
  isSubmitting?: boolean;
  onCloseoutCountedCashChange?: (value: string) => void;
  onCloseoutNotesChange?: (value: string) => void;
  onOpeningFloatChange?: (value: string) => void;
  onNotesChange?: (value: string) => void;
  onSubmitCloseout?: () => Promise<void>;
  onReopenRegister?: () => Promise<void>;
  onSubmit?: () => Promise<void>;
  onSignOut: () => Promise<void>;
}

export interface RegisterCloseoutControlState {
  canCloseout: boolean;
  onRequestCloseout: () => void;
}

export interface RegisterAuthDialogState {
  open: boolean;
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
  workflowMode?: RegisterWorkflowMode;
  onAuthenticated: (staffProfileId: Id<"staffProfile">) => void;
  onDismiss: () => void;
}

export type RegisterWorkflowMode = "pos" | "expense";

export interface RegisterViewModel {
  workflowMode?: RegisterWorkflowMode;
  hasActiveStore: boolean;
  header: RegisterHeaderState;
  registerInfo: RegisterInfoState;
  customerPanel: RegisterCustomerPanelState;
  productEntry: RegisterProductEntryState;
  cart: RegisterCartState;
  checkout: RegisterCheckoutState;
  sessionPanel: RegisterSessionPanelState | null;
  cashierCard: RegisterCashierCardState | null;
  drawerGate: RegisterDrawerGateState | null;
  closeoutControl: RegisterCloseoutControlState | null;
  authDialog: RegisterAuthDialogState | null;
  onNavigateBack: () => Promise<void>;
}

export const EMPTY_REGISTER_CUSTOMER_INFO: CustomerInfo = {
  customerProfileId: undefined,
  name: "",
  email: "",
  phone: "",
};

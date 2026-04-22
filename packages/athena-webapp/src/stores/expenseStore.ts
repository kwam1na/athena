import { create } from "zustand";
import { devtools, subscribeWithSelector } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { Id } from "../../convex/_generated/dataModel";
import { CartItem } from "../components/pos/types";
import { calculateCartTotals } from "../lib/pos/services/calculationService";
import { logger } from "../lib/logger";

// State interfaces
interface CartState {
  items: CartItem[];
  subtotal: number;
  tax: number;
  total: number;
}

interface SessionState {
  currentSessionId: string | null;
  activeSession: any | null; // ExpenseSession type
  heldSessions: any[];
  isCreating: boolean;
  isUpdating: boolean;
  expiresAt: number | null;
}

interface TransactionState {
  isCompleting: boolean;
  isCompleted: boolean;
  completedTransactionNumber: string | null;
  completedTransactionData: {
    completedAt: Date;
    cartItems: CartItem[];
    totalValue: number;
    notes?: string;
  } | null;
}

interface UIState {
  showProductEntry: boolean;
  productSearchQuery: string;
  barcodeInput: string;
  isScanning: boolean;
  registerNumber: string;
  notes: string; // Expense reason/description
}

interface CashierState {
  id: Id<"staffProfile"> | null;
  isAuthenticated: boolean;
}

interface ExpenseState {
  // State
  cart: CartState;
  session: SessionState;
  transaction: TransactionState;
  ui: UIState;
  cashier: CashierState;
  storeId?: Id<"store">;
  terminalId?: Id<"posTerminal">;

  // Cart Actions
  addToCart: (item: CartItem) => void;
  updateCartQuantity: (id: Id<"expenseSessionItem">, quantity: number) => void;
  removeFromCart: (id: Id<"expenseSessionItem">) => void;
  clearCart: () => void;
  calculateTotals: () => void;

  // Session Actions
  setCurrentSessionId: (sessionId: string | null) => void;
  setActiveSession: (session: any | null) => void;
  setHeldSessions: (sessions: any[]) => void;
  setSessionCreating: (isCreating: boolean) => void;
  setSessionUpdating: (isUpdating: boolean) => void;
  setSessionExpiresAt: (expiresAt: number | null) => void;
  loadSessionData: (session: any) => void;

  // Transaction Actions
  setTransactionCompleting: (isCompleting: boolean) => void;
  setTransactionCompleted: (
    isCompleted: boolean,
    transactionNumber?: string,
    transactionData?: {
      completedAt: Date;
      cartItems: CartItem[];
      totalValue: number;
      notes?: string;
    }
  ) => void;
  clearTransaction: () => void;
  clearSession: () => void;

  // UI Actions
  setShowProductEntry: (show: boolean) => void;
  setProductSearchQuery: (query: string) => void;
  setBarcodeInput: (input: string) => void;
  setIsScanning: (isScanning: boolean) => void;
  setRegisterNumber: (registerNumber: string) => void;
  setNotes: (notes: string) => void;

  // Cashier Actions
  setCashier: (cashierId: Id<"staffProfile"> | null) => void;
  clearCashier: () => void;

  // Global Actions
  setStoreId: (storeId?: Id<"store">) => void;
  setTerminalId: (terminalId?: Id<"posTerminal">) => void;
  resetAll: () => void;
  startNewTransaction: () => void;
}

// Initial state
const initialState = {
  cart: {
    items: [],
    subtotal: 0,
    tax: 0,
    total: 0,
  },
  session: {
    currentSessionId: null,
    activeSession: null,
    heldSessions: [],
    isCreating: false,
    isUpdating: false,
    expiresAt: null,
  },
  transaction: {
    isCompleting: false,
    isCompleted: false,
    completedTransactionNumber: null,
    completedTransactionData: null,
  },
  ui: {
    showProductEntry: true,
    productSearchQuery: "",
    barcodeInput: "",
    isScanning: false,
    registerNumber: "1",
    notes: "",
  },
  cashier: {
    id: null,
    isAuthenticated: false,
  },
};

export const useExpenseStore = create<ExpenseState>()(
  devtools(
    subscribeWithSelector(
      immer((set, get) => ({
        ...initialState,

        // Cart Actions
        addToCart: (item) =>
          set((state) => {
            const existingItem = state.cart.items.find(
              (cartItem: CartItem) => cartItem.id === item.id
            );

            if (existingItem) {
              existingItem.quantity = item.quantity;
            } else {
              state.cart.items.push(item);
            }

            const totals = calculateCartTotals(state.cart.items);
            state.cart.subtotal = totals.subtotal;
            state.cart.tax = totals.tax;
            state.cart.total = totals.total;
          }),

        updateCartQuantity: (id, quantity) =>
          set((state) => {
            if (quantity <= 0) {
              state.cart.items = state.cart.items.filter(
                (item: CartItem) => item.id !== id
              );
            } else {
              const item = state.cart.items.find(
                (item: CartItem) => item.id === id
              );
              if (item) {
                item.quantity = quantity;
              }
            }

            const totals = calculateCartTotals(state.cart.items);
            state.cart.subtotal = totals.subtotal;
            state.cart.tax = totals.tax;
            state.cart.total = totals.total;
          }),

        removeFromCart: (id) =>
          set((state) => {
            state.cart.items = state.cart.items.filter(
              (item: CartItem) => item.id !== id
            );

            const totals = calculateCartTotals(state.cart.items);
            state.cart.subtotal = totals.subtotal;
            state.cart.tax = totals.tax;
            state.cart.total = totals.total;
          }),

        clearCart: () =>
          set((state) => {
            state.cart.items = [];
            state.cart.subtotal = 0;
            state.cart.tax = 0;
            state.cart.total = 0;
          }),

        clearSession: () =>
          set((state) => {
            state.session.currentSessionId = null;
            state.session.activeSession = null;
            state.session.expiresAt = null;
          }),

        calculateTotals: () =>
          set((state) => {
            const totals = calculateCartTotals(state.cart.items);
            state.cart.subtotal = totals.subtotal;
            state.cart.tax = totals.tax;
            state.cart.total = totals.total;
          }),

        // Session Actions
        setCurrentSessionId: (sessionId) =>
          set((state) => {
            state.session.currentSessionId = sessionId;
          }),

        setActiveSession: (session) =>
          set((state) => {
            state.session.activeSession = session;
          }),

        setHeldSessions: (sessions) =>
          set((state) => {
            state.session.heldSessions = sessions;
          }),

        setSessionCreating: (isCreating) =>
          set((state) => {
            state.session.isCreating = isCreating;
          }),

        setSessionUpdating: (isUpdating) =>
          set((state) => {
            state.session.isUpdating = isUpdating;
          }),

        setSessionExpiresAt: (expiresAt) =>
          set((state) => {
            state.session.expiresAt = expiresAt;
          }),

        setTerminalId: (terminalId) =>
          set((state) => {
            state.terminalId = terminalId;
          }),

        loadSessionData: (session) =>
          set((state) => {
            const now = Date.now();
            if (session.expiresAt && session.expiresAt < now) {
              logger.warn(
                "[Expense] Attempted to load expired session, clearing state",
                {
                  sessionId: session._id,
                  expiresAt: session.expiresAt,
                  now,
                }
              );
              state.session.currentSessionId = null;
              state.session.activeSession = null;
              state.session.expiresAt = null;
              return;
            }

            const sessionCartItems = (session as any).cartItems || [];
            state.cart.items = sessionCartItems.map((item: any) => ({
              id: item._id,
              name: item.productName,
              barcode: item.barcode ?? "",
              sku: item.productSku ?? "",
              price: item.price,
              quantity: item.quantity,
              image: item.image,
              size: item.size,
              length: item.length,
              color: item.color,
              productId: item.productId,
              skuId: item.productSkuId,
            }));

            state.session.currentSessionId = session._id;
            state.session.activeSession = session;
            state.session.expiresAt = session.expiresAt || null;
            state.transaction.isCompleted = false;
            state.ui.notes = session.notes || "";

            const totals = calculateCartTotals(state.cart.items);
            state.cart.subtotal = totals.subtotal;
            state.cart.tax = totals.tax;
            state.cart.total = totals.total;
          }),

        // Transaction Actions
        setTransactionCompleting: (isCompleting) =>
          set((state) => {
            state.transaction.isCompleting = isCompleting;
          }),

        setTransactionCompleted: (
          isCompleted,
          transactionNumber,
          transactionData
        ) =>
          set((state) => {
            state.transaction.isCompleted = isCompleted;
            state.transaction.completedTransactionNumber =
              transactionNumber || null;
            state.transaction.completedTransactionData =
              transactionData || null;
          }),

        clearTransaction: () =>
          set((state) => {
            state.transaction.isCompleted = false;
            state.transaction.completedTransactionNumber = null;
            state.transaction.completedTransactionData = null;
          }),

        // UI Actions
        setShowProductEntry: (show) =>
          set((state) => {
            state.ui.showProductEntry = show;
          }),

        setProductSearchQuery: (query) =>
          set((state) => {
            state.ui.productSearchQuery = query;
          }),

        setBarcodeInput: (input) =>
          set((state) => {
            state.ui.barcodeInput = input;
          }),

        setIsScanning: (isScanning) =>
          set((state) => {
            state.ui.isScanning = isScanning;
          }),

        setRegisterNumber: (registerNumber) =>
          set((state) => {
            state.ui.registerNumber = registerNumber;
          }),

        setNotes: (notes) =>
          set((state) => {
            state.ui.notes = notes;
          }),

        // Cashier Actions
        setCashier: (cashierId) =>
          set((state) => {
            state.cashier.id = cashierId;
            state.cashier.isAuthenticated = !!cashierId;
          }),

        clearCashier: () =>
          set((state) => {
            state.cashier.id = null;
            state.cashier.isAuthenticated = false;
          }),

        // Global Actions
        setStoreId: (storeId) =>
          set((state) => {
            state.storeId = storeId;
          }),

        resetAll: () => set(() => ({ ...initialState })),

        startNewTransaction: () =>
          set((state) => {
            state.cart.items = [];
            state.cart.subtotal = 0;
            state.cart.tax = 0;
            state.cart.total = 0;
            state.session.currentSessionId = null;
            state.session.activeSession = null;
            state.transaction.isCompleted = false;
            state.transaction.isCompleting = false;
            state.transaction.completedTransactionNumber = null;
            state.transaction.completedTransactionData = null;
            state.ui.productSearchQuery = "";
            state.ui.barcodeInput = "";
            state.ui.notes = "";
            state.ui.showProductEntry = true;
          }),
      }))
    ),
    { name: "expense-store" }
  )
);

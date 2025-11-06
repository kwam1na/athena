import { create } from "zustand";
import { devtools, subscribeWithSelector } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { Id } from "../../convex/_generated/dataModel";
import { CartItem, CustomerInfo, Product } from "../components/pos/types";
import { POSSession } from "../../types";
import { calculateCartTotals } from "../lib/pos/services/calculationService";
import { logger } from "../lib/logger";

// State interfaces
interface CartState {
  items: CartItem[];
  subtotal: number;
  tax: number;
  total: number;
}

interface CustomerState {
  current: CustomerInfo | null;
  searchQuery: string;
  searchResults: any[];
  isSearching: boolean;
}

interface SessionState {
  currentSessionId: string | null;
  activeSession: POSSession | null;
  heldSessions: POSSession[];
  isCreating: boolean;
  isUpdating: boolean;
  expiresAt: number | null;
}

interface TransactionState {
  isCompleting: boolean;
  isCompleted: boolean;
  completedOrderNumber: string | null;
  completedTransactionData: {
    paymentMethod: string;
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
}

interface UIState {
  showCustomerPanel: boolean;
  showProductEntry: boolean;
  productSearchQuery: string;
  barcodeInput: string;
  isScanning: boolean;
  registerNumber: string;
}

interface POSState {
  // State
  cart: CartState;
  customer: CustomerState;
  session: SessionState;
  transaction: TransactionState;
  ui: UIState;
  storeId?: Id<"store">;

  // Cart Actions
  addToCart: (item: CartItem) => void;
  updateCartQuantity: (id: Id<"posSessionItem">, quantity: number) => void;
  removeFromCart: (id: Id<"posSessionItem">) => void;
  clearCart: () => void;
  calculateTotals: () => void;

  // Customer Actions
  setCustomer: (customer: CustomerInfo | null) => void;
  clearCustomer: () => void;
  setCustomerSearchQuery: (query: string) => void;
  setCustomerSearchResults: (results: any[]) => void;
  setCustomerSearching: (isSearching: boolean) => void;

  // Session Actions
  setCurrentSessionId: (sessionId: string | null) => void;
  setActiveSession: (session: POSSession | null) => void;
  setHeldSessions: (sessions: POSSession[]) => void;
  setSessionCreating: (isCreating: boolean) => void;
  setSessionUpdating: (isUpdating: boolean) => void;
  setSessionExpiresAt: (expiresAt: number | null) => void;
  loadSessionData: (session: POSSession) => void;

  // Transaction Actions
  setTransactionCompleting: (isCompleting: boolean) => void;
  setTransactionCompleted: (
    isCompleted: boolean,
    orderNumber?: string,
    transactionData?: {
      paymentMethod: string;
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
    }
  ) => void;
  clearTransaction: () => void;

  // UI Actions
  setShowCustomerPanel: (show: boolean) => void;
  setShowProductEntry: (show: boolean) => void;
  setProductSearchQuery: (query: string) => void;
  setBarcodeInput: (input: string) => void;
  setIsScanning: (isScanning: boolean) => void;
  setRegisterNumber: (registerNumber: string) => void;

  // Global Actions
  setStoreId: (storeId?: Id<"store">) => void;
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
  customer: {
    current: null,
    searchQuery: "",
    searchResults: [],
    isSearching: false,
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
    completedOrderNumber: null,
    completedTransactionData: null,
  },
  ui: {
    showCustomerPanel: false,
    showProductEntry: true,
    productSearchQuery: "",
    barcodeInput: "",
    isScanning: false,
    registerNumber: "1",
  },
};

export const usePOSStore = create<POSState>()(
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

            // Recalculate totals within the same state update
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

            // Recalculate totals within the same state update
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

            // Recalculate totals within the same state update
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

        calculateTotals: () =>
          set((state) => {
            const totals = calculateCartTotals(state.cart.items);
            state.cart.subtotal = totals.subtotal;
            state.cart.tax = totals.tax;
            state.cart.total = totals.total;
          }),

        // Customer Actions
        setCustomer: (customer) =>
          set((state) => {
            state.customer.current = customer;
          }),

        clearCustomer: () =>
          set((state) => {
            state.customer.current = null;
          }),

        setCustomerSearchQuery: (query) =>
          set((state) => {
            state.customer.searchQuery = query;
          }),

        setCustomerSearchResults: (results) =>
          set((state) => {
            state.customer.searchResults = results;
          }),

        setCustomerSearching: (isSearching) =>
          set((state) => {
            state.customer.isSearching = isSearching;
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

        loadSessionData: (session) =>
          set((state) => {
            // Check if session has expired before loading
            const now = Date.now();
            if (session.expiresAt && session.expiresAt < now) {
              logger.warn(
                "[POS] Attempted to load expired session, clearing state",
                {
                  sessionId: session._id,
                  expiresAt: session.expiresAt,
                  now,
                }
              );
              // Clear session state instead of loading expired session
              state.session.currentSessionId = null;
              state.session.activeSession = null;
              state.session.expiresAt = null;
              return;
            }

            // Load cart items from session
            const sessionCartItems = (session as any).cartItems || [];
            state.cart.items = sessionCartItems.map((item: any) => ({
              id: item._id, // Database ID is the single source of truth
              name: item.productName,
              barcode: item.productSku,
              sku: item.productSku, // Use productSku as the SKU display value
              price: item.price,
              quantity: item.quantity,
              image: item.image,
              size: item.size,
              length: item.length,
              productId: item.productId,
              skuId: item.productSkuId,
              areProcessingFeesAbsorbed: item.areProcessingFeesAbsorbed,
            }));

            // Load customer info
            if (session.customerInfo) {
              state.customer.current = {
                customerId: session.customerId,
                name: session.customerInfo.name || "",
                email: session.customerInfo.email || "",
                phone: session.customerInfo.phone || "",
              };
            }

            state.session.currentSessionId = session._id;
            state.session.activeSession = session;
            state.session.expiresAt = session.expiresAt || null;
            state.transaction.isCompleted = false;

            // Recalculate totals within the same state update
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

        setTransactionCompleted: (isCompleted, orderNumber, transactionData) =>
          set((state) => {
            state.transaction.isCompleted = isCompleted;
            state.transaction.completedOrderNumber = orderNumber || null;
            state.transaction.completedTransactionData =
              transactionData || null;
          }),

        clearTransaction: () =>
          set((state) => {
            state.transaction.isCompleted = false;
            state.transaction.completedOrderNumber = null;
            state.transaction.completedTransactionData = null;
          }),

        // UI Actions
        setShowCustomerPanel: (show) =>
          set((state) => {
            state.ui.showCustomerPanel = show;
          }),

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
            state.customer.current = null;
            state.session.currentSessionId = null;
            state.session.activeSession = null;
            state.transaction.isCompleted = false;
            state.transaction.completedOrderNumber = null;
            state.transaction.completedTransactionData = null;
            state.ui.productSearchQuery = "";
            state.ui.barcodeInput = "";
            state.ui.showCustomerPanel = false;
          }),
      }))
    ),
    { name: "pos-store" }
  )
);

// Selectors for derived state
export const posSelectors = {
  // Cart selectors
  getCartItems: (state: POSState) => state.cart.items,
  getCartTotal: (state: POSState) => state.cart.total,
  getCartSubtotal: (state: POSState) => state.cart.subtotal,
  getCartTax: (state: POSState) => state.cart.tax,
  getCartItemCount: (state: POSState) =>
    state.cart.items.reduce((sum, item) => sum + item.quantity, 0),
  isCartEmpty: (state: POSState) => state.cart.items.length === 0,

  // Customer selectors
  getCurrentCustomer: (state: POSState) => state.customer.current,
  hasCustomer: (state: POSState) => !!state.customer.current,
  getCustomerSearchQuery: (state: POSState) => state.customer.searchQuery,

  // Session selectors
  getCurrentSessionId: (state: POSState) => state.session.currentSessionId,
  getActiveSession: (state: POSState) => state.session.activeSession,
  hasActiveSession: (state: POSState) => !!state.session.activeSession,
  getHeldSessions: (state: POSState) => state.session.heldSessions,
  hasHeldSessions: (state: POSState) => state.session.heldSessions.length > 0,
  getSessionExpiresAt: (state: POSState) => state.session.expiresAt,
  isSessionExpiringSoon: (state: POSState) => {
    const expiresAt = state.session.expiresAt;
    if (!expiresAt) return false;
    const now = Date.now();
    const twoMinutes = 2 * 60 * 1000;
    return expiresAt - now < twoMinutes && expiresAt > now;
  },

  // Transaction selectors
  isTransactionCompleted: (state: POSState) => state.transaction.isCompleted,
  isTransactionCompleting: (state: POSState) => state.transaction.isCompleting,
  getCompletedOrderNumber: (state: POSState) =>
    state.transaction.completedOrderNumber,

  // UI selectors
  isCustomerPanelOpen: (state: POSState) => state.ui.showCustomerPanel,
  isProductEntryOpen: (state: POSState) => state.ui.showProductEntry,
  getProductSearchQuery: (state: POSState) => state.ui.productSearchQuery,
  getBarcodeInput: (state: POSState) => state.ui.barcodeInput,
  getRegisterNumber: (state: POSState) => state.ui.registerNumber,

  // Global selectors
  getStoreId: (state: POSState) => state.storeId,
};

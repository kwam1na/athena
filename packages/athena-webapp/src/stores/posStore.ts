import { create } from "zustand";
import { devtools, subscribeWithSelector } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { Id } from "../../convex/_generated/dataModel";
import { CartItem, CustomerInfo, Product } from "../components/pos/types";
import { POSSession } from "../../types";

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
  storeId: Id<"store"> | null;

  // Cart Actions
  addToCart: (item: Omit<CartItem, "id">) => void;
  updateCartQuantity: (id: string, quantity: number) => void;
  removeFromCart: (id: string) => void;
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
  setStoreId: (storeId: Id<"store"> | null) => void;
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
  storeId: null,
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
              (cartItem: CartItem) => cartItem.barcode === item.barcode
            );

            if (existingItem) {
              existingItem.quantity += 1;
            } else {
              state.cart.items.push({
                ...item,
                id:
                  Date.now().toString() +
                  Math.random().toString(36).substr(2, 9),
              });
            }

            // Recalculate totals within the same state update
            console.log(
              "🧮 calculateTotals in addToCart, cart items:",
              state.cart.items.map((item) => ({
                name: item.name,
                price: item.price,
                quantity: item.quantity,
                lineTotal: item.price * item.quantity,
              }))
            );

            const subtotal = state.cart.items.reduce(
              (sum: number, item: CartItem) => sum + item.price * item.quantity,
              0
            );

            // Tax calculation would come from store config
            const tax = 0; // TODO: Get from store config
            const total = subtotal + tax;

            console.log("🧮 Calculated totals in addToCart:", {
              subtotal,
              tax,
              total,
            });

            state.cart.subtotal = subtotal;
            state.cart.tax = tax;
            state.cart.total = total;
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
            const subtotal = state.cart.items.reduce(
              (sum: number, item: CartItem) => sum + item.price * item.quantity,
              0
            );

            const tax = 0; // TODO: Get from store config
            const total = subtotal + tax;

            state.cart.subtotal = subtotal;
            state.cart.tax = tax;
            state.cart.total = total;
          }),

        removeFromCart: (id) =>
          set((state) => {
            state.cart.items = state.cart.items.filter(
              (item: CartItem) => item.id !== id
            );

            // Recalculate totals within the same state update
            const subtotal = state.cart.items.reduce(
              (sum: number, item: CartItem) => sum + item.price * item.quantity,
              0
            );

            const tax = 0; // TODO: Get from store config
            const total = subtotal + tax;

            state.cart.subtotal = subtotal;
            state.cart.tax = tax;
            state.cart.total = total;
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
            console.log(
              "🧮 calculateTotals called, cart items:",
              state.cart.items.map((item) => ({
                name: item.name,
                price: item.price,
                quantity: item.quantity,
                lineTotal: item.price * item.quantity,
              }))
            );

            const subtotal = state.cart.items.reduce(
              (sum: number, item: CartItem) => sum + item.price * item.quantity,
              0
            );

            // Tax calculation would come from store config
            const tax = 0; // TODO: Get from store config
            const total = subtotal + tax;

            console.log("🧮 Calculated totals:", { subtotal, tax, total });

            state.cart.subtotal = subtotal;
            state.cart.tax = tax;
            state.cart.total = total;
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

        loadSessionData: (session) =>
          set((state) => {
            // Load cart items from session
            state.cart.items = session.cartItems.map((item) => ({
              id: item.id,
              name: item.name,
              barcode: item.barcode,
              price: item.price,
              quantity: item.quantity,
              image: item.image,
              size: item.size,
              length: item.length,
              skuId: item.skuId,
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
            state.transaction.isCompleted = false;

            // Recalculate totals
            get().calculateTotals();
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
  getCartItemCount: (state: POSState) => state.cart.items.length,
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

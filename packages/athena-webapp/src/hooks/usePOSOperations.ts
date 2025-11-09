import { useCallback, useEffect, useMemo } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { usePOSStore, posSelectors } from "../stores/posStore";
import { Product, CustomerInfo } from "../components/pos/types";
import { Id } from "../../convex/_generated/dataModel";
import { usePOSCustomerUpdate } from "./usePOSCustomers";
import { generateTransactionNumber } from "../lib/pos/transactionUtils";
import { logger } from "../lib/logger";
import { validateCart, validateSession } from "../lib/pos/validation";
import {
  handlePOSOperation,
  POS_MESSAGES,
  showValidationError,
  showNoActiveSessionError,
  showInventoryError,
} from "../lib/pos/toastService";
import { usePOSActiveSession } from "./usePOSSessions";
import { POSSession } from "~/types";

/**
 * Unified hook for POS operations
 * Provides easy access to all POS business logic through service layer
 */
export const usePOSOperations = () => {
  const store = usePOSStore();

  // Convex mutations
  const createSessionMutation = useMutation(
    api.inventory.posSessions.createSession
  );
  const updateSessionMutation = useMutation(
    api.inventory.posSessions.updateSession
  );
  const holdSessionMutation = useMutation(
    api.inventory.posSessions.holdSession
  );
  const resumeSessionMutation = useMutation(
    api.inventory.posSessions.resumeSession
  );
  const completeSessionMutation = useMutation(
    api.inventory.posSessions.completeSession
  );
  const completeTransactionMutation = useMutation(
    api.inventory.pos.completeTransaction
  );
  const createCustomerMutation = useMutation(
    api.inventory.posCustomers.createCustomer
  );
  // Item mutations
  const addOrUpdateItemMutation = useMutation(
    api.inventory.posSessionItems.addOrUpdateItem
  );
  const removeItemMutation = useMutation(
    api.inventory.posSessionItems.removeItem
  );

  // Customer operations hooks
  const updateCustomerHook = usePOSCustomerUpdate();

  // Transaction Operations
  const transactionOperations = {
    processPayment: useCallback(
      async (paymentMethod: string, session: POSSession) => {
        try {
          // Validate cart first
          const cartValidation = validateCart(store.cart.items);
          if (!cartValidation.isValid) {
            showValidationError(cartValidation.errors);
            return {
              success: false,
              error: cartValidation.errors.join(", "),
            };
          }

          const sessionValidation = validateSession(
            session,
            store.session.expiresAt
          );

          if (!sessionValidation.isValid) {
            showValidationError(sessionValidation.errors);
            return {
              success: false,
              error: sessionValidation.errors.join(", "),
            };
          }

          const sessionId = store.session.currentSessionId;

          if (sessionId) {
            // Session-based transaction completion
            logger.debug("Processing session-based transaction", { sessionId });

            // Capture final totals at completion time for audit integrity
            const finalSubtotal = store.cart.subtotal;
            const finalTax = store.cart.tax;
            const finalTotal = store.cart.total;

            const completeResult = await completeSessionMutation({
              sessionId: sessionId as Id<"posSession">,
              paymentMethod,
              amountPaid: finalTotal,
              notes: `Register: ${store.ui.registerNumber}`,
              // Explicitly pass final transaction totals
              subtotal: finalSubtotal,
              tax: finalTax,
              total: finalTotal,
            });

            if (!completeResult.success) {
              logger.error("Failed to complete session", {
                sessionId,
                message: completeResult.message,
              });
              showValidationError([completeResult.message]);
              return {
                success: false,
                error: completeResult.message,
              };
            }

            // Generate POS transaction number using extracted utility
            const transactionNumber = generateTransactionNumber();

            // Update transaction state
            store.setTransactionCompleted(true, transactionNumber, {
              paymentMethod,
              completedAt: new Date(),
              cartItems: store.cart.items,
              subtotal: store.cart.subtotal,
              tax: store.cart.tax,
              total: store.cart.total,
              customerInfo: store.customer.current
                ? {
                    name: store.customer.current.name,
                    email: store.customer.current.email,
                    phone: store.customer.current.phone,
                  }
                : undefined,
            });

            // Clear session state
            store.setCurrentSessionId(null);
            store.setActiveSession(null);

            // toast.success(`Transaction completed! Order: ${transactionNumber}`);

            return {
              success: true,
              transactionNumber,
            };
          } else {
            // Direct transaction completion
            logger.debug("Processing direct transaction");

            if (!store.storeId) {
              throw new Error("Store ID not set");
            }

            const transactionData = {
              storeId: store.storeId,
              items: store.cart.items
                .filter((item) => item.skuId)
                .map((item) => ({
                  skuId: item.skuId!,
                  quantity: item.quantity,
                  price: item.price,
                  name: item.name,
                  barcode: item.barcode,
                  sku: item.sku || "",
                })),
              paymentMethod,
              subtotal: store.cart.subtotal,
              tax: store.cart.tax,
              total: store.cart.total,
              customerId: store.customer.current?.customerId,
              customerInfo: store.customer.current
                ? {
                    name: store.customer.current.name,
                    email: store.customer.current.email,
                    phone: store.customer.current.phone,
                  }
                : undefined,
              registerNumber: store.ui.registerNumber,
            };

            logger.debug("Transaction data prepared", {
              itemCount: transactionData.items.length,
              hasCustomer: !!transactionData.customerId,
            });

            const result = await completeTransactionMutation(transactionData);

            if (result.success) {
              logger.info("Transaction completed successfully", {
                transactionNumber: result.transactionNumber,
              });

              // Update transaction state
              store.setTransactionCompleted(true, result.transactionNumber, {
                paymentMethod,
                completedAt: new Date(),
                cartItems: store.cart.items,
                subtotal: store.cart.subtotal,
                tax: store.cart.tax,
                total: store.cart.total,
                customerInfo: store.customer.current
                  ? {
                      name: store.customer.current.name,
                      email: store.customer.current.email,
                      phone: store.customer.current.phone,
                    }
                  : undefined,
              });

              return {
                success: true,
                transactionNumber: result.transactionNumber,
              };
            } else {
              logger.error(
                "Transaction failed",
                new Error(result.error || "Unknown error")
              );
              showValidationError([
                result.error || POS_MESSAGES.transaction.failed,
              ]);
              return {
                success: false,
                error: result.error,
              };
            }
          }
        } catch (error) {
          // Error already handled above or by underlying operations
          return {
            success: false,
            error: (error as Error).message,
          };
        } finally {
          store.setTransactionCompleting(false);
        }
      },
      [
        validateCart,
        completeSessionMutation,
        completeTransactionMutation,
        store,
      ]
    ),

    startNewTransaction: useCallback(() => {
      store.startNewTransaction();
    }, [store]),

    // Note: Print functionality is handled by the usePrint hook in the UI component
    // This method is kept for backward compatibility but should not be used directly
    printReceipt: useCallback(() => {
      logger.warn(
        "Print receipt requested - this should be handled by the UI component using usePrint hook"
      );
      // Info message for dev purposes - no toast needed
    }, []),
  };

  // Customer Operations
  const customerOperations = {
    searchCustomers: useCallback(
      async (query: string) => {
        try {
          if (!query.trim()) {
            store.setCustomerSearchResults([]);
            store.setCustomerSearching(false);
            store.setCustomerSearchQuery("");
            return;
          }

          store.setCustomerSearching(true);
          store.setCustomerSearchQuery(query);

          // Note: Results are handled by the real-time Convex query in useCustomerOperations hook
          // This function is kept for backward compatibility but delegates to the query hook
        } catch (error) {
          logger.error("Failed to search customers", error as Error);
          store.setCustomerSearchResults([]);
          showValidationError([POS_MESSAGES.customer.searchFailed]);
          store.setCustomerSearching(false);
        }
      },
      [store]
    ),

    selectCustomer: useCallback(
      (customer: CustomerInfo) => {
        store.setCustomer(customer);
        store.setCustomerSearchQuery("");
        store.setCustomerSearchResults([]);
        store.setShowCustomerPanel(false);
        // toast.success(`Selected customer: ${customer.name}`);
      },
      [store]
    ),

    updateCustomerInfo: useCallback(
      (customer: CustomerInfo) => {
        // Update customer info without closing the panel (for form inputs)
        store.setCustomer(customer);
      },
      [store]
    ),

    createCustomer: useCallback(
      async (customerData: Omit<CustomerInfo, "customerId">) => {
        try {
          if (!store.storeId) {
            throw new Error("Store ID not set");
          }

          const result = await createCustomerMutation({
            storeId: store.storeId,
            name: customerData.name || "",
            email: customerData.email || "",
            phone: customerData.phone || "",
          });

          const newCustomer: CustomerInfo = {
            customerId: result._id,
            name: result.name,
            email: result.email || "",
            phone: result.phone || "",
          };

          // Set as current customer and close panel
          store.setCustomer(newCustomer);
          store.setShowCustomerPanel(false);

          // Success toast shown by underlying operation if needed
          // toast.success(POS_MESSAGES.customer.created(newCustomer.name));

          return {
            success: true,
            customer: newCustomer,
          };
        } catch (error) {
          // Error already shown by underlying operation
          return {
            success: false,
            error: (error as Error).message,
          };
        }
      },
      [createCustomerMutation, store]
    ),

    clearCustomer: useCallback(() => {
      store.clearCustomer();
      //   toast.success("Customer cleared");
    }, [store]),

    updateCustomer: useCallback(
      async (customer: CustomerInfo) => {
        try {
          if (!customer.customerId) {
            throw new Error("Cannot update customer without ID");
          }

          const result = await updateCustomerHook(customer.customerId, {
            name: customer.name,
            email: customer.email,
            phone: customer.phone,
          });

          if (result.success) {
            // Update the current customer in the store
            store.setCustomer(customer);
            // Success toast shown by underlying operation
            return { success: true };
          } else {
            // Error already shown by underlying operation
            return { success: false, error: result.error };
          }
        } catch (error) {
          const errorMessage = (error as Error).message;
          // Error already shown by underlying operation
          return { success: false, error: errorMessage };
        }
      },
      [updateCustomerHook, store]
    ),
  };

  // UI Operations
  const uiOperations = {
    setShowCustomerPanel: useCallback(
      (show: boolean) => {
        store.setShowCustomerPanel(show);
      },
      [store]
    ),

    setShowProductEntry: useCallback(
      (show: boolean) => {
        store.setShowProductEntry(show);
      },
      [store]
    ),

    setProductSearchQuery: useCallback(
      (query: string) => {
        store.setProductSearchQuery(query);
      },
      [store]
    ),

    setBarcodeInput: useCallback(
      (input: string) => {
        store.setBarcodeInput(input);
      },
      [store]
    ),

    setIsScanning: useCallback(
      (isScanning: boolean) => {
        store.setIsScanning(isScanning);
      },
      [store]
    ),

    setRegisterNumber: useCallback(
      (registerNumber: string) => {
        store.setRegisterNumber(registerNumber);
      },
      [store]
    ),
  };

  // State selectors (derived from store)
  const state = {
    // Cart state
    cartItems: posSelectors.getCartItems(store),
    cartTotal: posSelectors.getCartTotal(store),
    cartSubtotal: posSelectors.getCartSubtotal(store),
    cartTax: posSelectors.getCartTax(store),
    cartItemCount: posSelectors.getCartItemCount(store),
    isCartEmpty: posSelectors.isCartEmpty(store),

    // Customer state
    currentCustomer: posSelectors.getCurrentCustomer(store),
    hasCustomer: posSelectors.hasCustomer(store),
    customerSearchQuery: posSelectors.getCustomerSearchQuery(store),

    // Session state
    currentSessionId: posSelectors.getCurrentSessionId(store),
    activeSession: posSelectors.getActiveSession(store),
    hasActiveSession: posSelectors.hasActiveSession(store),
    heldSessions: posSelectors.getHeldSessions(store),
    hasHeldSessions: posSelectors.hasHeldSessions(store),

    // Transaction state
    isTransactionCompleted: posSelectors.isTransactionCompleted(store),
    isTransactionCompleting: posSelectors.isTransactionCompleting(store),
    completedOrderNumber: posSelectors.getCompletedOrderNumber(store),
    transaction: store.transaction,

    // UI state
    isCustomerPanelOpen: posSelectors.isCustomerPanelOpen(store),
    isProductEntryOpen: posSelectors.isProductEntryOpen(store),
    productSearchQuery: posSelectors.getProductSearchQuery(store),
    barcodeInput: posSelectors.getBarcodeInput(store),
    isScanning: store.ui.isScanning,
    registerNumber: posSelectors.getRegisterNumber(store),

    // Global state
    storeId: posSelectors.getStoreId(store),
  };

  // Store Operations
  const storeOperations = {
    setStoreId: useCallback(
      (storeId?: Id<"store">) => {
        store.setStoreId(storeId);
      },
      [store]
    ),

    loadSessionData: useCallback(
      (sessionData: any) => {
        store.loadSessionData(sessionData);
      },
      [store]
    ),

    startNewTransaction: useCallback(() => {
      store.startNewTransaction();
    }, [store]),

    resetAll: useCallback(() => {
      store.resetAll();
    }, [store]),

    setTransactionCompleted: useCallback(
      (isCompleted: boolean) => {
        store.setTransactionCompleting(false);
        if (!isCompleted) {
          store.clearTransaction();
        }
      },
      [store]
    ),
  };

  return {
    transaction: transactionOperations,
    customer: customerOperations,
    ui: uiOperations,
    store: storeOperations,

    // State
    state,

    // Raw store access (for advanced use cases)
    rawStore: store,
  };
};

/**
 * Hook for POS state only (without operations)
 * Useful for components that only need to read state
 */
export const usePOSState = () => {
  const store = usePOSStore();

  return {
    // Cart state
    cartItems: posSelectors.getCartItems(store),
    cartTotal: posSelectors.getCartTotal(store),
    cartSubtotal: posSelectors.getCartSubtotal(store),
    cartTax: posSelectors.getCartTax(store),
    cartItemCount: posSelectors.getCartItemCount(store),
    isCartEmpty: posSelectors.isCartEmpty(store),

    // Customer state
    currentCustomer: posSelectors.getCurrentCustomer(store),
    hasCustomer: posSelectors.hasCustomer(store),
    customerSearchQuery: posSelectors.getCustomerSearchQuery(store),

    // Session state
    currentSessionId: posSelectors.getCurrentSessionId(store),
    activeSession: posSelectors.getActiveSession(store),
    hasActiveSession: posSelectors.hasActiveSession(store),
    heldSessions: posSelectors.getHeldSessions(store),
    hasHeldSessions: posSelectors.hasHeldSessions(store),

    // Transaction state
    isTransactionCompleted: posSelectors.isTransactionCompleted(store),
    isTransactionCompleting: posSelectors.isTransactionCompleting(store),
    completedOrderNumber: posSelectors.getCompletedOrderNumber(store),

    // UI state
    isCustomerPanelOpen: posSelectors.isCustomerPanelOpen(store),
    isProductEntryOpen: posSelectors.isProductEntryOpen(store),
    productSearchQuery: posSelectors.getProductSearchQuery(store),
    barcodeInput: posSelectors.getBarcodeInput(store),
    registerNumber: posSelectors.getRegisterNumber(store),

    // Global state
    storeId: posSelectors.getStoreId(store),
  };
};

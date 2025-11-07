import { useCallback, useEffect, useMemo } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { usePOSStore, posSelectors } from "../stores/posStore";
import { Product, CustomerInfo } from "../components/pos/types";
import { Id } from "../../convex/_generated/dataModel";
import { usePOSCustomerUpdate } from "./usePOSCustomers";
import { generateTransactionNumber } from "../lib/pos/transactionUtils";
import { logger } from "../lib/logger";
import { validateSession } from "../lib/pos/validation";
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

  const activeSession = usePOSActiveSession(store.storeId);

  // Auto-update session when customer data changes
  useEffect(() => {
    const updateSessionWithCustomer = async () => {
      const sessionId = store.session.currentSessionId;
      if (!sessionId || !store.customer.current) return;

      try {
        logger.debug("Auto-updating session with customer data", {
          customerId: store.customer.current.customerId,
        });

        await updateSessionMutation({
          sessionId: sessionId as Id<"posSession">,
          customerId: store.customer.current.customerId,
          customerInfo: {
            name: store.customer.current.name,
            email: store.customer.current.email,
            phone: store.customer.current.phone,
          },
          subtotal: store.cart.subtotal,
          tax: store.cart.tax,
          total: store.cart.total,
        });

        logger.debug("Session updated with customer data");
      } catch (error) {
        logger.error(
          "Failed to update session with customer data",
          error as Error
        );
      }
    };

    // Only update if we have both a session and customer
    if (store.session.currentSessionId && store.customer.current) {
      updateSessionWithCustomer();
    }
  }, [
    store.customer.current?.customerId,
    store.session.currentSessionId,
    updateSessionMutation,
    store,
  ]);

  // Helper function to auto-update session (metadata only)
  const autoUpdateSession = useCallback(async () => {
    const sessionId = store.session.currentSessionId;
    if (!sessionId) return;

    try {
      const result = await updateSessionMutation({
        sessionId: sessionId as Id<"posSession">,
        customerInfo: store.customer.current
          ? {
              name: store.customer.current.name,
              email: store.customer.current.email,
              phone: store.customer.current.phone,
            }
          : undefined,
        subtotal: store.cart.subtotal,
        tax: store.cart.tax,
        total: store.cart.total,
      });

      // Update session expiration time from server
      store.setSessionExpiresAt(result.expiresAt);
    } catch (error) {
      logger.error("Failed to auto-update session", error as Error);
      // Don't throw - this is a background operation
    }
  }, [store, updateSessionMutation]);

  // Helper function to auto-create session
  const autoCreateSession = useCallback(async () => {
    if (!store.storeId) {
      throw new Error("Store ID not set");
    }

    try {
      logger.debug("Auto-creating session for first cart item");

      const result = await createSessionMutation({
        storeId: store.storeId,
        registerNumber: store.ui.registerNumber,
      });

      store.setCurrentSessionId(result.sessionId);
      store.setSessionExpiresAt(result.expiresAt);
      logger.debug("Session created", {
        sessionId: result.sessionId,
        expiresAt: result.expiresAt,
      });

      return result.sessionId;
    } catch (error) {
      logger.error("Failed to auto-create session", error as Error);
      throw error;
    }
  }, [store, createSessionMutation]);

  // Helper function to validate cart
  const validateCart = useCallback(() => {
    const items = store.cart.items;
    const errors: string[] = [];

    if (items.length === 0) {
      errors.push("Cart is empty");
    }

    // Check for items without SKU IDs
    const itemsWithoutSkuId = items.filter((item) => !item.skuId);
    if (itemsWithoutSkuId.length > 0) {
      errors.push("Some items are missing product information");
    }

    // Check for invalid quantities
    const invalidQuantities = items.filter((item) => item.quantity <= 0);
    if (invalidQuantities.length > 0) {
      errors.push("Some items have invalid quantities");
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }, [store]);

  // Individual cart operation functions
  const addProduct = useCallback(
    async (product: Product) => {
      // Validate product data
      if (!product.skuId) {
        showValidationError([POS_MESSAGES.validation.missingSkuId]);
        return;
      }

      if (product.price <= 0) {
        showValidationError([POS_MESSAGES.validation.invalidPrice]);
        return;
      }

      if (!product.productId) {
        showValidationError([POS_MESSAGES.validation.missingProductId]);
        return;
      }

      // Auto-create session if this is the first item
      let sessionId = store.session.currentSessionId;
      if (!sessionId) {
        try {
          sessionId = await autoCreateSession();
        } catch (error) {
          showValidationError([POS_MESSAGES.errors.sessionCreationFailed]);
          logger.error("Failed to create session", error as Error);
          return;
        }
      }

      // Check if item already exists in cart by SKU ID
      const existingItem = store.cart.items.find(
        (item) => item.skuId === product.skuId
      );
      const newQuantity = existingItem ? existingItem.quantity + 1 : 1;

      // Call server mutation to add/update item with inventory hold
      const result = await addOrUpdateItemMutation({
        sessionId: sessionId as Id<"posSession">,
        productId: product.productId,
        productSkuId: product.skuId,
        productSku: product.sku || "",
        barcode: product.barcode || undefined,
        productName: product.name,
        price: product.price, // Backend returns netPrice or price
        quantity: newQuantity,
        image: product.image || undefined,
        size: product.size || undefined,
        length: product.length || undefined,
        areProcessingFeesAbsorbed: product.areProcessingFeesAbsorbed,
      });

      // Handle result
      if (!result.success) {
        showValidationError([result.message]);
        logger.error("Failed to add product to cart", {
          message: result.message,
        });
        return;
      }

      // Update local store with the database ID
      if (existingItem) {
        store.updateCartQuantity(existingItem.id, newQuantity);
      } else {
        store.addToCart({
          id: result.data.itemId, // Database ID is the cart item ID
          name: product.name,
          barcode: product.barcode || "",
          sku: product.sku || "",
          price: product.price, // Backend returns netPrice or price
          quantity: 1,
          image: product.image || undefined,
          size: product.size || undefined,
          length: product.length,
          productId: product.productId,
          skuId: product.skuId,
          areProcessingFeesAbsorbed: product.areProcessingFeesAbsorbed,
        });
      }

      // Update session expiration time
      store.setSessionExpiresAt(result.data.expiresAt);

      // Update session metadata (totals, customer)
      await autoUpdateSession();
    },
    [store, autoCreateSession, autoUpdateSession, addOrUpdateItemMutation]
  );

  const addFromBarcode = useCallback(
    async (barcode: string, productData: Product) => {
      try {
        if (!barcode.trim()) {
          throw new Error("Invalid barcode");
        }

        if (!productData) {
          throw new Error(`Product not found for barcode: ${barcode}`);
        }

        await addProduct(productData);
      } catch (error) {
        // Error already shown by addProduct
      }
    },
    [addProduct]
  );

  const updateQuantity = useCallback(
    async (itemId: Id<"posSessionItem">, quantity: number) => {
      if (quantity < 0) {
        showValidationError([POS_MESSAGES.cart.quantityNegative]);
        return;
      }

      const sessionId = store.session.currentSessionId;
      if (!sessionId) {
        showNoActiveSessionError("update quantities");
        return;
      }

      const item = store.cart.items.find((item) => item.id === itemId);
      if (!item || !item.skuId) {
        showValidationError([POS_MESSAGES.cart.itemNotFound]);
        return;
      }

      // Ensure we have a productId
      if (!item.productId) {
        showValidationError([POS_MESSAGES.validation.missingProductId]);
        return;
      }

      // Call server mutation to update quantity with inventory hold
      const result = await addOrUpdateItemMutation({
        sessionId: sessionId as Id<"posSession">,
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
        areProcessingFeesAbsorbed: item.areProcessingFeesAbsorbed,
      });

      // Handle result
      if (!result.success) {
        showValidationError([result.message]);
        logger.error("Failed to update quantity", { message: result.message });
        return;
      }

      // Update local store after successful server update
      store.updateCartQuantity(itemId, quantity);

      // Update session expiration time
      store.setSessionExpiresAt(result.data.expiresAt);

      // Update session metadata (totals)
      await autoUpdateSession();
    },
    [store, autoUpdateSession, addOrUpdateItemMutation]
  );

  const removeItem = useCallback(
    async (itemId: Id<"posSessionItem">) => {
      const sessionId = store.session.currentSessionId;
      if (!sessionId) {
        showNoActiveSessionError("remove items");
        return;
      }

      const item = store.cart.items.find((item) => item.id === itemId);
      if (!item) {
        showValidationError([POS_MESSAGES.cart.itemNotFound]);
        return;
      }

      // Call server mutation to remove item and release inventory hold
      const result = await removeItemMutation({
        sessionId: sessionId as Id<"posSession">,
        itemId, // itemId is already the database ID
      });

      // Handle result
      if (!result.success) {
        showValidationError([result.message]);
        logger.error("Failed to remove item", { message: result.message });
        return;
      }

      // Update local store after successful server update
      store.removeFromCart(itemId);

      // Update session expiration time
      store.setSessionExpiresAt(result.data.expiresAt);

      // Update session metadata (totals)
      await autoUpdateSession();

      // Silent removal for better UX (can show toast if needed)
      // toast.success(POS_MESSAGES.cart.itemRemoved);
    },
    [store, autoUpdateSession, removeItemMutation]
  );

  const clearCart = useCallback(() => {
    store.clearCart();
    // toast.success("Cart cleared");
  }, [store]);

  // Cart Operations object
  const cartOperations = {
    addProduct,
    addFromBarcode,
    updateQuantity,
    removeItem,
    clearCart,
    validateCart,
  };

  // Session Operations
  const sessionOperations = {
    createSession: useCallback(
      async (storeId: Id<"store">) => {
        try {
          store.setSessionCreating(true);

          const result = await createSessionMutation({
            storeId,
            registerNumber: store.ui.registerNumber,
          });

          store.setCurrentSessionId(result.sessionId);
          store.setSessionExpiresAt(result.expiresAt);
          // Success toast shown by underlying operation if needed
          // toast.success(POS_MESSAGES.session.created);

          return result.sessionId;
        } catch (error) {
          // Error already shown by underlying operation
          throw error;
        } finally {
          store.setSessionCreating(false);
        }
      },
      [createSessionMutation, store]
    ),

    updateSession: useCallback(async () => {
      try {
        await autoUpdateSession();
      } catch (error) {
        logger.error("Failed to update session", error as Error);
        // Don't show toast for automatic updates
      }
    }, [autoUpdateSession]),

    holdSession: useCallback(
      async (reason?: string) => {
        try {
          const sessionId = store.session.currentSessionId;
          if (!sessionId) {
            throw new Error("No active session to hold");
          }

          await holdSessionMutation({
            sessionId: sessionId as Id<"posSession">,
            holdReason: reason,
          });

          // Clear current session state
          store.setCurrentSessionId(null);
          store.setActiveSession(null);

          // Success toast shown by underlying operation
        } catch (error) {
          // Error already shown by underlying operation
        }
      },
      [holdSessionMutation, store]
    ),

    resumeSession: useCallback(
      async (sessionId: string) => {
        try {
          const result = await resumeSessionMutation({
            sessionId: sessionId as Id<"posSession">,
          });

          if (!result.success) {
            // Provide user-friendly error messages for inventory issues
            if (result.message.includes("no longer available")) {
              showInventoryError(result.message);
            } else {
              showValidationError([result.message]);
            }

            logger.error("Failed to resume session", {
              sessionId,
              message: result.message,
            });
            return;
          }

          // Update expiration time from server
          store.setSessionExpiresAt(result.data.expiresAt);

          // Success toast shown by underlying operation
        } catch (error) {
          // Handle unexpected errors (network, etc.)
          logger.error("Unexpected error resuming session", error as Error);
          // Error already shown above or by underlying operation
        }
      },
      [resumeSessionMutation, store]
    ),

    startNewSession: useCallback(() => {
      store.startNewTransaction();
      // Silent operation - new session will be created on first item add
    }, [store]),
  };

  // Transaction Operations
  const transactionOperations = {
    processPayment: useCallback(
      async (paymentMethod: string, session: POSSession) => {
        try {
          // Validate cart first
          const cartValidation = validateCart();
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
    // Operations
    cart: cartOperations,
    session: sessionOperations,
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

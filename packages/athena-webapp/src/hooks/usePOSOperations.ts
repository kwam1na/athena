import { useCallback, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { usePOSStore, posSelectors } from "../stores/posStore";
import { Product, CustomerInfo } from "../components/pos/types";
import { Id } from "../../convex/_generated/dataModel";
import { usePOSCustomerUpdate } from "./usePOSCustomers";
import { PAYSTACK_PROCESSING_FEE } from "@/lib/constants";

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

  // Customer operations hooks
  const updateCustomerHook = usePOSCustomerUpdate();

  // Auto-update session when customer data changes
  useEffect(() => {
    const updateSessionWithCustomer = async () => {
      const sessionId = store.session.currentSessionId;
      if (!sessionId || !store.customer.current) return;

      try {
        console.log(
          "🔄 Auto-updating session with customer data:",
          store.customer.current
        );

        await updateSessionMutation({
          sessionId: sessionId as Id<"posSession">,
          customerId: store.customer.current.customerId,
          customerInfo: {
            name: store.customer.current.name,
            email: store.customer.current.email,
            phone: store.customer.current.phone,
          },
          cartItems: store.cart.items.map((item) => ({
            id: item.id,
            name: item.name,
            barcode: item.barcode,
            price: item.price,
            quantity: item.quantity,
            image: item.image || undefined,
            size: item.size,
            length: item.length ?? undefined,
            skuId: item.skuId,
          })),
          subtotal: store.cart.subtotal,
          tax: store.cart.tax,
          total: store.cart.total,
        });

        console.log("✅ Session updated with customer data");
      } catch (error) {
        console.error("❌ Failed to update session with customer data:", error);
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

  // Helper function to auto-update session
  const autoUpdateSession = useCallback(async () => {
    const sessionId = store.session.currentSessionId;
    if (!sessionId) return;

    try {
      await updateSessionMutation({
        sessionId: sessionId as Id<"posSession">,
        cartItems: store.cart.items.map((item) => ({
          id: item.id,
          name: item.name,
          barcode: item.barcode,
          price: item.price,
          quantity: item.quantity,
          image: item.image || undefined,
          size: item.size,
          length: item.length ?? undefined,
          skuId: item.skuId,
        })),
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
    } catch (error) {
      console.error("❌ Failed to auto-update session:", error);
      // Don't throw - this is a background operation
    }
  }, [store, updateSessionMutation]);

  // Helper function to auto-create session
  const autoCreateSession = useCallback(async () => {
    if (!store.storeId) {
      throw new Error("Store ID not set");
    }

    try {
      console.log("🔄 Auto-creating session for first cart item...");

      const sessionId = await createSessionMutation({
        storeId: store.storeId,
        registerNumber: store.ui.registerNumber,
      });

      store.setCurrentSessionId(sessionId);
      console.log("✅ Session created:", sessionId);

      return sessionId;
    } catch (error) {
      console.error("❌ Failed to auto-create session:", error);
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

  // Utility function to calculate net price for transactions
  const calculateNetPrice = (product: Product): number => {
    if (!product.areProcessingFeesAbsorbed) {
      // If merchant doesn't absorb fees, use base price (minus processing fees)
      const processingFee = (product.price * PAYSTACK_PROCESSING_FEE) / 100;
      return Math.ceil(product.price - processingFee);
    }
    // If merchant absorbs fees, use full price
    return product.price;
  };

  // Individual cart operation functions
  const addProduct = useCallback(
    async (product: Product) => {
      try {
        // Validate product data
        if (!product.skuId) {
          throw new Error("Product missing SKU ID - cannot add to cart");
        }

        if (product.price <= 0) {
          throw new Error("Product has invalid price");
        }

        // Convert product to cart item
        const cartItem = {
          name: product.name,
          barcode: product.barcode,
          price: calculateNetPrice(product),
          quantity: 1,
          image: product.image,
          size: product.size,
          length: product.length,
          skuId: product.skuId,
          areProcessingFeesAbsorbed: product.areProcessingFeesAbsorbed,
        };

        console.log("🛒 Adding cart item:", cartItem);

        // Add to cart
        store.addToCart(cartItem);

        console.log("🛒 Cart after adding:", {
          itemCount: store.cart.items.length,
          subtotal: store.cart.subtotal,
          total: store.cart.total,
        });

        // Auto-create session if this is the first item
        if (store.cart.items.length === 1 && !store.session.activeSession) {
          await autoCreateSession();
        }

        // Auto-update session if one exists
        await autoUpdateSession();

        // toast.success(`Added ${product.name} to cart`);
      } catch (error) {
        toast.error((error as Error).message);
      }
    },
    [store, autoCreateSession, autoUpdateSession]
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
        toast.error((error as Error).message);
      }
    },
    [addProduct]
  );

  const updateQuantity = useCallback(
    async (itemId: string, quantity: number) => {
      try {
        if (quantity < 0) {
          throw new Error("Quantity cannot be negative");
        }

        store.updateCartQuantity(itemId, quantity);

        // Auto-update session
        await autoUpdateSession();
      } catch (error) {
        toast.error((error as Error).message);
      }
    },
    [store, autoUpdateSession]
  );

  const removeItem = useCallback(
    async (itemId: string) => {
      try {
        store.removeFromCart(itemId);

        // Auto-update session
        await autoUpdateSession();

        toast.success("Item removed from cart");
      } catch (error) {
        toast.error((error as Error).message);
      }
    },
    [store, autoUpdateSession]
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

          const sessionId = await createSessionMutation({
            storeId,
            registerNumber: store.ui.registerNumber,
          });

          store.setCurrentSessionId(sessionId);
          toast.success("New session created");

          return sessionId;
        } catch (error) {
          toast.error((error as Error).message);
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
        console.error("Failed to update session:", error);
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

          toast.success("Session held successfully");
        } catch (error) {
          toast.error((error as Error).message);
        }
      },
      [holdSessionMutation, store]
    ),

    resumeSession: useCallback(
      async (sessionId: string) => {
        try {
          await resumeSessionMutation({
            sessionId: sessionId as Id<"posSession">,
          });

          toast.success("Session resumed");
        } catch (error) {
          toast.error((error as Error).message);
        }
      },
      [resumeSessionMutation]
    ),

    startNewSession: useCallback(() => {
      store.startNewTransaction();
      toast.success("Started new session");
    }, [store]),
  };

  // Transaction Operations
  const transactionOperations = {
    processPayment: useCallback(
      async (paymentMethod: string) => {
        try {
          // Validate cart first
          const cartValidation = validateCart();
          if (!cartValidation.isValid) {
            toast.error(cartValidation.errors.join(", "));
            return {
              success: false,
              error: cartValidation.errors.join(", "),
            };
          }

          store.setTransactionCompleting(true);

          const sessionId = store.session.currentSessionId;

          if (sessionId) {
            // Session-based transaction completion
            console.log("🔄 Processing session-based transaction:", sessionId);

            await completeSessionMutation({
              sessionId: sessionId as Id<"posSession">,
              paymentMethod,
              amountPaid: store.cart.total,
              notes: `Register: ${store.ui.registerNumber}`,
            });

            // Generate POS transaction number (consistent with backend format)
            const timestamp = Math.floor(Date.now() / 1000);
            const baseTransactionNumber = timestamp % 100000;
            const randomPadding = Math.floor(Math.random() * 10);
            const transactionNumber = `POS-${(
              baseTransactionNumber * 10 +
              randomPadding
            )
              .toString()
              .padStart(6, "0")}`;

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
            console.log("🔄 Processing direct transaction");

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

            console.log("📊 Transaction data:", transactionData);
            console.log("🔄 Calling completeTransactionMutation...");

            // Debug: Log customer data specifically
            if (transactionData.customerId) {
              console.log("👤 Customer data being sent to transaction:", {
                customerId: transactionData.customerId,
                customerInfo: transactionData.customerInfo,
                hasLinkedCustomer: !!transactionData.customerId,
              });
            } else {
              console.log(
                "⚠️ No customer data in transaction - this transaction will not be linked to a customer"
              );
            }

            const result = await completeTransactionMutation(transactionData);

            console.log("📨 Transaction result:", result);

            if (result.success) {
              console.log("✅ Transaction successful, updating state...");

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

              console.log(
                "✅ Transaction state updated, showing success message"
              );
              console.log("📊 Store state after completion:", {
                isTransactionCompleted: store.transaction.isCompleted,
                completedOrderNumber: store.transaction.completedOrderNumber,
                completedTransactionData:
                  store.transaction.completedTransactionData,
              });

              // toast.success(
              //   `Transaction completed! Order: ${result.transactionNumber}`
              // );

              return {
                success: true,
                transactionNumber: result.transactionNumber,
              };
            } else {
              console.error("❌ Transaction failed:", result.error);
              toast.error(result.error || "Transaction failed");
              return {
                success: false,
                error: result.error,
              };
            }
          }
        } catch (error) {
          toast.error((error as Error).message);
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
      console.log(
        "Print receipt requested - this should be handled by the UI component using usePrint hook"
      );
      toast.info("Please use the Print Receipt button in the UI");
    }, []),
  };

  // Customer Operations
  const customerOperations = {
    searchCustomers: useCallback(
      async (query: string) => {
        try {
          if (!query.trim()) {
            store.setCustomerSearchResults([]);
            return;
          }

          store.setCustomerSearching(true);
          store.setCustomerSearchQuery(query);

          // For now, use a simple mock search since the API is still being set up
          // TODO: Replace with actual Convex API call
          setTimeout(() => {
            store.setCustomerSearchResults([]);
            store.setCustomerSearching(false);
          }, 500);
        } catch (error) {
          console.error("❌ Failed to search customers:", error);
          store.setCustomerSearchResults([]);
          toast.error("Failed to search customers");
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

          toast.success(`Created customer: ${newCustomer.name}`);

          return {
            success: true,
            customer: newCustomer,
          };
        } catch (error) {
          toast.error((error as Error).message);
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
            toast.success(`Customer updated: ${customer.name}`);
            return { success: true };
          } else {
            toast.error(result.error || "Failed to update customer");
            return { success: false, error: result.error };
          }
        } catch (error) {
          const errorMessage = (error as Error).message;
          toast.error(errorMessage);
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
      (storeId: Id<"store"> | null) => {
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

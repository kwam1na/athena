import { useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { usePOSStore, posSelectors } from "../stores/posStore";
import { Product } from "../components/pos/types";
import { Id } from "../../convex/_generated/dataModel";
import { validateProduct, validateQuantity } from "../lib/pos/validation";
import { logger } from "../lib/logger";
import { useSessionManagement } from "./useSessionManagement";
import {
  handlePOSOperation,
  POS_MESSAGES,
  showValidationError,
  showNoActiveSessionError,
} from "../lib/pos/toastService";
import { usePOSActiveSession } from "./usePOSSessions";

/**
 * Hook for POS Cart Operations
 *
 * Handles adding, removing, and updating items in the cart.
 * Focused on cart management only - session and transaction logic elsewhere.
 */
export const useCartOperations = () => {
  const store = usePOSStore();
  const { createSession } = useSessionManagement();

  // Convex mutations
  const addOrUpdateItemMutation = useMutation(
    api.inventory.posSessionItems.addOrUpdateItem
  );
  const removeItemMutation = useMutation(
    api.inventory.posSessionItems.removeItem
  );

  /**
   * Ensures we have an active session, creating one if needed
   */
  const ensureSession = useCallback(async () => {
    // First check currentSessionId in store
    let sessionId = store.session.currentSessionId;

    // If not in store, check activeSession object
    if (!sessionId && store.session.activeSession) {
      sessionId = store.session.activeSession._id;
      logger.debug("[POS] Using session ID from activeSession", {
        sessionId,
      });
      // Update store with the session ID for consistency
      store.setCurrentSessionId(sessionId);
    }

    // If still no session, try to create one
    if (!sessionId) {
      if (!store.storeId) {
        const errorMsg = "Store ID not set. Cannot create session.";
        logger.error("[POS] " + errorMsg);
        throw new Error(errorMsg);
      }

      logger.info(
        "[POS] No active session found, auto-creating session for cart operation",
        {
          storeId: store.storeId,
          registerNumber: store.ui.registerNumber,
        }
      );

      try {
        sessionId = await createSession(store.storeId);
        logger.info("[POS] Session auto-created successfully", {
          sessionId,
        });
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : "Failed to create session";
        logger.error("[POS] Failed to auto-create session", {
          error: error instanceof Error ? error : new Error(String(error)),
          storeId: store.storeId,
        });
        throw new Error(`No active session. ${errorMsg}`);
      }
    }

    return sessionId;
  }, [
    store.session.currentSessionId,
    store.session.activeSession,
    store.storeId,
    store.ui.registerNumber,
    createSession,
    store,
  ]);

  /**
   * Adds a product to the cart
   */
  const addProduct = useCallback(
    async (product: Product) => {
      logger.info("[POS] Adding product to cart", {
        productName: product.name,
        productId: product.productId,
        skuId: product.skuId,
        price: product.price,
        barcode: product.barcode,
      });

      // Validate product data
      const validation = validateProduct(product);
      if (!validation.isValid) {
        logger.warn("[POS] Product validation failed", {
          productName: product.name,
          errors: validation.errors,
        });
        showValidationError(validation.errors);
        return;
      }

      try {
        // Ensure we have a session
        const sessionId = await ensureSession();

        // Check if item already exists in cart by SKU ID
        const existingItem = store.cart.items.find(
          (item) => item.skuId === product.skuId
        );
        const newQuantity = existingItem ? existingItem.quantity + 1 : 1;
        const isUpdate = !!existingItem;

        logger.debug("[POS] Cart operation details", {
          sessionId,
          isUpdate,
          existingQuantity: existingItem?.quantity || 0,
          newQuantity,
        });

        // Call server mutation to add/update item with inventory hold
        const { success, data } = await handlePOSOperation(
          () =>
            addOrUpdateItemMutation({
              sessionId: sessionId as Id<"posSession">,
              productId: product.productId!,
              productSkuId: product.skuId!,
              productSku: product.barcode,
              productName: product.name,
              price: product.price,
              quantity: newQuantity,
              image: product.image || undefined,
              size: product.size || undefined,
              length: product.length || undefined,
              areProcessingFeesAbsorbed: product.areProcessingFeesAbsorbed,
            }),
          {
            showSuccessToast: false, // Silent add for better UX
            onSuccess: (data) => {
              // Update local store with the database ID
              if (existingItem) {
                store.updateCartQuantity(existingItem.id, newQuantity);
              } else {
                store.addToCart({
                  id: data.itemId,
                  name: product.name,
                  barcode: product.barcode,
                  sku: product.sku,
                  price: product.price,
                  quantity: 1,
                  image: product.image || undefined,
                  size: product.size || undefined,
                  length: product.length,
                  productId: product.productId!,
                  skuId: product.skuId!,
                  areProcessingFeesAbsorbed: product.areProcessingFeesAbsorbed,
                });
              }
              // Update session expiration time
              store.setSessionExpiresAt(data.expiresAt);
            },
          }
        );

        if (success && data) {
          logger.info("[POS] Product added to cart successfully", {
            productName: product.name,
            itemId: data.itemId,
            quantity: newQuantity,
            wasUpdate: isUpdate,
            sessionExpiresAt: data.expiresAt,
          });
        }
      } catch (error) {
        logger.error("[POS] Exception while adding product", {
          productName: product.name,
          error: error instanceof Error ? error : new Error(String(error)),
        });
        throw error;
      }
    },
    [store, ensureSession, addOrUpdateItemMutation]
  );

  /**
   * Adds a product from barcode scan
   */
  const addFromBarcode = useCallback(
    async (barcode: string, productData: Product) => {
      logger.info("[POS] Adding product from barcode", {
        barcode,
        productFound: !!productData,
        productName: productData?.name,
      });

      try {
        if (!barcode.trim()) {
          logger.warn("[POS] Invalid barcode attempted", { barcode });
          throw new Error("Invalid barcode");
        }

        if (!productData) {
          logger.warn("[POS] Product not found for barcode", { barcode });
          throw new Error(`Product not found for barcode: ${barcode}`);
        }

        await addProduct(productData);
      } catch (error) {
        logger.error("[POS] Barcode scan error", {
          barcode,
          error: error as Error,
        });
        // Error already shown by addProduct
      }
    },
    [addProduct]
  );

  /**
   * Removes an item from the cart
   */
  const removeItem = useCallback(
    async (itemId: Id<"posSessionItem">) => {
      const sessionId = store.session.currentSessionId;
      const item = store.cart.items.find((item) => item.id === itemId);

      logger.info("[POS] Removing item from cart", {
        itemId,
        itemName: item?.name,
        quantity: item?.quantity,
        sessionId,
      });

      if (!sessionId) {
        logger.error("[POS] No active session for item removal");
        showNoActiveSessionError("remove items");
        return;
      }

      if (!item) {
        logger.error("[POS] Item not found in cart", { itemId });
        showValidationError([POS_MESSAGES.cart.itemNotFound]);
        return;
      }

      const { success, data } = await handlePOSOperation(
        () =>
          removeItemMutation({
            sessionId: sessionId as Id<"posSession">,
            itemId,
          }),
        {
          successMessage: POS_MESSAGES.cart.itemRemoved,
          onSuccess: (data) => {
            // Update local store after successful server update
            store.removeFromCart(itemId);
            // Update session expiration time
            store.setSessionExpiresAt(data.expiresAt);
          },
        }
      );

      if (success) {
        logger.info("[POS] Item removed successfully", {
          itemName: item.name,
          itemId,
          sessionExpiresAt: data?.expiresAt,
        });
      }
    },
    [store, removeItemMutation]
  );

  /**
   * Updates the quantity of an item in the cart
   * If quantity is 0, the item is removed from the session
   */
  const updateQuantity = useCallback(
    async (itemId: Id<"posSessionItem">, quantity: number) => {
      const item = store.cart.items.find((item) => item.id === itemId);

      logger.info("[POS] Updating cart item quantity", {
        itemId,
        itemName: item?.name,
        oldQuantity: item?.quantity,
        newQuantity: quantity,
      });

      // If quantity is 0, remove the item instead
      if (quantity === 0) {
        logger.info("[POS] Quantity is 0, removing item from cart", {
          itemName: item?.name,
          itemId,
        });
        await removeItem(itemId);
        return;
      }

      // Validate quantity (must be positive integer)
      const validation = validateQuantity(quantity);
      if (!validation.isValid) {
        logger.warn("[POS] Quantity validation failed", {
          quantity,
          errors: validation.errors,
        });
        showValidationError(validation.errors);
        return;
      }

      const sessionId = store.session.currentSessionId;
      if (!sessionId) {
        logger.error("[POS] No active session for quantity update");
        showNoActiveSessionError("update quantities");
        return;
      }

      if (!item || !item.skuId || !item.productId) {
        logger.error("[POS] Item not found or missing data", {
          itemId,
          hasItem: !!item,
          hasSkuId: !!item?.skuId,
          hasProductId: !!item?.productId,
        });
        showValidationError([POS_MESSAGES.cart.itemNotFound]);
        return;
      }

      const { success, data } = await handlePOSOperation(
        () =>
          addOrUpdateItemMutation({
            sessionId: sessionId as Id<"posSession">,
            productId: item.productId!,
            productSkuId: item.skuId!,
            productSku: item.barcode,
            productName: item.name,
            price: item.price,
            quantity,
            image: item.image || undefined,
            size: item.size || undefined,
            length: item.length || undefined,
            areProcessingFeesAbsorbed: item.areProcessingFeesAbsorbed,
          }),
        {
          showSuccessToast: false, // Silent update for better UX
          onSuccess: (data) => {
            // Update local store after successful server update
            store.updateCartQuantity(itemId, quantity);
            // Update session expiration time
            store.setSessionExpiresAt(data.expiresAt);
          },
        }
      );

      if (success) {
        logger.info("[POS] Quantity updated successfully", {
          itemName: item.name,
          quantity,
          sessionExpiresAt: data?.expiresAt,
        });
      }
    },
    [store, addOrUpdateItemMutation, removeItem]
  );

  /**
   * Clears the entire cart
   */
  const clearCart = useCallback(() => {
    logger.info("[POS] Clearing cart", {
      itemCount: store.cart.items.length,
      cartTotal: store.cart.total,
    });
    store.clearCart();
  }, [store]);

  return {
    // Operations
    addProduct,
    addFromBarcode,
    updateQuantity,
    removeItem,
    clearCart,

    // State (from store)
    cartItems: store.cart.items,
    cartTotal: store.cart.total,
    cartSubtotal: store.cart.subtotal,
    cartTax: store.cart.tax,
    cartItemCount: posSelectors.getCartItemCount(store),
    isCartEmpty: store.cart.items.length === 0,
  };
};

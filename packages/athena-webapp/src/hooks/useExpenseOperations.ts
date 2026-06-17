import { useCallback } from "react";
import { useExpenseStore } from "../stores/expenseStore";
import { Product } from "../components/pos/types";
import type { CartItem } from "../components/pos/types";
import { Id } from "../../convex/_generated/dataModel";
import { validateProduct, validateQuantity } from "../lib/pos/validation";
import { logger } from "../lib/logger";
import { useSessionManagementExpense } from "./useSessionManagementExpense";
import { useExpenseLocalRuntime } from "./useExpenseLocalRuntime";
import {
  POS_MESSAGES,
  showValidationError,
  showNoActiveSessionError,
} from "../lib/pos/toastService";

function cloneCartItems(items: CartItem[]): CartItem[] {
  return items.map((item) => ({ ...item }));
}

function mapProductToExpenseCartItem(
  product: Product,
  id: Id<"expenseSessionItem">,
  quantity: number,
): CartItem {
  return {
    id,
    name: product.name,
    barcode: product.barcode || "",
    sku: product.sku || "",
    price: product.price,
    quantity,
    image: product.image || undefined,
    size: product.size || undefined,
    length: product.length,
    color: product.color,
    productId: product.productId!,
    skuId: product.skuId!,
    pendingCheckoutItemId: product.pendingCheckoutItemId,
    inventoryImportProvisionalSkuId: product.inventoryImportProvisionalSkuId,
  };
}

function expenseLineSourceKey(item: {
  pendingCheckoutItemId?: string;
  inventoryImportProvisionalSkuId?: string;
}) {
  if (item.inventoryImportProvisionalSkuId) {
    return `provisional_import:${item.inventoryImportProvisionalSkuId}`;
  }
  if (item.pendingCheckoutItemId) {
    return `pending_checkout:${item.pendingCheckoutItemId}`;
  }
  return "trusted_inventory";
}

function expenseCartItemSourceKey(item: CartItem) {
  return expenseLineSourceKey({
    pendingCheckoutItemId:
      "pendingCheckoutItemId" in item ? item.pendingCheckoutItemId : undefined,
    inventoryImportProvisionalSkuId:
      "inventoryImportProvisionalSkuId" in item
        ? item.inventoryImportProvisionalSkuId
        : undefined,
  });
}

function expenseLineMatchesProduct(item: CartItem, product: Product) {
  return (
    item.skuId === product.skuId &&
    expenseCartItemSourceKey(item) === expenseLineSourceKey(product)
  );
}

function createOptimisticExpenseItemId(product: Product) {
  return `optimistic:${product.skuId}:${expenseLineSourceKey(product)}` as Id<"expenseSessionItem">;
}

/**
 * Hook for Expense Cart Operations
 *
 * Handles adding, removing, and updating items in the expense cart.
 * Similar to POS cart operations but for expense tracking.
 */
export const useExpenseOperations = () => {
  const store = useExpenseStore();
  const { createSession } = useSessionManagementExpense();
  const currentStaffProfileId = store.cashier.id as unknown as
    | Id<"staffProfile">
    | null;
  const { expenseLocalGateway } = useExpenseLocalRuntime({
    staffProfileId: currentStaffProfileId,
    storeId: store.storeId,
    terminalId: store.terminalId,
  });

  /**
   * Ensures we have an active expense session, creating one if needed
   */
  const ensureSession = useCallback(async () => {
    let sessionId = store.session.currentSessionId;

    if (!sessionId && store.session.activeSession) {
      sessionId = store.session.activeSession._id;
      logger.debug("[Expense] Using session ID from activeSession", {
        sessionId,
      });
      store.setCurrentSessionId(sessionId);
    }

    if (!sessionId) {
      if (!store.storeId) {
        const errorMsg = "Store ID not set. Cannot create session.";
        logger.error("[Expense] " + errorMsg);
        throw new Error(errorMsg);
      }

      logger.info(
        "[Expense] No active session found, auto-creating session for cart operation",
        {
          storeId: store.storeId,
          registerNumber: store.ui.registerNumber,
        }
      );

      try {
        sessionId = await createSession(store.storeId);
        logger.info("[Expense] Session auto-created successfully", {
          sessionId,
        });
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : "Failed to create session";
        logger.error("[Expense] Failed to auto-create session", {
          error: error instanceof Error ? error : new Error(String(error)),
          storeId: store.storeId,
        });
        throw new Error(`No active session. ${errorMsg}`);
      }
    }

    return sessionId;
  }, [createSession, store]);

  const getCommandScope = useCallback(() => {
    if (!store.storeId || !store.terminalId) {
      throw new Error("Terminal details missing");
    }
    if (!currentStaffProfileId) {
      throw new Error("Staff profile missing");
    }
    return {
      storeId: store.storeId,
      terminalId: store.terminalId,
      staffProfileId: currentStaffProfileId,
    };
  }, [currentStaffProfileId, store.storeId, store.terminalId]);

  /**
   * Adds a product to the expense cart
   */
  const addProduct = useCallback(
    async (product: Product) => {
      logger.info("[Expense] Adding product to cart", {
        productName: product.name,
        productId: product.productId,
        skuId: product.skuId,
        price: product.price,
        barcode: product.barcode,
      });

      // Validate product data
      const validation = validateProduct(product);
      if (!validation.isValid) {
        logger.warn("[Expense] Product validation failed", {
          productName: product.name,
          errors: validation.errors,
        });
        showValidationError(validation.errors);
        return false;
      }

      if (store.session.isUpdating) {
        logger.warn("[Expense] Cart update already in progress");
        return false;
      }

      try {
        // Ensure we have a session
        const sessionId = await ensureSession();

        // Check if item already exists in cart by SKU ID and source key.
        const existingItem = store.cart.items.find(
          (item) => expenseLineMatchesProduct(item, product)
        );
        const newQuantity = existingItem ? existingItem.quantity + 1 : 1;
        const isUpdate = !!existingItem;

        logger.debug("[Expense] Cart operation details", {
          sessionId,
          isUpdate,
          existingQuantity: existingItem?.quantity || 0,
          newQuantity,
        });

        const commandScope = getCommandScope();

        const previousCartItems = cloneCartItems(store.cart.items);
        const optimisticItemId = createOptimisticExpenseItemId(product);

        if (existingItem) {
          store.updateCartQuantity(
            existingItem.id as Id<"expenseSessionItem">,
            newQuantity,
          );
        } else {
          store.addToCart(
            mapProductToExpenseCartItem(product, optimisticItemId, newQuantity),
          );
        }
        store.setSessionUpdating(true);

        try {
          const savedLocally = await (existingItem
            ? expenseLocalGateway.updateItem({
              ...commandScope,
              localExpenseSessionId: sessionId as string,
              localItemId: existingItem.id as string,
              productId: product.productId!,
              productSkuId: product.skuId!,
              pendingCheckoutItemId: product.pendingCheckoutItemId,
              inventoryImportProvisionalSkuId:
                product.inventoryImportProvisionalSkuId,
              productSku: product.sku || "",
              barcode: product.barcode || undefined,
              productName: product.name,
              price: product.price,
              quantity: newQuantity,
              image: product.image || undefined,
              size: product.size || undefined,
              length: product.length || undefined,
              color: product.color,
            })
            : expenseLocalGateway.addItem({
              ...commandScope,
              localExpenseSessionId: sessionId as string,
              localItemId: optimisticItemId as string,
              productId: product.productId!,
              productSkuId: product.skuId!,
              pendingCheckoutItemId: product.pendingCheckoutItemId,
              inventoryImportProvisionalSkuId:
                product.inventoryImportProvisionalSkuId,
              productSku: product.sku || "",
              barcode: product.barcode || undefined,
              productName: product.name,
              price: product.price,
              quantity: newQuantity,
              image: product.image || undefined,
              size: product.size || undefined,
              length: product.length || undefined,
              color: product.color,
            })).catch((error) => {
              logger.error("[Expense] Failed to save cart item locally", {
                error:
                  error instanceof Error ? error : new Error(String(error)),
              });
              return false;
            });

          if (!savedLocally) {
            store.replaceCartItems(previousCartItems);
            return false;
          }

          logger.info("[Expense] Product added to cart successfully", {
            productName: product.name,
            itemId: existingItem?.id ?? optimisticItemId,
            quantity: newQuantity,
            wasUpdate: isUpdate,
          });
          return true;
        } finally {
          store.setSessionUpdating(false);
        }
      } catch (error) {
        logger.error("[Expense] Exception while adding product", {
          productName: product.name,
          error: error instanceof Error ? error : new Error(String(error)),
        });
        throw error;
      }
    },
    [store, ensureSession, expenseLocalGateway, getCommandScope]
  );

  /**
   * Adds a product from barcode scan
   */
  const addFromBarcode = useCallback(
    async (barcode: string, productData: Product | Product[]) => {
      logger.info("[Expense] Adding product from barcode", {
        barcode,
        productFound: !!productData,
        isArray: Array.isArray(productData),
        productName: Array.isArray(productData)
          ? `${productData.length} variants`
          : productData?.name,
      });

      try {
        if (!barcode.trim()) {
          logger.warn("[Expense] Invalid barcode attempted", { barcode });
          throw new Error("Invalid barcode");
        }

        if (!productData) {
          logger.warn("[Expense] Product not found for barcode", { barcode });
          throw new Error(`Product not found for barcode: ${barcode}`);
        }

        if (Array.isArray(productData)) {
          if (productData.length === 0) {
            logger.warn("[Expense] Empty product array for barcode", {
              barcode,
            });
            throw new Error(`No products found for barcode: ${barcode}`);
          }

          if (productData.length === 1) {
            await addProduct(productData[0]);
          } else {
            logger.info(
              "[Expense] Multiple SKUs detected, skipping auto-add (user must select)",
              {
                barcode,
                count: productData.length,
              }
            );
            return;
          }
        } else {
          await addProduct(productData);
        }
      } catch (error) {
        logger.error("[Expense] Barcode scan error", {
          barcode,
          error: error as Error,
        });
      }
    },
    [addProduct]
  );

  /**
   * Removes an item from the expense cart
   */
  const removeItem = useCallback(
    async (itemId: Id<"expenseSessionItem">) => {
      const sessionId = store.session.currentSessionId;
      const item = store.cart.items.find(
        (item) => (item.id as string) === (itemId as string)
      );

      logger.info("[Expense] Removing item from cart", {
        itemId,
        itemName: item?.name,
        quantity: item?.quantity,
        sessionId,
      });

      if (!sessionId) {
        logger.error("[Expense] No active session for item removal");
        showNoActiveSessionError("remove items");
        return;
      }

      if (!item) {
        logger.error("[Expense] Item not found in cart", { itemId });
        showValidationError([POS_MESSAGES.cart.itemNotFound]);
        return;
      }

      if (!store.storeId || !store.terminalId || !currentStaffProfileId) {
        logger.error("[Expense] Missing command scope for item removal");
        showNoActiveSessionError("remove items");
        return;
      }

      if (!item.skuId) {
        logger.error("[Expense] Item missing SKU for removal", { itemId });
        showValidationError([POS_MESSAGES.cart.itemNotFound]);
        return;
      }

      if (store.session.isUpdating) {
        logger.warn("[Expense] Cart update already in progress");
        return;
      }

      const previousCartItems = cloneCartItems(store.cart.items);
      store.removeFromCart(itemId);
      store.setSessionUpdating(true);

      try {
        const savedLocally = await expenseLocalGateway.removeItem({
          terminalId: store.terminalId,
          storeId: store.storeId,
          staffProfileId: currentStaffProfileId,
          localExpenseSessionId: sessionId as string,
          localItemId: itemId as string,
          productSkuId: item.skuId,
          pendingCheckoutItemId: item.pendingCheckoutItemId,
          inventoryImportProvisionalSkuId:
            item.inventoryImportProvisionalSkuId,
        }).catch((error) => {
          logger.error("[Expense] Failed to remove cart item locally", {
            error: error instanceof Error ? error : new Error(String(error)),
          });
          return false;
        });

        if (!savedLocally) {
          store.replaceCartItems(previousCartItems);
          return;
        }

        logger.info("[Expense] Item removed successfully", {
          itemName: item.name,
          itemId,
        });
      } finally {
        store.setSessionUpdating(false);
      }
    },
    [store, expenseLocalGateway, currentStaffProfileId]
  );

  /**
   * Updates the quantity of an item in the expense cart
   */
  const updateQuantity = useCallback(
    async (itemId: Id<"expenseSessionItem">, quantity: number) => {
      const item = store.cart.items.find(
        (item) => (item.id as string) === (itemId as string)
      );

      logger.info("[Expense] Updating cart item quantity", {
        itemId,
        itemName: item?.name,
        oldQuantity: item?.quantity,
        newQuantity: quantity,
      });

      if (quantity === 0) {
        logger.info("[Expense] Quantity is 0, removing item from cart", {
          itemName: item?.name,
          itemId,
        });
        await removeItem(itemId);
        return;
      }

      const validation = validateQuantity(quantity);
      if (!validation.isValid) {
        logger.warn("[Expense] Quantity validation failed", {
          quantity,
          errors: validation.errors,
        });
        showValidationError(validation.errors);
        return;
      }

      const sessionId = store.session.currentSessionId;
      if (!sessionId) {
        logger.error("[Expense] No active session for quantity update");
        showNoActiveSessionError("update quantities");
        return;
      }

      if (!store.storeId || !store.terminalId || !currentStaffProfileId) {
        logger.error("[Expense] Missing command scope for quantity update");
        showNoActiveSessionError("update quantities");
        return;
      }

      if (!item || !item.skuId || !item.productId) {
        logger.error("[Expense] Item not found or missing data", {
          itemId,
          hasItem: !!item,
          hasSkuId: !!item?.skuId,
          hasProductId: !!item?.productId,
        });
        showValidationError([POS_MESSAGES.cart.itemNotFound]);
        return;
      }

      if (store.session.isUpdating) {
        logger.warn("[Expense] Cart update already in progress");
        return;
      }

      const previousCartItems = cloneCartItems(store.cart.items);
      store.updateCartQuantity(itemId, quantity);
      store.setSessionUpdating(true);

      try {
        const savedLocally = await expenseLocalGateway.updateItem({
          terminalId: store.terminalId,
          storeId: store.storeId,
          staffProfileId: currentStaffProfileId,
          localExpenseSessionId: sessionId as string,
          localItemId: itemId as string,
          productId: item.productId!,
          productSkuId: item.skuId!,
          pendingCheckoutItemId: item.pendingCheckoutItemId,
          inventoryImportProvisionalSkuId: item.inventoryImportProvisionalSkuId,
          productSku: item.sku || "",
          barcode: item.barcode || undefined,
          productName: item.name,
          price: item.price,
          quantity,
          image: item.image || undefined,
          size: item.size || undefined,
          length: item.length || undefined,
          color: item.color,
        }).catch((error) => {
          logger.error("[Expense] Failed to update cart item locally", {
            error: error instanceof Error ? error : new Error(String(error)),
          });
          return false;
        });

        if (!savedLocally) {
          store.replaceCartItems(previousCartItems);
          return;
        }

        logger.info("[Expense] Quantity updated successfully", {
          itemName: item.name,
          quantity,
        });
      } finally {
        store.setSessionUpdating(false);
      }
    },
    [store, expenseLocalGateway, removeItem, currentStaffProfileId]
  );

  /**
   * Clears the entire expense cart
   */
  const clearCart = useCallback(async () => {
    logger.info("[Expense] Clearing cart", {
      itemCount: store.cart.items.length,
      cartTotal: store.cart.total,
    });
    const sessionId = store.session.currentSessionId;
    const previousCartItems = cloneCartItems(store.cart.items);
    store.clearCart();
    store.setSessionUpdating(true);

    try {
      if (
        sessionId &&
        store.storeId &&
        store.terminalId &&
        currentStaffProfileId
      ) {
        const savedLocally = await expenseLocalGateway.clearCart({
          terminalId: store.terminalId,
          storeId: store.storeId,
          staffProfileId: currentStaffProfileId,
          localExpenseSessionId: sessionId as string,
        }).catch((error) => {
          logger.error("[Expense] Failed to clear cart locally", {
            error: error instanceof Error ? error : new Error(String(error)),
          });
          return false;
        });
        if (!savedLocally) {
          store.replaceCartItems(previousCartItems);
          return false;
        }
      }

      return true;
    } finally {
      store.setSessionUpdating(false);
    }
  }, [currentStaffProfileId, expenseLocalGateway, store]);

  return {
    addProduct,
    addFromBarcode,
    updateQuantity,
    removeItem,
    clearCart,
    cartItems: store.cart.items,
    cartTotal: store.cart.total,
    cartSubtotal: store.cart.subtotal,
    cartTax: store.cart.tax,
    cartItemCount: store.cart.items.reduce(
      (sum, item) => sum + item.quantity,
      0
    ),
    isCartEmpty: store.cart.items.length === 0,
  };
};

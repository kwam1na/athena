import { DatabaseReader, DatabaseWriter } from "../../_generated/server";
import { Id } from "../../_generated/dataModel";

/**
 * Inventory Hold Management Service
 *
 * Centralized service for managing inventory holds during POS sessions.
 * Ensures consistent inventory management across all session operations.
 */

export interface InventoryHoldResult {
  success: boolean;
  message?: string;
  available?: number;
}

/**
 * Validates if sufficient inventory is available for a product SKU
 */
export async function validateInventoryAvailability(
  db: DatabaseReader,
  skuId: Id<"productSku">,
  requiredQuantity: number
): Promise<InventoryHoldResult> {
  const sku = await db.get(skuId);

  if (!sku) {
    return {
      success: false,
      message: "Product information is missing. Please scan again.",
    };
  }

  // Type guard for SKU data
  if (
    !("quantityAvailable" in sku) ||
    !("sku" in sku) ||
    typeof sku.quantityAvailable !== "number"
  ) {
    return {
      success: false,
      message: "Invalid product data. Please contact support.",
    };
  }

  if (sku.quantityAvailable === 0) {
    return {
      success: false,
      message: "No more units available for this product",
      available: 0,
    };
  }

  if (sku.quantityAvailable < requiredQuantity) {
    return {
      success: false,
      message: `Only ${sku.quantityAvailable} unit${sku.quantityAvailable !== 1 ? "s" : ""} available`,
      available: sku.quantityAvailable,
    };
  }

  return {
    success: true,
    available: sku.quantityAvailable,
  };
}

/**
 * Acquires an inventory hold by decreasing quantityAvailable
 *
 * @param db - Database writer for mutations
 * @param skuId - Product SKU ID to hold inventory for
 * @param quantity - Quantity to hold
 * @returns Result indicating success or failure
 */
export async function acquireInventoryHold(
  db: DatabaseWriter,
  skuId: Id<"productSku">,
  quantity: number
): Promise<InventoryHoldResult> {
  // First validate availability
  const validation = await validateInventoryAvailability(db, skuId, quantity);
  if (!validation.success) {
    return validation;
  }

  const sku = await db.get(skuId);
  if (!sku || !("quantityAvailable" in sku)) {
    return {
      success: false,
      message: "Product not found",
    };
  }

  // Acquire the hold by decreasing available quantity
  await db.patch(skuId, {
    quantityAvailable: (sku.quantityAvailable as number) - quantity,
  });

  return {
    success: true,
    message: `Successfully held ${quantity} units`,
  };
}

/**
 * Releases an inventory hold by increasing quantityAvailable
 *
 * @param db - Database writer for mutations
 * @param skuId - Product SKU ID to release inventory for
 * @param quantity - Quantity to release
 * @returns Result indicating success or failure
 */
export async function releaseInventoryHold(
  db: DatabaseWriter,
  skuId: Id<"productSku">,
  quantity: number
): Promise<InventoryHoldResult> {
  const sku = await db.get(skuId);

  if (!sku) {
    // Don't fail if SKU doesn't exist - it may have been deleted
    console.warn(`[InventoryHolds] SKU ${skuId} not found during release`);
    return {
      success: true,
      message: "SKU not found, but continuing",
    };
  }

  if (
    !("quantityAvailable" in sku) ||
    typeof sku.quantityAvailable !== "number"
  ) {
    console.warn(`[InventoryHolds] Invalid SKU data for ${skuId}`);
    return {
      success: false,
      message: "Invalid product data",
    };
  }

  // Release the hold by increasing available quantity
  await db.patch(skuId, {
    quantityAvailable: sku.quantityAvailable + quantity,
  });

  return {
    success: true,
    message: `Successfully released ${quantity} units`,
  };
}

/**
 * Adjusts inventory hold when quantity changes (increase or decrease)
 *
 * @param db - Database writer for mutations
 * @param skuId - Product SKU ID
 * @param oldQuantity - Previous quantity held
 * @param newQuantity - New quantity to hold
 * @returns Result indicating success or failure
 */
export async function adjustInventoryHold(
  db: DatabaseWriter,
  skuId: Id<"productSku">,
  oldQuantity: number,
  newQuantity: number
): Promise<InventoryHoldResult> {
  const quantityChange = newQuantity - oldQuantity;

  if (quantityChange === 0) {
    return { success: true, message: "No quantity change" };
  }

  if (quantityChange > 0) {
    // Need to hold more inventory
    return await acquireInventoryHold(db, skuId, quantityChange);
  } else {
    // Release some inventory (quantityChange is negative)
    return await releaseInventoryHold(db, skuId, Math.abs(quantityChange));
  }
}

/**
 * Batch operation: Acquires holds for multiple SKUs
 * Used when resuming sessions with multiple items
 *
 * @param db - Database writer for mutations
 * @param items - Array of {skuId, quantity} pairs
 * @returns Array of results for each item
 */
export async function acquireInventoryHoldsBatch(
  db: DatabaseWriter,
  items: Array<{ skuId: Id<"productSku">; quantity: number; name?: string }>
): Promise<{
  success: boolean;
  unavailableItems: string[];
}> {
  const unavailableItems: string[] = [];

  // First, validate all items
  for (const item of items) {
    const validation = await validateInventoryAvailability(
      db,
      item.skuId,
      item.quantity
    );
    if (!validation.success) {
      const itemName = item.name || "Unknown Product";
      unavailableItems.push(
        `${itemName}: ${validation.message} (Available: ${validation.available || 0}, Need: ${item.quantity})`
      );
    }
  }

  if (unavailableItems.length > 0) {
    return {
      success: false,
      unavailableItems,
    };
  }

  // All items validated - now acquire holds
  for (const item of items) {
    await acquireInventoryHold(db, item.skuId, item.quantity);
  }

  return {
    success: true,
    unavailableItems: [],
  };
}

/**
 * Batch operation: Releases holds for multiple SKUs
 * Used when voiding sessions or expiring sessions with multiple items
 *
 * @param db - Database writer for mutations
 * @param items - Array of {skuId, quantity} pairs
 */
export async function releaseInventoryHoldsBatch(
  db: DatabaseWriter,
  items: Array<{ skuId: Id<"productSku">; quantity: number }>
): Promise<void> {
  // Release holds in parallel
  await Promise.all(
    items.map((item) => releaseInventoryHold(db, item.skuId, item.quantity))
  );
}

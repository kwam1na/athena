import { DatabaseReader } from "../../_generated/server";
import { Id } from "../../_generated/dataModel";

/**
 * Session Validation Helpers
 *
 * Centralized validation logic for POS sessions.
 * Provides consistent error messages and validation patterns.
 */

export interface ValidationResult {
  success: boolean;
  message?: string;
}

/**
 * Validates that a session exists
 */
export async function validateSessionExists(
  db: DatabaseReader,
  sessionId: Id<"posSession">
): Promise<ValidationResult> {
  const session = await db.get(sessionId);

  if (!session) {
    return {
      success: false,
      message: "Session not found. It may have been deleted or expired.",
    };
  }

  return { success: true };
}

/**
 * Validates that a session is in active status
 * Prevents modifications to completed, voided, held, or expired sessions
 */
export async function validateSessionActive(
  db: DatabaseReader,
  sessionId: Id<"posSession">,
  cashierId: Id<"cashier">
): Promise<ValidationResult> {
  const session = await db.get(sessionId);
  const now = Date.now();

  console.log("session in validateSessionActive", session);

  if (!session) {
    return {
      success: false,
      message: "Your session has expired. Start a new one to proceed.",
    };
  }

  if (session.cashierId !== cashierId) {
    return {
      success: false,
      message: "This session is not associated with your cashier.",
    };
  }

  // Check if session has expired based on timestamp
  // This prevents expired sessions from being modified even if status hasn't been updated yet
  if (session.expiresAt && session.expiresAt < now) {
    return {
      success: false,
      message: "This session has expired. Start a new one to proceed.",
    };
  }

  if (session.status !== "active") {
    const statusMessages: Record<string, string> = {
      completed:
        "This session has been completed and cannot be modified. Start a new one to proceed",
      void: "This session has been voided and cannot be modified. Start a new one to proceed",
      held: "Can only add items to active sessions. Please resume or create a new session",
      expired: "This session has expired. Start a new one to proceed",
    };

    return {
      success: false,
      message: statusMessages[session.status] || "Session is not active.",
    };
  }

  return { success: true };
}

/**
 * Validates that a session can be modified (active or held)
 * Used for operations that should work on both active and held sessions
 * Also checks expiration timestamp to prevent modifications to expired sessions
 */
export async function validateSessionModifiable(
  db: DatabaseReader,
  sessionId: Id<"posSession">,
  cashierId: Id<"cashier">
): Promise<ValidationResult> {
  const session = await db.get(sessionId);
  const now = Date.now();

  if (!session) {
    return {
      success: false,
      message: "Session not found",
    };
  }

  if (session.cashierId !== cashierId) {
    return {
      success: false,
      message: "This session is not associated with your cashier.",
    };
  }

  // Check if session has expired based on timestamp
  // This prevents expired sessions from being modified even if status hasn't been updated yet
  if (session.expiresAt && session.expiresAt < now) {
    return {
      success: false,
      message: "This session has expired. Start a new one to proceed.",
    };
  }

  if (session.status === "completed" || session.status === "void") {
    return {
      success: false,
      message: `Cannot modify ${session.status} session. This is for audit integrity.`,
    };
  }

  return { success: true };
}

/**
 * Validates session ownership based on store, cashier, or register
 * Optional validation for multi-user environments
 */
export async function validateSessionOwnership(
  db: DatabaseReader,
  sessionId: Id<"posSession">,
  options: {
    storeId?: Id<"store">;
    cashierId?: Id<"cashier">;
    registerNumber?: string;
  }
): Promise<ValidationResult> {
  const session = await db.get(sessionId);

  if (!session) {
    return {
      success: false,
      message: "Session not found",
    };
  }

  if (options.storeId && session.storeId !== options.storeId) {
    return {
      success: false,
      message: "This session belongs to a different store.",
    };
  }

  if (options.cashierId && session.cashierId !== options.cashierId) {
    return {
      success: false,
      message: "This session belongs to a different cashier.",
    };
  }

  if (
    options.registerNumber &&
    session.registerNumber !== options.registerNumber
  ) {
    return {
      success: false,
      message: "This session is on a different register.",
    };
  }

  return { success: true };
}

/**
 * Validates that cart items exist and have required data
 */
export function validateCartItems(
  items: Array<{
    productId?: Id<"product">;
    productSkuId?: Id<"productSku">;
    quantity: number;
    price: number;
  }>
): ValidationResult {
  if (items.length === 0) {
    return {
      success: false,
      message: "Cart is empty",
    };
  }

  // Check for items without SKU IDs
  const itemsWithoutSkuId = items.filter((item) => !item.productSkuId);
  if (itemsWithoutSkuId.length > 0) {
    return {
      success: false,
      message: "Some items are missing product information",
    };
  }

  // Check for items without product IDs
  const itemsWithoutProductId = items.filter((item) => !item.productId);
  if (itemsWithoutProductId.length > 0) {
    return {
      success: false,
      message: "Some items are missing product information",
    };
  }

  // Check for invalid quantities
  const invalidQuantities = items.filter((item) => item.quantity <= 0);
  if (invalidQuantities.length > 0) {
    return {
      success: false,
      message: "Some items have invalid quantities",
    };
  }

  // Check for invalid prices
  const invalidPrices = items.filter((item) => item.price < 0);
  if (invalidPrices.length > 0) {
    return {
      success: false,
      message: "Some items have invalid prices",
    };
  }

  return { success: true };
}

/**
 * Validates that a session item belongs to a specific session
 */
export async function validateItemBelongsToSession(
  db: DatabaseReader,
  itemId: Id<"posSessionItem">,
  sessionId: Id<"posSession">
): Promise<ValidationResult> {
  const item = await db.get(itemId);

  if (!item) {
    return {
      success: false,
      message: "Item not found in cart",
    };
  }

  if (item.sessionId !== sessionId) {
    return {
      success: false,
      message: "Item does not belong to this session",
    };
  }

  return { success: true };
}

/**
 * Validates customer info has required fields
 */
export function validateCustomerInfo(customerInfo: {
  name?: string;
  email?: string;
  phone?: string;
}): ValidationResult {
  // At least one field should be present
  if (!customerInfo.name && !customerInfo.email && !customerInfo.phone) {
    return {
      success: false,
      message:
        "At least one customer field (name, email, or phone) is required",
    };
  }

  // Basic email validation if provided
  if (customerInfo.email && !isValidEmail(customerInfo.email)) {
    return {
      success: false,
      message: "Invalid email address format",
    };
  }

  return { success: true };
}

/**
 * Simple email validation helper
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validates payment details for transaction completion
 */
export function validatePaymentDetails(payment: {
  paymentMethod: string;
  amountPaid: number;
  total: number;
  changeGiven?: number;
}): ValidationResult {
  if (!payment.paymentMethod || payment.paymentMethod.trim() === "") {
    return {
      success: false,
      message: "Payment method is required",
    };
  }

  if (payment.amountPaid < 0) {
    return {
      success: false,
      message: "Amount paid cannot be negative",
    };
  }

  if (payment.amountPaid < payment.total) {
    return {
      success: false,
      message: `Insufficient payment. Total: ${payment.total}, Paid: ${payment.amountPaid}`,
    };
  }

  if (payment.changeGiven !== undefined && payment.changeGiven < 0) {
    return {
      success: false,
      message: "Change given cannot be negative",
    };
  }

  return { success: true };
}

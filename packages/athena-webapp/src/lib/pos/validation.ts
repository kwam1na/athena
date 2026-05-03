/**
 * POS Validation Utilities
 *
 * Centralized validation logic for POS operations.
 * Provides consistent validation with clear error messages.
 */

import { CartItem } from "@/components/pos/types";
import { Product, CustomerInfo } from "@/components/pos/types";
import { POSSession } from "../../../types";
import { logger } from "../logger";
import { formatStoredAmount } from "./displayAmounts";
import type { PosPaymentMethod } from "./domain";

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Validates cart has items and all items are valid
 */
export function validateCart(items: CartItem[]): ValidationResult {
  const errors: string[] = [];

  if (items.length === 0) {
    errors.push("Cart is empty");
  }

  // Check for items without SKU IDs
  const itemsWithoutSkuId = items.filter((item) => !item.skuId);
  if (itemsWithoutSkuId.length > 0) {
    errors.push("Some items are missing product information");
  }

  // Check for items without product IDs
  const itemsWithoutProductId = items.filter((item) => !item.productId);
  if (itemsWithoutProductId.length > 0) {
    errors.push("Some items are missing product information");
  }

  // Check for invalid quantities
  const invalidQuantities = items.filter((item) => item.quantity <= 0);
  if (invalidQuantities.length > 0) {
    errors.push("Some items have invalid quantities");
  }

  // Check for invalid prices
  const invalidPrices = items.filter((item) => item.price < 0);
  if (invalidPrices.length > 0) {
    errors.push("Some items have invalid prices");
  }

  if (errors.length > 0) {
    logger.warn("[POS] Cart validation failed", {
      itemCount: items.length,
      errors,
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validates a product can be added to cart
 */
export function validateProduct(product: Product): ValidationResult {
  const errors: string[] = [];

  if (!product.skuId) {
    errors.push("Product missing SKU ID - cannot add to cart");
  }

  if (!product.productId) {
    errors.push("Product missing product ID");
  }

  if (product.price <= 0) {
    errors.push("Product has invalid price");
  }

  // if (!product.barcode || product.barcode.trim() === "") {
  //   errors.push("Product missing barcode");
  // }

  if (!product.name || product.name.trim() === "") {
    errors.push("Product missing name");
  }

  if (errors.length > 0) {
    logger.warn("[POS] Product validation failed", {
      productName: product.name,
      barcode: product.barcode,
      errors,
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validates customer information
 */
export function validateCustomer(customer: CustomerInfo): ValidationResult {
  const errors: string[] = [];

  // At least one field should be present
  if (!customer.name && !customer.email && !customer.phone) {
    errors.push(
      "At least one customer field (name, email, or phone) is required"
    );
  }

  // Basic email validation if provided
  if (customer.email && !isValidEmail(customer.email)) {
    errors.push("Invalid email address format");
  }

  // Basic phone validation if provided
  if (customer.phone && !isValidPhone(customer.phone)) {
    errors.push("Invalid phone number format");
  }

  if (errors.length > 0) {
    logger.warn("[POS] Customer validation failed", {
      hasName: !!customer.name,
      hasEmail: !!customer.email,
      hasPhone: !!customer.phone,
      errors,
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validates payment information
 */
export function validatePayment(payment: {
  paymentMethod: string;
  amountPaid: number;
  total: number;
}): ValidationResult {
  const errors: string[] = [];

  if (!payment.paymentMethod || payment.paymentMethod.trim() === "") {
    errors.push("Payment method is required");
  }

  if (payment.amountPaid < 0) {
    errors.push("Amount paid cannot be negative");
  }

  if (payment.amountPaid < payment.total) {
    errors.push(
      `Insufficient payment. Total: $${payment.total.toFixed(2)}, Paid: $${payment.amountPaid.toFixed(2)}`
    );
  }

  if (errors.length > 0) {
    logger.warn("[POS] Payment validation failed", {
      paymentMethod: payment.paymentMethod,
      amountPaid: payment.amountPaid,
      total: payment.total,
      errors,
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validates barcode format
 */
export function validateBarcode(barcode: string): ValidationResult {
  const errors: string[] = [];

  if (!barcode || barcode.trim() === "") {
    errors.push("Barcode cannot be empty");
  }

  // Barcode should be alphanumeric
  if (barcode && !/^[a-zA-Z0-9-_]+$/.test(barcode)) {
    errors.push("Barcode contains invalid characters");
  }

  if (errors.length > 0) {
    logger.warn("[POS] Barcode validation failed", {
      barcode,
      errors,
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validates quantity is valid
 */
export function validateQuantity(quantity: number): ValidationResult {
  const errors: string[] = [];

  if (quantity < 0) {
    errors.push("Quantity cannot be negative");
  }

  if (quantity === 0) {
    errors.push("Quantity must be greater than zero");
  }

  if (!Number.isInteger(quantity)) {
    errors.push("Quantity must be a whole number");
  }

  if (errors.length > 0) {
    logger.warn("[POS] Quantity validation failed", {
      quantity,
      errors,
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Helper: Email validation
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validates that a session is modifiable before processing payment or operations
 */
export function validateSession(
  session: POSSession | null | undefined,
  expiresAt: number | null | undefined
): ValidationResult {
  const errors: string[] = [];

  console.log("session in validateSession", session);

  if (!session) {
    errors.push("No active session found");
  } else {
    // Check if session has expired
    const now = Date.now();
    if (expiresAt && expiresAt < now) {
      errors.push("This session has expired. Start a new one to proceed.");
    }

    // Check if session status is valid for modification
    if (session.status !== "active") {
      const statusMessages: Record<string, string> = {
        completed: "This session has been completed and cannot be modified",
        void: "This session has been voided and cannot be modified",
        held: "This session is on hold. Please resume it first.",
        expired: "This session has expired. Start a new one to proceed.",
      };

      errors.push(
        statusMessages[session.status] ||
          `Cannot modify session with status "${session.status}"`
      );
    }
  }

  if (errors.length > 0) {
    logger.warn("[POS] Session validation failed", {
      hasSession: !!session,
      sessionId: session?._id,
      status: session?.status,
      expiresAt,
      errors,
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Helper: Phone validation (basic)
 */
function isValidPhone(phone: string): boolean {
  // Remove common formatting characters
  const cleaned = phone.replace(/[\s\-\(\)\.]/g, "");
  // Check if it's a reasonable phone number length (7-15 digits)
  return /^\d{7,15}$/.test(cleaned);
}

/**
 * Validates a payment amount is valid for the remaining due
 * @param amount - The payment amount
 * @param remainingDue - The remaining amount due
 * @param paymentMethod - Optional payment method. If "cash", allows amount to exceed remaining due (for change)
 */
export function validatePaymentAmount(
  amount: number,
  remainingDue: number,
  formatter: Intl.NumberFormat,
  paymentMethod?: PosPaymentMethod | null,
): ValidationResult {
  const errors: string[] = [];

  if (amount <= 0) {
    errors.push("Payment amount must be greater than zero");
  }

  // For cash payments, allow amount to exceed remaining due (change will be given)
  // For other methods, amount cannot exceed remaining due
  if (amount > remainingDue && !isOverpayPaymentMethod(paymentMethod)) {
    errors.push(
      `Payment amount (${formatStoredAmount(formatter, amount)}) cannot exceed remaining due (${formatStoredAmount(formatter, remainingDue)})`
    );
  }

  if (!Number.isFinite(amount)) {
    errors.push("Payment amount must be a valid number");
  }

  if (errors.length > 0) {
    logger.warn("[POS] Payment amount validation failed", {
      amount,
      remainingDue,
      paymentMethod,
      errors,
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validates that payments array is sufficient to complete transaction
 */
export function validatePayments(
  payments: Array<{ amount: number }>,
  totalDue: number,
  formatter: Intl.NumberFormat
): ValidationResult {
  const errors: string[] = [];

  if (payments.length === 0) {
    errors.push("At least one payment is required");
  }

  const totalPaid = payments.reduce((sum, payment) => sum + payment.amount, 0);

  if (totalPaid < totalDue) {
    errors.push(
      `Insufficient payment. Total due: ${formatStoredAmount(formatter, totalDue)}, Total paid: ${formatStoredAmount(formatter, totalPaid)}`
    );
  }

  // Check for invalid amounts
  const invalidPayments = payments.filter(
    (p) => !Number.isFinite(p.amount) || p.amount <= 0
  );
  if (invalidPayments.length > 0) {
    errors.push("Some payments have invalid amounts");
  }

  if (errors.length > 0) {
    logger.warn("[POS] Payments validation failed", {
      paymentCount: payments.length,
      totalPaid,
      totalDue,
      errors,
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Checks if transaction can be completed based on total paid
 */
export function canCompleteTransaction(
  totalPaid: number,
  totalDue: number
): boolean {
  return totalPaid >= totalDue && totalPaid > 0 && totalDue > 0;
}

/**
 * Returns whether a payment method can exceed remaining due amount.
 */
export function isOverpayPaymentMethod(paymentMethod?: PosPaymentMethod | null): boolean {
  return paymentMethod === "cash";
}

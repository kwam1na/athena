import { toast } from "sonner";
import { logger } from "../logger";

/**
 * POS Toast Service
 *
 * Centralized toast messaging for POS operations.
 * Provides standardized messages and consistent error handling patterns.
 */

// ============================================================================
// Message Constants
// ============================================================================

export const POS_MESSAGES = {
  session: {
    created: "New session created",
    held: "Session held successfully",
    resumed: "Session resumed",
    voided: "Session voided",
    noActive: "No active session",
    noActiveForOperation: (operation: string) =>
      `No active session. Start a new one to proceed to ${operation}.`,
    expired: "This session has expired. Start a new one to proceed.",
    cannotModify: (status: string) =>
      `Cannot modify ${status} session. Start a new one to proceed.`,
    inventoryUnavailable: "Cannot resume session - some items are out of stock",
  },
  cart: {
    itemAdded: (name: string) => `Added ${name} to cart`,
    itemRemoved: "Item removed from cart",
    itemNotFound: "Item not found in cart",
    quantityInvalid: "Quantity must be a positive number",
    quantityNegative: "Quantity cannot be negative",
    cleared: "Cart cleared",
  },
  customer: {
    created: (name: string) => `Created customer: ${name}`,
    updated: (name: string) => `Customer updated: ${name}`,
    cleared: "Customer cleared from transaction",
    searchFailed: "Failed to search customers",
    nameRequired: "Customer name is required",
    noIdForUpdate: "Cannot update customer without ID",
  },
  transaction: {
    completed: (orderNum: string) =>
      `Transaction completed! Order: ${orderNum}`,
    failed: "Transaction failed",
    processing: "Processing payment...",
  },
  validation: {
    cartEmpty: "Cart is empty",
    invalidProduct: "Invalid product data",
    missingSkuId: "Product missing SKU ID - cannot add to cart",
    invalidPrice: "Product has invalid price",
    missingProductId: "Product missing product ID",
  },
  errors: {
    unexpected: "An unexpected error occurred",
    network: "Network error. Please check your connection.",
    sessionCreationFailed: "Failed to create session. Please try again.",
    operationFailed: (operation: string) => `Failed to ${operation}`,
  },
};

// ============================================================================
// Types
// ============================================================================

/**
 * Result type for operations that return success/error objects
 */
export type OperationResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; message: string };

/**
 * Options for handlePOSOperation wrapper
 */
export interface POSOperationOptions<T> {
  /**
   * Message to show on success (can be string or function that receives data)
   */
  successMessage?: string | ((data: T) => string);

  /**
   * Prefix to add before error messages
   */
  errorPrefix?: string;

  /**
   * Callback after successful operation (before toast)
   */
  onSuccess?: (data: T) => void;

  /**
   * Callback after error (before toast)
   */
  onError?: (error: string) => void;

  /**
   * Whether to show toast on success (default: true)
   */
  showSuccessToast?: boolean;

  /**
   * Whether to show toast on error (default: true)
   */
  showErrorToast?: boolean;

  /**
   * Log prefix for debugging (default: "[POS]")
   */
  logPrefix?: string;

  /**
   * Whether to rethrow errors (default: false)
   */
  rethrowErrors?: boolean;

  /**
   * Custom toast options for errors
   */
  errorToastOptions?: {
    description?: string;
    duration?: number;
  };
}

/**
 * Return type for handlePOSOperation
 */
export interface POSOperationResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ============================================================================
// Smart Operation Wrapper
// ============================================================================

/**
 * Wrapper for POS operations that handles both success/error result objects
 * and try-catch exceptions consistently.
 *
 * This consolidates the two common error handling patterns:
 * 1. Checking result.success for mutations that return { success, data/message }
 * 2. Try-catch blocks for network errors and unexpected exceptions
 *
 * @example
 * // Simple usage with success message
 * const { success, data } = await handlePOSOperation(
 *   () => createSessionMutation({ storeId }),
 *   { successMessage: POS_MESSAGES.session.created }
 * );
 * if (!success) return;
 *
 * @example
 * // With callbacks and custom error handling
 * const { success, data, error } = await handlePOSOperation(
 *   () => addItemMutation({ sessionId, productId }),
 *   {
 *     successMessage: (data) => POS_MESSAGES.cart.itemAdded(data.productName),
 *     onSuccess: (data) => store.setSessionExpiresAt(data.expiresAt),
 *     errorPrefix: "Failed to add item",
 *     showSuccessToast: false, // Handle toast manually
 *   }
 * );
 */
export async function handlePOSOperation<T>(
  operation: () => Promise<T | OperationResult<T>>,
  options: POSOperationOptions<T> = {}
): Promise<POSOperationResponse<T>> {
  const {
    successMessage,
    errorPrefix,
    onSuccess,
    onError,
    showSuccessToast = true,
    showErrorToast = true,
    logPrefix = "[POS]",
    rethrowErrors = false,
    errorToastOptions,
  } = options;

  try {
    const result = await operation();

    // Check if result is an OperationResult type (has success field)
    if (
      result &&
      typeof result === "object" &&
      "success" in result &&
      typeof result.success === "boolean"
    ) {
      const operationResult = result as OperationResult<T>;

      if (operationResult.success) {
        // Success case
        const data = (operationResult as { success: true; data: T }).data;

        if (onSuccess) {
          onSuccess(data);
        }

        if (showSuccessToast && successMessage) {
          const message =
            typeof successMessage === "function"
              ? successMessage(data)
              : successMessage;
          toast.success(message);
        }

        logger.debug(`${logPrefix} Operation succeeded`);
        return { success: true, data };
      } else {
        // Error case from result object
        const errorMessage = (
          operationResult as { success: false; message: string }
        ).message;
        const fullError = errorPrefix
          ? `${errorPrefix}: ${errorMessage}`
          : errorMessage;

        if (onError) {
          onError(errorMessage);
        }

        if (showErrorToast) {
          toast.error(fullError, errorToastOptions);
        }

        logger.error(`${logPrefix} Operation failed`, { error: errorMessage });

        if (rethrowErrors) {
          throw new Error(errorMessage);
        }

        return { success: false, error: errorMessage };
      }
    }

    // Result is plain data (not an OperationResult type)
    const data = result as T;

    if (onSuccess) {
      onSuccess(data);
    }

    if (showSuccessToast && successMessage) {
      const message =
        typeof successMessage === "function"
          ? successMessage(data)
          : successMessage;
      toast.success(message);
    }

    logger.debug(`${logPrefix} Operation succeeded`);
    return { success: true, data };
  } catch (error) {
    // Exception caught (network error, unexpected error, etc.)
    const errorMessage = error instanceof Error ? error.message : String(error);
    const fullError = errorPrefix
      ? `${errorPrefix}: ${errorMessage}`
      : errorMessage;

    if (onError) {
      onError(errorMessage);
    }

    if (showErrorToast) {
      toast.error(fullError, errorToastOptions);
    }

    logger.error(`${logPrefix} Operation exception`, error as Error);

    if (rethrowErrors) {
      throw error;
    }

    return { success: false, error: errorMessage };
  }
}

// ============================================================================
// Specialized Toast Helpers
// ============================================================================

/**
 * Show validation error toast
 */
export function showValidationError(errors: string[]) {
  if (errors.length > 0) {
    toast.error(errors[0]);
  }
}

/**
 * Show inventory unavailability error with details
 */
export function showInventoryError(message: string) {
  toast.error(POS_MESSAGES.session.inventoryUnavailable, {
    description: message,
    duration: 5000,
  });
}

/**
 * Show session expiration error
 */
export function showSessionExpiredError() {
  toast.error(POS_MESSAGES.session.expired);
}

/**
 * Show no active session error
 */
export function showNoActiveSessionError(operation?: string) {
  if (operation) {
    toast.error(POS_MESSAGES.session.noActiveForOperation(operation));
  } else {
    toast.error(POS_MESSAGES.session.noActive);
  }
}

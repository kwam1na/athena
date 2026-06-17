import { DatabaseReader } from "../../_generated/server";
import { Id } from "../../_generated/dataModel";

/**
 * Expense Session Validation Helpers
 *
 * Centralized validation logic for expense sessions.
 * Provides consistent error messages and validation patterns.
 */

export interface ExpenseValidationResult {
  success: boolean;
  message?: string;
}

/**
 * Validates that an expense session exists
 */
export async function validateExpenseSessionExists(
  db: DatabaseReader,
  sessionId: Id<"expenseSession">
): Promise<ExpenseValidationResult> {
  const session = await db.get("expenseSession", sessionId);

  if (!session) {
    return {
      success: false,
      message: "Session not found.",
    };
  }

  return { success: true };
}

/**
 * Validates that an expense session is in active status
 * Prevents modifications to completed, voided, or held sessions
 */
export async function validateExpenseSessionActive(
  db: DatabaseReader,
  sessionId: Id<"expenseSession">,
  staffProfileId: Id<"staffProfile">
): Promise<ExpenseValidationResult> {
  const session = await db.get("expenseSession", sessionId);
  if (!session) {
    return {
      success: false,
      message: "Session not found.",
    };
  }

  if (session.staffProfileId !== staffProfileId) {
    return {
      success: false,
      message: "This session is not associated with your staff profile.",
    };
  }

  if (session.status !== "active") {
    const statusMessages: Record<string, string> = {
      completed:
        "This session has been completed and cannot be modified. Start a new one to proceed",
      void: "This session has been voided and cannot be modified. Start a new one to proceed",
      held: "Can only add items to active sessions. Please resume or create a new session",
      expired: "This session is no longer active. Start a new one to proceed",
    };

    return {
      success: false,
      message: statusMessages[session.status] || "Session is not active.",
    };
  }

  return { success: true };
}

/**
 * Validates that an expense session can be modified (active or held)
 * Used for operations that should work on both active and held sessions
 */
export async function validateExpenseSessionModifiable(
  db: DatabaseReader,
  sessionId: Id<"expenseSession">,
  staffProfileId: Id<"staffProfile">
): Promise<ExpenseValidationResult> {
  const session = await db.get("expenseSession", sessionId);
  if (!session) {
    return {
      success: false,
      message: "Session not found",
    };
  }

  if (session.staffProfileId !== staffProfileId) {
    return {
      success: false,
      message: "This session is not associated with your staff profile.",
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
 * Validates that an expense session item belongs to a specific session
 */
export async function validateExpenseItemBelongsToSession(
  db: DatabaseReader,
  itemId: Id<"expenseSessionItem">,
  sessionId: Id<"expenseSession">
): Promise<ExpenseValidationResult> {
  const item = await db.get("expenseSessionItem", itemId);

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

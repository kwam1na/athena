import { v } from "convex/values";
import { Id } from "../../_generated/dataModel";

/**
 * Shared Result Type Helpers
 *
 * Provides reusable success/error result types to reduce verbose union types
 * throughout the POS session management system.
 */

/**
 * Generic success/error result type
 */
export type Result<TData = void> =
  | { success: true; data: TData }
  | { success: false; message: string };

/**
 * Success result helper
 */
export function success<TData>(data: TData): Result<TData> {
  return { success: true, data };
}

/**
 * Error result helper
 */
export function error(message: string): Result<never> {
  return { success: false, message };
}

/**
 * Session operation result with expiration
 */
export interface SessionOperationResult {
  sessionId: Id<"posSession">;
  expiresAt: number;
}

/**
 * Validator for session operation result
 */
export const sessionOperationResultValidator = v.object({
  sessionId: v.id("posSession"),
  expiresAt: v.number(),
});

/**
 * Item operation result with expiration
 */
export interface ItemOperationResult {
  itemId: Id<"posSessionItem">;
  expiresAt: number;
}

/**
 * Validator for item operation result
 */
export const itemOperationResultValidator = v.object({
  itemId: v.id("posSessionItem"),
  expiresAt: v.number(),
});

/**
 * Generic operation result with just expiration
 */
export interface OperationResult {
  expiresAt: number;
}

/**
 * Validator for operation result
 */
export const operationResultValidator = v.object({
  expiresAt: v.number(),
});

/**
 * Success/Error result validator for item operations
 */
export const itemResultValidator = v.union(
  v.object({
    success: v.literal(true),
    data: itemOperationResultValidator,
  }),
  v.object({
    success: v.literal(false),
    message: v.string(),
  })
);

/**
 * Success/Error result validator for general operations
 */
export const operationSuccessValidator = v.union(
  v.object({
    success: v.literal(true),
    data: operationResultValidator,
  }),
  v.object({
    success: v.literal(false),
    message: v.string(),
  })
);

/**
 * Success/Error result validator for session operations
 */
export const sessionResultValidator = v.union(
  v.object({
    success: v.literal(true),
    data: sessionOperationResultValidator,
  }),
  v.object({
    success: v.literal(false),
    message: v.string(),
  })
);

/**
 * Helper to create a successful item operation result
 */
export function itemSuccess(
  itemId: Id<"posSessionItem">,
  expiresAt: number
): Result<ItemOperationResult> {
  return success({ itemId, expiresAt });
}

/**
 * Helper to create a successful operation result
 */
export function operationSuccess(expiresAt: number): Result<OperationResult> {
  return success({ expiresAt });
}

/**
 * Helper to create a successful session operation result
 */
export function sessionSuccess(
  sessionId: Id<"posSession">,
  expiresAt: number
): Result<SessionOperationResult> {
  return success({ sessionId, expiresAt });
}

/**
 * Type guard to check if result is successful
 */
export function isSuccess<TData>(
  result: Result<TData>
): result is { success: true; data: TData } {
  return result.success === true;
}

/**
 * Type guard to check if result is an error
 */
export function isError<TData>(
  result: Result<TData>
): result is { success: false; message: string } {
  return result.success === false;
}

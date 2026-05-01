import type { ApprovalRequirement } from "./approvalPolicy";

export const USER_ERROR_CODES = [
  "validation_failed",
  "authentication_failed",
  "authorization_failed",
  "not_found",
  "conflict",
  "precondition_failed",
  "rate_limited",
  "unavailable",
] as const;

export type UserErrorCode = (typeof USER_ERROR_CODES)[number];

export type UserError = {
  code: UserErrorCode;
  title?: string;
  message: string;
  fields?: Record<string, string[]>;
  retryable?: boolean;
  traceId?: string;
  metadata?: Record<string, unknown>;
};

export type CommandResult<T> =
  | {
      kind: "ok";
      data: T;
    }
  | {
      kind: "user_error";
      error: UserError;
    };

export type ApprovalRequiredResult = {
  kind: "approval_required";
  approval: ApprovalRequirement;
};

export type ApprovalCommandResult<T> =
  | CommandResult<T>
  | ApprovalRequiredResult;

export const GENERIC_UNEXPECTED_ERROR_TITLE = "Something went wrong";
export const GENERIC_UNEXPECTED_ERROR_MESSAGE = "Please try again.";

export function ok<T>(data: T): CommandResult<T> {
  return {
    kind: "ok",
    data,
  };
}

export function userError(error: UserError): CommandResult<never> {
  return {
    kind: "user_error",
    error,
  };
}

export function approvalRequired(
  approval: ApprovalRequirement,
): ApprovalRequiredResult {
  return {
    kind: "approval_required",
    approval,
  };
}

export function isUserErrorResult<T>(
  result: CommandResult<T>,
): result is Extract<CommandResult<T>, { kind: "user_error" }> {
  return result.kind === "user_error";
}

export function isApprovalRequiredResult<T>(
  result: ApprovalCommandResult<T>,
): result is ApprovalRequiredResult {
  return result.kind === "approval_required";
}

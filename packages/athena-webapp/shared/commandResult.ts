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

export function isUserErrorResult<T>(
  result: CommandResult<T>,
): result is Extract<CommandResult<T>, { kind: "user_error" }> {
  return result.kind === "user_error";
}

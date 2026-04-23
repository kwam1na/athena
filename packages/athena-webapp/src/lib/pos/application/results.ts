import type { CommandResult, UserErrorCode } from "~/shared/commandResult";
import { GENERIC_UNEXPECTED_ERROR_MESSAGE } from "~/shared/commandResult";

export type PosUseCaseErrorCode =
  | UserErrorCode
  | "cashierMismatch"
  | "inventoryUnavailable"
  | "notFound"
  | "sessionExpired"
  | "terminalUnavailable"
  | "validationFailed"
  | "unknown";

export type PosUseCaseResult<TData> =
  | {
      ok: true;
      data: TData;
    }
  | {
      ok: false;
      code: PosUseCaseErrorCode;
      message: string;
    };

type PosLegacyMutationResult<TData> =
  | {
      success: true;
      data: TData;
    }
  | {
      success: false;
      message?: string;
      error?: string;
    };

type PosCommandOutcome<TData> =
  | {
      status: "ok";
      data: TData;
    }
  | {
      status: Exclude<PosUseCaseErrorCode, "unknown">;
      message: string;
    };

export function mapLegacyMutationResult<TData>(
  result: PosLegacyMutationResult<TData>,
): PosUseCaseResult<TData> {
  if (result.success) {
    return {
      ok: true,
      data: result.data,
    };
  }

  return {
    ok: false,
    code: "validationFailed",
    message: result.message ?? result.error ?? "POS command failed",
  };
}

export function mapCommandOutcome<TData>(
  result: PosCommandOutcome<TData>,
): PosUseCaseResult<TData> {
  if (result.status === "ok") {
    return {
      ok: true,
      data: result.data,
    };
  }

  return {
    ok: false,
    code: result.status,
    message: result.message,
  };
}

export function mapCommandResult<TData>(
  result: CommandResult<TData>,
): PosUseCaseResult<TData> {
  if (result.kind === "ok") {
    return {
      ok: true,
      data: result.data,
    };
  }

  return {
    ok: false,
    code: result.error.code,
    message: result.error.message,
  };
}

export function mapThrownError<TData = never>(
  _error: unknown,
): PosUseCaseResult<TData> {
  return {
    ok: false,
    code: "unknown",
    message: GENERIC_UNEXPECTED_ERROR_MESSAGE,
  };
}

export function isPosUseCaseSuccess<TData>(
  result: PosUseCaseResult<TData>,
): result is { ok: true; data: TData } {
  return result.ok;
}

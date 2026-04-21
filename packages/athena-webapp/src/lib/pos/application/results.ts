export type PosUseCaseErrorCode =
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

export function mapThrownError<TData = never>(
  error: unknown,
): PosUseCaseResult<TData> {
  return {
    ok: false,
    code: "unknown",
    message: error instanceof Error ? error.message : "Unexpected POS error",
  };
}

export function isPosUseCaseSuccess<TData>(
  result: PosUseCaseResult<TData>,
): result is { ok: true; data: TData } {
  return result.ok;
}

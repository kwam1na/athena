export const POS_DIAGNOSTIC_CLASSIFICATIONS = [
  "legacy_client_event",
  "unexpected_application_error",
  "unhandled_window_error",
  "unhandled_promise_rejection",
  "route_render_error",
  "local_storage_initialization_failed",
  "local_storage_schema_mismatch",
  "local_storage_quota_exceeded",
  "local_storage_transaction_failed",
  "local_storage_corrupt",
  "local_storage_unknown",
  "continuity_warning",
] as const;

export type PosDiagnosticClassification =
  (typeof POS_DIAGNOSTIC_CLASSIFICATIONS)[number];

export const POS_CLIENT_EVENT_LEVELS = ["warn", "error"] as const;
export type PosClientEventLevel = (typeof POS_CLIENT_EVENT_LEVELS)[number];

export const POS_CLIENT_EVENT_FLOWS = [
  "checkout",
  "session",
  "register",
  "sync",
  "storage",
  "catalog",
  "expense",
  "settings",
  "transaction",
  "printing",
  "runtime",
  "unhandled",
  "other",
] as const;
export type PosClientEventFlow = (typeof POS_CLIENT_EVENT_FLOWS)[number];

export function isPosClientEventLevel(
  value: unknown,
): value is PosClientEventLevel {
  return (
    typeof value === "string" &&
    (POS_CLIENT_EVENT_LEVELS as readonly string[]).includes(value)
  );
}

export function isPosClientEventFlow(
  value: unknown,
): value is PosClientEventFlow {
  return (
    typeof value === "string" &&
    (POS_CLIENT_EVENT_FLOWS as readonly string[]).includes(value)
  );
}

export const POS_DIAGNOSTIC_OPERATIONS = [
  "app_use_case",
  "window_runtime",
  "promise_runtime",
  "route_render",
  "openDrawer",
  "initializeStorage",
  "appendEvent",
  "readProvisionedTerminalSeed",
  "writeProvisionedTerminalSeed",
  "writeProvisionedTerminalSeedAndClearTerminalIntegrity",
  "readLocalCloudMapping",
  "writeLocalCloudMapping",
  "listEvents",
  "listEventsForUpload",
  "markEventsSynced",
  "handlePosOperation",
  "autoCreateExpenseSession",
  "completeExpense",
  "voidExpenseSession",
  "printExpenseReceipt",
  "saveCloseoutApprovalPolicy",
  "saveEodAutomationPolicy",
  "saveStoreDayAutomationPolicy",
  "rotateRecoveryCode",
  "unlockRecoveryCode",
  "revokeRecoveryCode",
  "readProvisioningSignals",
  "readStoredFingerprint",
  "generateFingerprint",
  "registerTerminal",
  "updateTerminal",
  "startTransaction",
  "printReceipt",
  "recordReceiptPrint",
] as const;

export type PosDiagnosticOperation = (typeof POS_DIAGNOSTIC_OPERATIONS)[number];

export const POS_DIAGNOSTIC_ROUTE_IDS = [
  "hub",
  "register",
  "sessions",
  "transactions",
  "transaction_detail",
  "expense",
  "expense_reports",
  "expense_report_detail",
  "settings",
  "terminals",
  "terminal_detail",
  "unknown_pos_route",
] as const;

export type PosDiagnosticRouteId = (typeof POS_DIAGNOSTIC_ROUTE_IDS)[number];

export const POS_DIAGNOSTIC_ERROR_NAMES = [
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "EvalError",
  "URIError",
  "AggregateError",
  "AbortError",
  "ConstraintError",
  "DataCloneError",
  "DataError",
  "InvalidAccessError",
  "InvalidStateError",
  "NetworkError",
  "NotAllowedError",
  "NotFoundError",
  "NotReadableError",
  "OperationError",
  "QuotaExceededError",
  "ReadOnlyError",
  "SecurityError",
  "TimeoutError",
  "TransactionInactiveError",
  "UnknownError",
  "VersionError",
] as const;

export type PosDiagnosticErrorName =
  (typeof POS_DIAGNOSTIC_ERROR_NAMES)[number];

export function isPosDiagnosticErrorName(
  value: unknown,
): value is PosDiagnosticErrorName {
  return (
    typeof value === "string" &&
    (POS_DIAGNOSTIC_ERROR_NAMES as readonly string[]).includes(value)
  );
}

export const POS_DIAGNOSTIC_METADATA_KEYS = [
  "storageEngine",
  "accessMode",
  "storageCode",
  "printCorrelation",
  "printAttemptId",
  "sourceKind",
  "attempt",
] as const;

export type PosDiagnosticMetadataValue = string | number | boolean;

const STRICT_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const BUILD_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._()+ -]{0,99}$/;
const SOURCE_ASSET = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.(?:js|css|mjs|cjs)$/;

export const POS_DIAGNOSTIC_DISPLAY_COPY: Record<
  PosDiagnosticClassification,
  string
> = {
  legacy_client_event: "Legacy client event",
  unexpected_application_error: "An unexpected POS operation failed.",
  unhandled_window_error: "An unexpected browser error occurred.",
  unhandled_promise_rejection: "An unexpected background operation failed.",
  route_render_error: "A POS screen could not render.",
  local_storage_initialization_failed: "Local POS storage could not start.",
  local_storage_schema_mismatch: "Local POS storage needs recovery.",
  local_storage_quota_exceeded: "Local POS storage is full.",
  local_storage_transaction_failed: "A local POS storage operation failed.",
  local_storage_corrupt: "Local POS storage needs recovery.",
  local_storage_unknown: "An unexpected local POS storage error occurred.",
  continuity_warning: "A POS background operation needs attention.",
};

export function isPosDiagnosticClassification(
  value: unknown,
): value is PosDiagnosticClassification {
  return (
    typeof value === "string" &&
    (POS_DIAGNOSTIC_CLASSIFICATIONS as readonly string[]).includes(value)
  );
}

export function isPosDiagnosticOperation(
  value: unknown,
): value is PosDiagnosticOperation {
  return (
    typeof value === "string" &&
    (POS_DIAGNOSTIC_OPERATIONS as readonly string[]).includes(value)
  );
}

export function isPosDiagnosticRouteId(
  value: unknown,
): value is PosDiagnosticRouteId {
  return (
    typeof value === "string" &&
    (POS_DIAGNOSTIC_ROUTE_IDS as readonly string[]).includes(value)
  );
}

export function normalizePosDiagnosticErrorName(
  error: unknown,
): PosDiagnosticErrorName | undefined {
  if (!(error instanceof Error)) return undefined;
  return (POS_DIAGNOSTIC_ERROR_NAMES as readonly string[]).includes(error.name)
    ? (error.name as PosDiagnosticErrorName)
    : "UnknownError";
}

export function normalizePosDiagnosticIdentifier(
  value: unknown,
): string | undefined {
  return typeof value === "string" && STRICT_IDENTIFIER.test(value)
    ? value
    : undefined;
}

export function normalizePosDiagnosticBuildIdentifier(
  value: unknown,
): string | undefined {
  return typeof value === "string" && BUILD_IDENTIFIER.test(value)
    ? value
    : undefined;
}

export function sanitizePosDiagnosticMetadata(
  value: unknown,
): Record<string, PosDiagnosticMetadataValue> {
  if (!isPlainRecord(value)) return {};
  const result: Record<string, PosDiagnosticMetadataValue> = {};
  for (const key of POS_DIAGNOSTIC_METADATA_KEYS) {
    const candidate = value[key];
    if (typeof candidate === "boolean") result[key] = candidate;
    else if (typeof candidate === "number" && Number.isFinite(candidate)) {
      result[key] = candidate;
    } else if (
      typeof candidate === "string" &&
      candidate.length > 0 &&
      candidate.length <= 100 &&
      /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(candidate)
    ) {
      result[key] = candidate;
    }
  }
  return result;
}

export type PosDiagnosticSource = {
  asset: string;
  line?: number;
  column?: number;
};

export function normalizePosDiagnosticSource(input: {
  asset?: unknown;
  line?: unknown;
  column?: unknown;
}): PosDiagnosticSource | undefined {
  const asset =
    typeof input.asset === "string"
      ? input.asset.split(/[?#]/, 1)[0]?.split("/").at(-1)
      : undefined;
  if (!asset || !SOURCE_ASSET.test(asset)) return undefined;
  const line = normalizeLocationNumber(input.line);
  const column = normalizeLocationNumber(input.column);
  return {
    asset,
    ...(line !== undefined ? { line } : {}),
    ...(column !== undefined ? { column } : {}),
  };
}

export function sourceFromPosDiagnosticError(
  error: unknown,
): PosDiagnosticSource | undefined {
  if (!(error instanceof Error) || typeof error.stack !== "string") {
    return undefined;
  }
  const match = error.stack.match(
    /(?:https?:\/\/[^\s)]+)?\/(?:assets|src)\/([^/?#\s)]+\.(?:js|css|mjs|cjs))(?:\?[^\s):]*)?:(\d+):(\d+)/,
  );
  return match
    ? normalizePosDiagnosticSource({
        asset: match[1],
        line: Number(match[2]),
        column: Number(match[3]),
      })
    : undefined;
}

function normalizeLocationNumber(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 10_000_000
    ? value
    : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

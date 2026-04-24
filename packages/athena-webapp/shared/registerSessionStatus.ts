export const REGISTER_SESSION_STATUSES = [
  "open",
  "active",
  "closing",
  "closed",
] as const;

export type RegisterSessionStatus = (typeof REGISTER_SESSION_STATUSES)[number];

export const POS_USABLE_REGISTER_SESSION_STATUSES = [
  "open",
  "active",
] as const satisfies readonly RegisterSessionStatus[];

export const REGISTER_SESSION_CONFLICT_BLOCKING_STATUSES = [
  "open",
  "active",
  "closing",
] as const satisfies readonly RegisterSessionStatus[];

export const CASH_CONTROL_VISIBLE_REGISTER_SESSION_STATUSES =
  REGISTER_SESSION_CONFLICT_BLOCKING_STATUSES;

export function isRegisterSessionStatus(
  status: unknown,
): status is RegisterSessionStatus {
  return (
    typeof status === "string" &&
    REGISTER_SESSION_STATUSES.includes(status as RegisterSessionStatus)
  );
}

function includesRegisterSessionStatus(
  statuses: readonly RegisterSessionStatus[],
  status: unknown,
) {
  return (
    typeof status === "string" &&
    statuses.includes(status as RegisterSessionStatus)
  );
}

export function isPosUsableRegisterSessionStatus(status: unknown): boolean {
  return includesRegisterSessionStatus(
    POS_USABLE_REGISTER_SESSION_STATUSES,
    status,
  );
}

export function isRegisterSessionConflictBlockingStatus(status: unknown): boolean {
  return includesRegisterSessionStatus(
    REGISTER_SESSION_CONFLICT_BLOCKING_STATUSES,
    status,
  );
}

export function isCashControlVisibleRegisterSessionStatus(status: unknown): boolean {
  return includesRegisterSessionStatus(
    CASH_CONTROL_VISIBLE_REGISTER_SESSION_STATUSES,
    status,
  );
}

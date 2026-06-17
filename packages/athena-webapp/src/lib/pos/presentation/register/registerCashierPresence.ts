import type { StaffAuthenticationResult } from "@/components/staff-auth/StaffAuthenticationDialog";
import type { PosLocalActiveCashierPresenceRecord } from "@/lib/pos/infrastructure/local/posLocalStore";

import type { CashierPresenceRestoreStatus } from "./registerUiState";

export type RestoredCashierPresence = {
  activeRoles?: string[];
  displayName?: string | null;
  expiresAt?: number | null;
  freshnessExpiresAt?: number | null;
  offlineFreshUntil?: number | null;
  operatingDate?: string;
  organizationId?: string;
  proofExpiresAt?: number | null;
  staffProfileId?: string;
  staffProofToken?: string | null;
  storeId?: string;
  terminalId?: string;
  username?: string | null;
};

export type CashierPresenceRestoreState = {
  displayName?: string | null;
  message?: string;
  status: CashierPresenceRestoreStatus;
  username?: string | null;
};

export const POS_CASHIER_PRESENCE_OFFLINE_FRESHNESS_MS = 15 * 60 * 1000;

export type CashierPresenceStore = {
  clearActiveCashierPresence?: (input: {
    operatingDate: string;
    organizationId?: string;
    storeId: string;
    terminalId: string;
  }) => Promise<{ ok: boolean }>;
  clearCashierPresence?: (input: {
    operatingDate: string;
    organizationId: string;
    storeId: string;
    terminalId: string;
  }) => Promise<{ ok: boolean }>;
  invalidateCashierPresenceForTerminal?: (input: {
    organizationId?: string;
    storeId?: string;
    terminalId: string;
  }) => Promise<{ ok: boolean }>;
  readActiveCashierPresence?: (input: {
    now?: number;
    operatingDate: string;
    organizationId?: string;
    storeId: string;
    terminalId: string;
  }) => Promise<{
    ok: boolean;
    value?: RestoredCashierPresence | null;
  }>;
  readCashierPresence?: (input: {
    now?: number;
    operatingDate: string;
    organizationId: string;
    storeId: string;
    terminalId: string;
  }) => Promise<{
    ok: boolean;
    value?: RestoredCashierPresence | null;
  }>;
  writeCashierPresence?: (
    presence: PosLocalActiveCashierPresenceRecord,
  ) => Promise<{
    ok: boolean;
    value?: PosLocalActiveCashierPresenceRecord;
    error?: { code: string };
  }>;
};

export type StaffProfileRosterRow = {
  credentialStatus?: "pending" | "active" | "suspended" | "revoked" | null;
  primaryRole?:
    | "manager"
    | "front_desk"
    | "stylist"
    | "technician"
    | "cashier"
    | null;
  roles?: Array<
    "manager" | "front_desk" | "stylist" | "technician" | "cashier"
  >;
  status?: "active" | "inactive";
};

export function readStaffProofFromAuthResult(
  result: StaffAuthenticationResult,
): string | null {
  const proof = (result as { posLocalStaffProof?: unknown }).posLocalStaffProof;
  if (!proof || typeof proof !== "object") {
    return null;
  }

  const { expiresAt, token } = proof as {
    expiresAt?: unknown;
    token?: unknown;
  };
  if (typeof expiresAt !== "number" || typeof token !== "string") {
    return null;
  }

  return token;
}

export function getStaffDisplayNameFromAuthResult(
  result: StaffAuthenticationResult,
) {
  return (
    result.staffProfile.fullName ||
    [result.staffProfile.firstName, result.staffProfile.lastName]
      .filter(Boolean)
      .join(" ")
  );
}

export function validateRestoredCashierPresence(input: {
  isOnline: boolean;
  now: number;
  operatingDate: string;
  organizationId?: string;
  presence: RestoredCashierPresence;
  storeId: string;
  terminalId: string;
}): CashierPresenceRestoreState {
  const {
    isOnline,
    now,
    operatingDate,
    organizationId,
    presence,
    storeId,
    terminalId,
  } = input;
  const proofExpiresAt = presence.proofExpiresAt ?? presence.expiresAt;
  const freshnessExpiresAt =
    presence.freshnessExpiresAt ?? presence.offlineFreshUntil;

  if (
    (presence.organizationId &&
      organizationId &&
      presence.organizationId !== organizationId) ||
    presence.storeId !== storeId ||
    presence.terminalId !== terminalId ||
    presence.operatingDate !== operatingDate ||
    !presence.staffProfileId ||
    !hasRegisterOperatorRole(presence.activeRoles)
  ) {
    return {
      message:
        "Cashier sign-in no longer matches this register. Sign in to continue.",
      status: "invalidated",
    };
  }

  if (typeof proofExpiresAt === "number" && proofExpiresAt <= now) {
    return {
      message: "Cashier sign-in expired. Sign in to continue.",
      status: "expired",
    };
  }

  if (
    !isOnline &&
    typeof freshnessExpiresAt === "number" &&
    freshnessExpiresAt <= now
  ) {
    return {
      message:
        "This terminal needs an online staff refresh before offline sign-in. Reconnect, then sign in once.",
      status: "offline_freshness_expired",
    };
  }

  return {
    message: "Checking cashier access before new sales.",
    status: "validation_pending",
  };
}

export function isCashierPresenceBlockingSale(
  status: CashierPresenceRestoreStatus,
) {
  return status === "pending" || status === "validation_pending";
}

export function canOperateRegister(staff: StaffProfileRosterRow): boolean {
  if (staff.status !== "active" || staff.credentialStatus !== "active") {
    return false;
  }

  const roles = staff.roles?.length ? staff.roles : [staff.primaryRole];
  return roles.some((role) => role === "cashier" || role === "manager");
}

export function hasRegisterOperatorRole(roles?: string[] | null): boolean {
  return Boolean(
    roles?.some((role) => role === "cashier" || role === "manager"),
  );
}

export function hasRegisterManagerRole(roles?: string[] | null): boolean {
  return Boolean(roles?.includes("manager"));
}

import type { CustomerInfo } from "@/components/pos/types";
import type { RegisterHeaderState, RegisterInfoState } from "./registerUiState";
import { EMPTY_REGISTER_CUSTOMER_INFO } from "./registerUiState";
import { formatStaffDisplayNameOrFallback } from "~/shared/staffDisplayName";

export function getRegisterCustomerInfo(
  customer: CustomerInfo | null | undefined,
): CustomerInfo {
  return customer ?? EMPTY_REGISTER_CUSTOMER_INFO;
}

export function getCashierDisplayName(
  cashier:
    | {
        firstName: string;
        lastName: string;
      }
    | null
    | undefined,
): string {
  if (!cashier) {
    return "Unassigned";
  }

  return formatStaffDisplayNameOrFallback(cashier, "Unassigned");
}

export function buildRegisterHeaderState(input: {
  isSessionActive: boolean;
}): RegisterHeaderState {
  return {
    title: "POS",
    isSessionActive: input.isSessionActive,
  };
}

export function buildRegisterInfoState(input: {
  customerName?: string;
  registerLabel: string;
  hasTerminal: boolean;
}): RegisterInfoState {
  return {
    customerName: input.customerName,
    registerLabel: input.registerLabel,
    hasTerminal: input.hasTerminal,
  };
}

export function isRegisterSessionActive(
  session:
    | {
        status?: string;
        expiresAt?: number;
      }
    | null
    | undefined,
  now: number = Date.now(),
): boolean {
  return Boolean(
    session?.status === "active" &&
      session.expiresAt &&
      session.expiresAt > now,
  );
}

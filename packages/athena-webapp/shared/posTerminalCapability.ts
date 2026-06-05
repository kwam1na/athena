export const POS_TERMINAL_TRANSACTION_CAPABILITIES = [
  "products_and_services",
  "products_only",
  "services_only",
] as const;

export type PosTerminalTransactionCapability =
  (typeof POS_TERMINAL_TRANSACTION_CAPABILITIES)[number];

export const DEFAULT_POS_TERMINAL_TRANSACTION_CAPABILITY =
  "products_and_services" satisfies PosTerminalTransactionCapability;

export function normalizePosTerminalTransactionCapability(
  value: unknown,
): PosTerminalTransactionCapability {
  return POS_TERMINAL_TRANSACTION_CAPABILITIES.includes(
    value as PosTerminalTransactionCapability,
  )
    ? (value as PosTerminalTransactionCapability)
    : DEFAULT_POS_TERMINAL_TRANSACTION_CAPABILITY;
}

export function posTerminalCanTransactProducts(value: unknown): boolean {
  return normalizePosTerminalTransactionCapability(value) !== "services_only";
}

export function posTerminalCanTransactServices(value: unknown): boolean {
  return normalizePosTerminalTransactionCapability(value) !== "products_only";
}

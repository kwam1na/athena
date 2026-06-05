export const POS_TERMINAL_LOGIN_MODES = ["standard", "pos_only"] as const;

export type PosTerminalLoginMode = (typeof POS_TERMINAL_LOGIN_MODES)[number];

export const DEFAULT_POS_TERMINAL_LOGIN_MODE =
  "standard" satisfies PosTerminalLoginMode;

export function normalizePosTerminalLoginMode(
  value: unknown,
): PosTerminalLoginMode {
  return POS_TERMINAL_LOGIN_MODES.includes(value as PosTerminalLoginMode)
    ? (value as PosTerminalLoginMode)
    : DEFAULT_POS_TERMINAL_LOGIN_MODE;
}

export function isPosOnlyTerminalLoginMode(value: unknown): boolean {
  return normalizePosTerminalLoginMode(value) === "pos_only";
}

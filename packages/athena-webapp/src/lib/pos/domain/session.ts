import type { PosRegisterPhase, PosRegisterPhaseInput } from "./types";

export function deriveRegisterPhase(
  input: PosRegisterPhaseInput,
): PosRegisterPhase {
  if (!input.hasTerminal) {
    return "requiresTerminal";
  }

  if (!input.hasCashier) {
    return "requiresCashier";
  }

  if (input.activeSessionId) {
    return "active";
  }

  if (input.resumableSessionId) {
    return "resumable";
  }

  return "readyToStart";
}

export function requiresTerminal(input: PosRegisterPhaseInput): boolean {
  return deriveRegisterPhase(input) === "requiresTerminal";
}

export function requiresCashier(input: PosRegisterPhaseInput): boolean {
  return deriveRegisterPhase(input) === "requiresCashier";
}

export function hasActiveRegisterSession(
  input: PosRegisterPhaseInput,
): boolean {
  return deriveRegisterPhase(input) === "active";
}

export function hasResumableRegisterSession(
  input: PosRegisterPhaseInput,
): boolean {
  return deriveRegisterPhase(input) === "resumable";
}

export function isRegisterReadyToStart(input: PosRegisterPhaseInput): boolean {
  return deriveRegisterPhase(input) === "readyToStart";
}

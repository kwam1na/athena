import type {
  PosServerPhase,
  PosRegisterPhaseInput,
  PosRegisterSessionSummary,
} from "./types";

export function deriveRegisterPhase(
  input: PosRegisterPhaseInput,
): PosServerPhase {
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

export function selectResumableSession(
  sessions: PosRegisterSessionSummary[],
): PosRegisterSessionSummary | null {
  return sessions[0] ?? null;
}

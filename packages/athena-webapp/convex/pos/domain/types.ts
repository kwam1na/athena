export type PosServerPhase =
  | "requiresTerminal"
  | "requiresCashier"
  | "active"
  | "resumable"
  | "readyToStart";

export type PosCommandOutcome<T> =
  | { status: "ok"; data: T }
  | { status: "sessionExpired"; message: string }
  | { status: "cashierMismatch"; message: string }
  | { status: "terminalUnavailable"; message: string }
  | { status: "validationFailed"; message: string };

export interface PosTerminalSummary {
  _id: string;
  displayName: string;
  status?: string;
  registeredAt?: number;
}

export interface PosCashierSummary {
  _id: string;
  firstName: string;
  lastName: string;
  username?: string;
  active?: boolean;
}

export interface PosRegisterSessionSummary {
  _id: string;
  sessionNumber: string;
  status?: string;
  terminalId?: string;
  cashierId?: string;
  registerNumber?: string;
  expiresAt?: number;
  updatedAt?: number;
  heldAt?: number;
  workflowTraceId?: string;
}

export interface PosRegisterPhaseInput {
  hasTerminal: boolean;
  hasCashier: boolean;
  activeSessionId: string | null;
  resumableSessionId: string | null;
}

export interface PosRegisterStateInput {
  terminal: PosTerminalSummary | null;
  cashier: PosCashierSummary | null;
  activeSession: PosRegisterSessionSummary | null;
  heldSessions: PosRegisterSessionSummary[];
}

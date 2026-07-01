import type { Id } from "../../_generated/dataModel";
import type { OperationalRole } from "../../operations/staffRoles";

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
  registerNumber?: string;
  loginMode?: "standard" | "pos_only";
  transactionCapability?: "products_and_services" | "products_only" | "services_only";
  status?: string;
  registeredAt?: number;
}

export interface PosCashierSummary {
  _id: string;
  firstName: string;
  lastName: string;
  activeRoles?: OperationalRole[];
  username?: string;
  active?: boolean;
}

export interface PosRegisterSessionSummary {
  _id: string;
  sessionNumber: string;
  status?: string;
  terminalId?: string;
  staffProfileId?: string;
  registerNumber?: string;
  expiresAt?: number;
  updatedAt?: number;
  heldAt?: number;
  workflowTraceId?: string;
}

export interface PosActiveSessionConflict {
  kind: "activeOnOtherTerminal";
  message: string;
  terminalId?: string;
}

export interface PosCashDrawerSummary {
  _id: Id<"registerSession">;
  status: "open" | "active" | "closing" | "closeout_rejected" | "closed";
  terminalId?: Id<"posTerminal">;
  registerNumber?: string;
  openingFloat: number;
  expectedCash: number;
  countedCash?: number;
  managerApprovalRequestId?: Id<"approvalRequest">;
  openedAt: number;
  notes?: string;
  variance?: number;
  workflowTraceId?: string;
  pendingVoidApprovals?: {
    cashAffectingCount: number;
    cashAdjustmentCount?: number;
    cashAdjustmentDelta?: number;
    cashAmount: number;
    count: number;
  } | null;
  localSyncStatus?: {
    status: "needs_review";
    reconciliationItems: Array<{
      createdAt?: number | null;
      countedCash?: number | null;
      expectedCash?: number | null;
      id?: string;
      localEventId?: string | null;
      sequence?: number | null;
      status?: string | null;
      summary?: string | null;
      type?: string | null;
      variance?: number | null;
    }>;
  } | null;
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
  activeRegisterSession: PosCashDrawerSummary | null;
  activeSession: PosRegisterSessionSummary | null;
  activeSessionConflict?: PosActiveSessionConflict | null;
  heldSessions: PosRegisterSessionSummary[];
}

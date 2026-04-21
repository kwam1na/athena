import type { Id } from "../../_generated/dataModel";
import type {
  PosCashierSummary,
  PosRegisterSessionSummary,
  PosServerPhase,
  PosTerminalSummary,
} from "../domain/types";

export interface GetRegisterStateArgs {
  storeId: Id<"store">;
  terminalId?: Id<"posTerminal">;
  cashierId?: Id<"cashier">;
  registerNumber?: string;
}

export interface RegisterStateDto {
  phase: PosServerPhase;
  terminal: PosTerminalSummary | null;
  cashier: PosCashierSummary | null;
  activeSession: PosRegisterSessionSummary | null;
  resumableSession: PosRegisterSessionSummary | null;
}

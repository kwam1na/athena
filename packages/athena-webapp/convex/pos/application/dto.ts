import type { Id } from "../../_generated/dataModel";
import type {
  PosCashDrawerSummary,
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
  activeRegisterSession: PosCashDrawerSummary | null;
  activeSession: PosRegisterSessionSummary | null;
  resumableSession: PosRegisterSessionSummary | null;
}

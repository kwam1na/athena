import type { QueryCtx } from "../../../_generated/server";

import type { GetRegisterStateArgs, RegisterStateDto } from "../dto";
import type { PosRegisterStateInput } from "../../domain/types";
import {
  deriveRegisterPhase,
  selectResumableSession,
} from "../../domain/sessionRules";
import { getCashierForRegisterState } from "../../infrastructure/repositories/cashierRepository";
import {
  getActiveSessionForRegisterState,
  listHeldSessionsForRegisterState,
} from "../../infrastructure/repositories/sessionRepository";
import { getTerminalForRegisterState } from "../../infrastructure/repositories/terminalRepository";

export function buildRegisterState(
  input: PosRegisterStateInput,
): RegisterStateDto {
  const resumableSession = selectResumableSession(input.heldSessions);

  return {
    phase: deriveRegisterPhase({
      hasTerminal: Boolean(input.terminal),
      hasCashier: Boolean(input.cashier),
      activeSessionId: input.activeSession?._id ?? null,
      resumableSessionId: resumableSession?._id ?? null,
    }),
    terminal: input.terminal,
    cashier: input.cashier,
    activeSession: input.activeSession,
    resumableSession,
  };
}

export async function getRegisterState(
  ctx: QueryCtx,
  args: GetRegisterStateArgs,
): Promise<RegisterStateDto> {
  const identity = {
    storeId: args.storeId,
    terminalId: args.terminalId,
    cashierId: args.cashierId,
    registerNumber: args.registerNumber,
  };

  const [terminal, cashier, activeSession, heldSessions] = await Promise.all([
    getTerminalForRegisterState(ctx, identity),
    getCashierForRegisterState(ctx, identity),
    getActiveSessionForRegisterState(ctx, identity),
    listHeldSessionsForRegisterState(ctx, identity),
  ]);

  return buildRegisterState({
    terminal,
    cashier,
    activeSession,
    heldSessions,
  });
}

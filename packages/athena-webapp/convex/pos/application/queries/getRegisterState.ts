import type { QueryCtx } from "../../../_generated/server";
import type { Id } from "../../../_generated/dataModel";

import type { GetRegisterStateArgs, RegisterStateDto } from "../dto";
import type {
  PosActiveSessionConflict,
  PosRegisterStateInput,
} from "../../domain/types";
import {
  deriveRegisterPhase,
  selectResumableSession,
} from "../../domain/sessionRules";
import { getCashierForRegisterState } from "../../infrastructure/repositories/cashierRepository";
import {
  getActiveSessionForRegisterState,
  listHeldSessionsForRegisterState,
} from "../../infrastructure/repositories/sessionRepository";
import { getActiveRegisterSessionForRegisterState } from "../../infrastructure/repositories/registerSessionRepository";
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
    activeRegisterSession: input.activeRegisterSession,
    activeSession: input.activeSession,
    activeSessionConflict: input.activeSessionConflict ?? null,
    resumableSession,
  };
}

async function getActiveSessionConflictForRegisterState(
  ctx: QueryCtx,
  identity: {
    storeId: Id<"store">;
    terminalId?: Id<"posTerminal">;
    staffProfileId?: Id<"staffProfile">;
  },
): Promise<PosActiveSessionConflict | null> {
  if (!identity.terminalId || !identity.staffProfileId) {
    return null;
  }

  const now = Date.now();
  const activeSessions = await ctx.db
    .query("posSession")
    .withIndex("by_storeId_status_staffProfileId", (q) =>
      q
        .eq("storeId", identity.storeId)
        .eq("status", "active")
        .eq("staffProfileId", identity.staffProfileId!),
    )
    .take(20);
  const conflictingSession = activeSessions.find(
    (session) =>
      session.terminalId !== identity.terminalId && session.expiresAt > now,
  );

  if (!conflictingSession) {
    return null;
  }

  return {
    kind: "activeOnOtherTerminal",
    message: "A session is active for this cashier on a different terminal",
    terminalId: conflictingSession.terminalId,
  };
}

export async function getRegisterState(
  ctx: QueryCtx,
  args: GetRegisterStateArgs,
): Promise<RegisterStateDto> {
  const identity = {
    storeId: args.storeId,
    terminalId: args.terminalId,
    staffProfileId: args.staffProfileId,
    registerNumber: args.registerNumber,
  };

  const [
    terminal,
    cashier,
    activeRegisterSession,
    activeSession,
    activeSessionConflict,
    heldSessions,
  ] = await Promise.all([
    getTerminalForRegisterState(ctx, identity),
    getCashierForRegisterState(ctx, identity),
    getActiveRegisterSessionForRegisterState(ctx, identity),
    getActiveSessionForRegisterState(ctx, identity),
    getActiveSessionConflictForRegisterState(ctx, identity),
    listHeldSessionsForRegisterState(ctx, identity),
  ]);

  return buildRegisterState({
    terminal,
    cashier,
    activeRegisterSession,
    activeSession,
    activeSessionConflict,
    heldSessions,
  });
}

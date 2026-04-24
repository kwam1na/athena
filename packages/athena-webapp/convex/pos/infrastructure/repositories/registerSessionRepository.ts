import type { Doc, Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";
import { internal } from "../../../_generated/api";

import type { PosCashDrawerSummary } from "../../domain/types";

type RegisterStateIdentity = {
  storeId: Id<"store">;
  terminalId?: Id<"posTerminal">;
  registerNumber?: string;
};

export function mapRegisterSessionToCashDrawerSummary(
  session: Doc<"registerSession"> | null | undefined,
): PosCashDrawerSummary | null {
  if (!session) {
    return null;
  }

  return {
    _id: session._id,
    status: session.status,
    terminalId: session.terminalId,
    registerNumber: session.registerNumber,
    openingFloat: session.openingFloat,
    expectedCash: session.expectedCash,
    openedAt: session.openedAt,
    notes: session.notes,
    workflowTraceId: session.workflowTraceId,
  };
}

export async function getActiveRegisterSessionForRegisterState(
  ctx: QueryCtx,
  identity: RegisterStateIdentity,
): Promise<PosCashDrawerSummary | null> {
  const session = await ctx.runQuery(
    internal.operations.registerSessions.getRegisterSessionForRegisterState,
    {
      storeId: identity.storeId,
      terminalId: identity.terminalId,
      registerNumber: identity.registerNumber,
    },
  );

  return mapRegisterSessionToCashDrawerSummary(session);
}

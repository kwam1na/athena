import type { Doc, Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";
import { internal } from "../../../_generated/api";

import type { PosCashDrawerSummary } from "../../domain/types";
import {
  buildRegisterSessionLocalSyncStatus,
  listOpenLocalSyncConflictsByRegisterSession,
  type RegisterSessionSyncConflict,
} from "../../application/sync/registerSessionSyncReview";

type RegisterStateIdentity = {
  storeId: Id<"store">;
  terminalId?: Id<"posTerminal">;
  registerNumber?: string;
};

export function mapRegisterSessionToCashDrawerSummary(
  session: Doc<"registerSession"> | null | undefined,
  syncConflicts: RegisterSessionSyncConflict[] = [],
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
    countedCash: session.countedCash,
    managerApprovalRequestId: session.managerApprovalRequestId,
    openedAt: session.openedAt,
    notes: session.notes,
    variance: session.variance,
    workflowTraceId: session.workflowTraceId,
    localSyncStatus: buildRegisterSessionLocalSyncStatus(syncConflicts),
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

  const syncConflictsBySessionId = session
    ? await listOpenLocalSyncConflictsByRegisterSession(ctx, identity.storeId, {
        registerSessionIds: [session._id],
      })
    : null;
  const syncConflicts =
    session && syncConflictsBySessionId
      ? (syncConflictsBySessionId.get(session._id) ?? [])
      : [];

  return mapRegisterSessionToCashDrawerSummary(session, syncConflicts);
}

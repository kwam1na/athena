import type { Doc, Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";

import type { PosRegisterSessionSummary } from "../../domain/types";

const ACTIVE_SESSION_CANDIDATE_LIMIT = 10;
const HELD_SESSION_CANDIDATE_LIMIT = 20;

type RegisterStateIdentity = {
  storeId: Id<"store">;
  terminalId?: Id<"posTerminal">;
  cashierId?: Id<"cashier">;
  registerNumber?: string;
};

type RegisterStateLookupStrategy = "terminal" | "cashier" | "store";

export async function getActiveSessionForRegisterState(
  ctx: QueryCtx,
  identity: RegisterStateIdentity,
): Promise<PosRegisterSessionSummary | null> {
  const sessions = await querySessionsByStatus(ctx, identity, "active");
  return sessions[0] ?? null;
}

export async function listHeldSessionsForRegisterState(
  ctx: QueryCtx,
  identity: RegisterStateIdentity,
): Promise<PosRegisterSessionSummary[]> {
  return querySessionsByStatus(ctx, identity, "held");
}

async function querySessionsByStatus(
  ctx: QueryCtx,
  identity: RegisterStateIdentity,
  status: "active" | "held",
): Promise<PosRegisterSessionSummary[]> {
  const limit =
    status === "active"
      ? ACTIVE_SESSION_CANDIDATE_LIMIT
      : HELD_SESSION_CANDIDATE_LIMIT;

  let sessions: Doc<"posSession">[];
  const strategy = selectRegisterStateLookupStrategy(identity);
  switch (strategy) {
    case "terminal":
      sessions = await ctx.db
        .query("posSession")
        .withIndex("by_storeId_status_terminalId", (q) =>
          q
            .eq("storeId", identity.storeId)
            .eq("status", status)
            .eq("terminalId", identity.terminalId!),
        )
        .order("desc")
        .take(limit);
      break;
    case "cashier":
      sessions = await ctx.db
        .query("posSession")
        .withIndex("by_storeId_status_cashierId", (q) =>
          q
            .eq("storeId", identity.storeId)
            .eq("status", status)
            .eq("cashierId", identity.cashierId!),
        )
        .order("desc")
        .take(limit);
      break;
    default:
      sessions = await ctx.db
        .query("posSession")
        .withIndex("by_storeId_and_status", (q) =>
          q.eq("storeId", identity.storeId).eq("status", status),
        )
        .order("desc")
        .take(limit);
  }

  return summarizeRegisterStateSessions(sessions, identity);
}

export function selectRegisterStateLookupStrategy(
  identity: RegisterStateIdentity,
): RegisterStateLookupStrategy {
  if (identity.terminalId) {
    return "terminal";
  }

  if (identity.cashierId) {
    return "cashier";
  }

  return "store";
}

export function summarizeRegisterStateSessions(
  sessions: Doc<"posSession">[],
  identity: RegisterStateIdentity,
  now: number = Date.now(),
): PosRegisterSessionSummary[] {
  return sessions
    .filter((session) => session.expiresAt >= now)
    .filter((session) => matchesRegisterIdentity(session, identity))
    .map((session) => ({
      _id: session._id,
      sessionNumber: session.sessionNumber,
      status: session.status,
      terminalId: session.terminalId,
      cashierId: session.cashierId,
      registerNumber: session.registerNumber,
      expiresAt: session.expiresAt,
      updatedAt: session.updatedAt,
      heldAt: session.heldAt,
    }));
}

function matchesRegisterIdentity(
  session: Doc<"posSession">,
  identity: RegisterStateIdentity,
): boolean {
  if (identity.terminalId && session.terminalId !== identity.terminalId) {
    return false;
  }

  if (identity.cashierId && session.cashierId !== identity.cashierId) {
    return false;
  }

  return true;
}

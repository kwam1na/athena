import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";

import type { PosTerminalSummary } from "../../domain/types";

type PosTerminalReadCtx = QueryCtx | MutationCtx;

export function mapTerminalRecord(
  terminal: Doc<"posTerminal">,
): Doc<"posTerminal"> {
  return {
    _id: terminal._id,
    _creationTime: terminal._creationTime,
    storeId: terminal.storeId,
    fingerprintHash: terminal.fingerprintHash,
    displayName: terminal.displayName,
    registeredByUserId: terminal.registeredByUserId,
    browserInfo: terminal.browserInfo,
    registeredAt: terminal.registeredAt,
    status: terminal.status,
  };
}

export async function getTerminalForRegisterState(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    terminalId?: Id<"posTerminal">;
  },
): Promise<PosTerminalSummary | null> {
  if (!args.terminalId) {
    return null;
  }

  const terminal = await ctx.db.get("posTerminal", args.terminalId);
  if (
    !terminal ||
    terminal.storeId !== args.storeId ||
    terminal.status !== "active"
  ) {
    return null;
  }

  return {
    _id: terminal._id,
    displayName: terminal.displayName,
    status: terminal.status,
    registeredAt: terminal.registeredAt,
  };
}

export async function listTerminalsForStore(
  ctx: QueryCtx,
  storeId: Id<"store">,
) {
  const terminals = await ctx.db
    .query("posTerminal")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
    .collect();

  return terminals.map(mapTerminalRecord);
}

export async function getTerminalByFingerprint(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    fingerprintHash: string;
  },
) {
  const terminal = await ctx.db
    .query("posTerminal")
    .withIndex("by_storeId_and_fingerprintHash", (q) =>
      q.eq("storeId", args.storeId).eq("fingerprintHash", args.fingerprintHash),
    )
    .first();

  return terminal ? mapTerminalRecord(terminal) : null;
}

export async function getTerminalById(
  ctx: PosTerminalReadCtx,
  terminalId: Id<"posTerminal">,
) {
  return ctx.db.get("posTerminal", terminalId);
}

export async function registerTerminalRecord(
  ctx: MutationCtx,
  input: Omit<Doc<"posTerminal">, "_id" | "_creationTime">,
) {
  return ctx.db.insert("posTerminal", input);
}

export async function patchTerminalRecord(
  ctx: MutationCtx,
  terminalId: Id<"posTerminal">,
  patch: Partial<Omit<Doc<"posTerminal">, "_id" | "_creationTime">>,
) {
  await ctx.db.patch("posTerminal", terminalId, patch);
}

export async function deleteTerminalRecord(
  ctx: MutationCtx,
  terminalId: Id<"posTerminal">,
) {
  await ctx.db.delete("posTerminal", terminalId);
}

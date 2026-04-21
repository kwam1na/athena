import type { QueryCtx } from "../../../_generated/server";
import type { Id } from "../../../_generated/dataModel";

import type { PosTerminalSummary } from "../../domain/types";

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

  const terminal = await ctx.db.get(args.terminalId);
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

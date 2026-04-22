import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { requireAuthenticatedAthenaUserWithCtx } from "../../../lib/athenaUserAuth";
import type { PosCashDrawerSummary } from "../../domain/types";
import { mapRegisterSessionToCashDrawerSummary } from "../../infrastructure/repositories/registerSessionRepository";

export async function openDrawer(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    terminalId?: Id<"posTerminal">;
    registerNumber?: string;
    openingFloat: number;
    notes?: string;
  },
): Promise<PosCashDrawerSummary | null> {
  const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
  const store: Doc<"store"> | null = await ctx.runQuery(
    internal.inventory.stores.findById,
    {
      id: args.storeId,
    },
  );

  if (!store) {
    throw new Error("Store not found.");
  }

  const registerSession: Doc<"registerSession"> | null = await ctx.runMutation(
    internal.operations.registerSessions.openRegisterSession,
    {
      storeId: args.storeId,
      organizationId: store.organizationId,
      terminalId: args.terminalId,
      registerNumber: args.registerNumber,
      openedByUserId: athenaUser._id,
      openingFloat: args.openingFloat,
      notes: args.notes,
    },
  );

  return mapRegisterSessionToCashDrawerSummary(registerSession);
}

import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { requireAuthenticatedAthenaUserWithCtx } from "../../../lib/athenaUserAuth";
import type { PosCashDrawerSummary } from "../../domain/types";
import { mapRegisterSessionToCashDrawerSummary } from "../../infrastructure/repositories/registerSessionRepository";
import {
  ok,
  userError,
  type CommandResult,
} from "../../../../shared/commandResult";

const OPEN_DRAWER_REGISTER_CONFLICT_MESSAGE =
  "A register session is already open for this register.";
const OPEN_DRAWER_TERMINAL_CONFLICT_MESSAGE =
  "A register session is already open for this terminal.";

type OpenDrawerResult = CommandResult<PosCashDrawerSummary | null>;

function mapOpenDrawerUserError(error: unknown): OpenDrawerResult | null {
  if (!(error instanceof Error)) {
    return null;
  }

  if (
    error.message === OPEN_DRAWER_REGISTER_CONFLICT_MESSAGE ||
    error.message === OPEN_DRAWER_TERMINAL_CONFLICT_MESSAGE
  ) {
    return userError({
      code: "conflict",
      message: error.message,
    });
  }

  return null;
}

export async function openDrawer(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    terminalId?: Id<"posTerminal">;
    registerNumber?: string;
    openingFloat: number;
    notes?: string;
  },
): Promise<OpenDrawerResult> {
  const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
  const store: Doc<"store"> | null = await ctx.runQuery(
    internal.inventory.stores.findById,
    {
      id: args.storeId,
    },
  );

  if (!store) {
    return userError({
      code: "not_found",
      message: "Store not found.",
    });
  }

  let registerSession: Doc<"registerSession"> | null;

  try {
    registerSession = await ctx.runMutation(
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
  } catch (error) {
    const userSafeError = mapOpenDrawerUserError(error);
    if (userSafeError) {
      return userSafeError;
    }

    throw error;
  }

  return ok(mapRegisterSessionToCashDrawerSummary(registerSession));
}

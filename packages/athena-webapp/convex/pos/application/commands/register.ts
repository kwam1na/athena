import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../../../lib/athenaUserAuth";
import { getServicePrincipalActorWithCtx } from "../../../servicePrincipals/actor";
import { requirePosApplicationAuthorityWithCtx } from "../posApplicationAuthority";
import type { PosCashDrawerSummary } from "../../domain/types";
import { mapRegisterSessionToCashDrawerSummary } from "../../infrastructure/repositories/registerSessionRepository";
import {
  ok,
  userError,
  type CommandResult,
} from "../../../../shared/commandResult";

const OPEN_DRAWER_TERMINAL_CONFLICT_MESSAGE =
  "A register session is already open for this terminal.";
const OPEN_DRAWER_REGISTER_NUMBER_CONFLICT_MESSAGE =
  "A register session is already open for this register number.";
const OPEN_DRAWER_REGISTER_NUMBER_MISMATCH_MESSAGE =
  "The terminal is configured with a different register number.";
const OPEN_DRAWER_MISSING_REGISTER_NUMBER_MESSAGE =
  "This terminal is not configured with a register number.";
const OPEN_DRAWER_OPERATOR_REQUIRED_MESSAGE =
  "Cashier or manager sign-in required to open this drawer.";

type OpenDrawerResult = CommandResult<PosCashDrawerSummary | null>;

function normalizeRegisterNumber(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function mapOpenDrawerUserError(error: unknown): OpenDrawerResult | null {
  if (!(error instanceof Error)) {
    return null;
  }

  if (error.message.includes(OPEN_DRAWER_TERMINAL_CONFLICT_MESSAGE)) {
    return userError({
      code: "conflict",
      message: OPEN_DRAWER_TERMINAL_CONFLICT_MESSAGE,
    });
  }

  if (error.message.includes(OPEN_DRAWER_REGISTER_NUMBER_CONFLICT_MESSAGE)) {
    return userError({
      code: "conflict",
      message: OPEN_DRAWER_REGISTER_NUMBER_CONFLICT_MESSAGE,
    });
  }

  return null;
}

export async function openDrawer(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    staffProfileId: Id<"staffProfile">;
    registerNumber?: string;
    openingFloat: number;
    notes?: string;
  },
): Promise<OpenDrawerResult> {
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

  const serviceActor = await getServicePrincipalActorWithCtx(ctx);
  let openedByUserId: Id<"athenaUser"> | undefined;
  if (serviceActor) {
    const authority = await requirePosApplicationAuthorityWithCtx(ctx, {
      storeId: args.storeId,
    });
    if (authority.terminalId !== args.terminalId) {
      throw new Error("The POS application session is no longer authorized.");
    }
  } else {
    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    await requireOrganizationMemberRoleWithCtx(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage: "You cannot open a register drawer for this store.",
      organizationId: store.organizationId,
      userId: athenaUser._id,
    });
    openedByUserId = athenaUser._id;
  }

  const terminal = await ctx.db.get("posTerminal", args.terminalId);
  if (!terminal || terminal.storeId !== args.storeId) {
    return userError({
      code: "validation_failed",
      message: "This terminal is not configured for this store.",
    });
  }

  const staffProfile = await ctx.db.get("staffProfile", args.staffProfileId);
  if (
    !staffProfile ||
    staffProfile.storeId !== args.storeId ||
    staffProfile.status !== "active"
  ) {
    return userError({
      code: "validation_failed",
      message: "Register sign-in required. Sign in before opening the drawer.",
    });
  }

  const activeRoleAssignments = await ctx.db
    .query("staffRoleAssignment")
    .withIndex("by_staffProfileId", (q) =>
      q.eq("staffProfileId", args.staffProfileId),
    )
    .take(25);
  const hasDrawerOperatorRole = activeRoleAssignments.some(
    (assignment) =>
      assignment.storeId === args.storeId &&
      assignment.status === "active" &&
      (assignment.role === "cashier" || assignment.role === "manager"),
  );

  if (!hasDrawerOperatorRole) {
    return userError({
      code: "authorization_failed",
      message: OPEN_DRAWER_OPERATOR_REQUIRED_MESSAGE,
    });
  }

  const normalizedTerminalRegisterNumber = normalizeRegisterNumber(
    terminal.registerNumber,
  );
  const normalizedRequestedRegisterNumber = normalizeRegisterNumber(
    args.registerNumber,
  );

  if (!normalizedTerminalRegisterNumber) {
    return userError({
      code: "validation_failed",
      message: OPEN_DRAWER_MISSING_REGISTER_NUMBER_MESSAGE,
    });
  }

  if (
    normalizedRequestedRegisterNumber &&
    normalizedRequestedRegisterNumber !== normalizedTerminalRegisterNumber
  ) {
    return userError({
      code: "validation_failed",
      message: OPEN_DRAWER_REGISTER_NUMBER_MISMATCH_MESSAGE,
    });
  }

  const resolvedRegisterNumber = normalizedTerminalRegisterNumber;

  let registerSession: Doc<"registerSession"> | null;

  try {
    registerSession = await ctx.runMutation(
      internal.operations.registerSessions.openRegisterSession,
      {
        storeId: args.storeId,
        organizationId: store.organizationId,
        terminalId: args.terminalId,
        registerNumber: resolvedRegisterNumber,
        openedByUserId,
        openedByStaffProfileId: args.staffProfileId,
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

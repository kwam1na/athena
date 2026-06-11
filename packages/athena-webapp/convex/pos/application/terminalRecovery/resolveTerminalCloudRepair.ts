import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import {
  ok,
  userError,
  type CommandResult,
} from "../../../../shared/commandResult";
import {
  buildTerminalCloudRepairPreview,
  classifyTerminalCloudRepairConflict,
} from "./cloudRepairPolicy";
import {
  getTerminalRecoverySourceEvent,
  listTerminalRecoveryConflictsForRepair,
  patchTerminalRecoveryConflict,
} from "../../infrastructure/repositories/terminalRecoveryRepository";

export async function resolveTerminalCloudRepair(
  ctx: MutationCtx,
  args: {
    expectedPreconditionHash: string;
    now: number;
    resolvedByStaffProfileId?: Id<"staffProfile">;
    resolvedByUserId: Id<"athenaUser">;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
): Promise<
  CommandResult<{
    preconditionHash: string;
    resolvedConflictIds: Array<Id<"posLocalSyncConflict">>;
    skippedConflictIds: Array<Id<"posLocalSyncConflict">>;
  }>
> {
  const conflicts = await listTerminalRecoveryConflictsForRepair(ctx, args);
  const classified = await Promise.all(
    conflicts.map(async (conflict) =>
      classifyTerminalCloudRepairConflict({
        conflict,
        now: args.now,
        sourceEvent: await getTerminalRecoverySourceEvent(ctx, {
          storeId: args.storeId,
          terminalId: args.terminalId,
          localEventId: conflict.localEventId,
        }),
        storeId: args.storeId,
        terminalId: args.terminalId,
      }),
    ),
  );
  const preview = buildTerminalCloudRepairPreview({
    classified,
    storeId: args.storeId,
    terminalId: args.terminalId,
  });

  if (preview.preconditionHash !== args.expectedPreconditionHash) {
    return userError({
      code: "precondition_failed",
      message: "Terminal recovery evidence changed. Preview the repair again.",
      metadata: {
        preconditionDrift: true,
      },
    });
  }

  for (const conflictId of preview.safeConflictIds) {
    await patchTerminalRecoveryConflict(ctx, conflictId, {
      resolvedAt: args.now,
      resolvedByStaffProfileId: args.resolvedByStaffProfileId,
      resolvedByUserId: args.resolvedByUserId,
      status: "resolved",
    });
  }

  return ok({
    preconditionHash: preview.preconditionHash,
    resolvedConflictIds: preview.safeConflictIds,
    skippedConflictIds: preview.skipped.map((item) => item.conflictId),
  });
}

import type { MutationCtx } from "../../../_generated/server";
import type { Doc, Id } from "../../../_generated/dataModel";
import type { TerminalRuntimeStatusInput } from "../commands/terminals";
import { buildPosRemoteAssistClientPresence } from "../../../remoteAssist/application/posRuntimeAdapter";
import { claimRemoteAssistSession } from "../../../remoteAssist/application/sessionService";
import { createRemoteAssistRepository } from "../../../remoteAssist/infrastructure/remoteAssistRepository";
import { verifyTerminalRecoveryCommandsFromRuntime } from "../terminalRecovery/terminalCommandService";
import { createTerminalRecoveryCommandRepository } from "../../infrastructure/repositories/terminalRecoveryRepository";

type AcceptedRuntimeStatusSideEffectsArgs = {
  ctx: MutationCtx;
  receivedAt: number;
  runtimeStatus: TerminalRuntimeStatusInput;
  storeId: Id<"store">;
  terminal: Doc<"posTerminal">;
  terminalId: Id<"posTerminal">;
};

export async function runAcceptedRuntimeStatusSideEffects(
  args: AcceptedRuntimeStatusSideEffectsArgs,
) {
  await reportRemoteAssistPresenceDiagnosticOnly(args);
  await verifyTerminalRecoveryCommandsFromRuntime(
    createTerminalRecoveryCommandRepository(args.ctx),
    {
      runtimeStatus: {
        _id: "runtime-status-current" as never,
        _creationTime: args.receivedAt,
        storeId: args.storeId,
        terminalId: args.terminalId,
        receivedAt: args.receivedAt,
        ...args.runtimeStatus,
      },
      storeId: args.storeId,
      terminalId: args.terminalId,
      verifiedAt: args.receivedAt,
    },
  );
}

async function reportRemoteAssistPresenceDiagnosticOnly(
  args: AcceptedRuntimeStatusSideEffectsArgs,
) {
  try {
    const store = await args.ctx.db.get("store", args.storeId);
    if (!store) {
      return;
    }

    const remoteAssistRepository = createRemoteAssistRepository(args.ctx);
    const remoteAssistClient = await remoteAssistRepository.upsertClient(
      buildPosRemoteAssistClientPresence({
        receivedAt: args.receivedAt,
        runtimeStatus: {
          browserInfo: args.runtimeStatus.browserInfo,
        },
        store,
        terminal: args.terminal,
      }),
    );
    const currentRemoteAssistSession =
      await remoteAssistRepository.getCurrentSessionForClient({
        clientId: remoteAssistClient._id,
        now: args.receivedAt,
      });
    if (currentRemoteAssistSession?.status === "connecting") {
      await claimRemoteAssistSession(remoteAssistRepository, {
        clientId: remoteAssistClient._id,
        now: args.receivedAt,
        sessionId: currentRemoteAssistSession._id,
      });
    }
  } catch (error) {
    console.warn("[pos-runtime] remote-assist-side-effect-failed", {
      errorName: error instanceof Error ? error.name : typeof error,
      storeId: args.storeId,
      terminalId: args.terminalId,
    });
  }
}

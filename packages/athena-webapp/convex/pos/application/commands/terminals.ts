import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { ok, userError, type CommandResult } from "../../../../shared/commandResult";

import {
  getTerminalByFingerprint,
  getTerminalById,
  getTerminalByStoreIdAndRegisterNumber,
  mapTerminalRecord,
  patchTerminalRecord,
  registerTerminalRecord,
} from "../../infrastructure/repositories/terminalRepository";
import { deleteTerminalRecord } from "../../infrastructure/repositories/terminalRepository";

const REGISTER_NUMBER_REQUIRED_MESSAGE =
  "A register number is required to identify the terminal.";
const REGISTER_NUMBER_UNIQUE_MESSAGE =
  "A terminal with this register number already exists in this store.";

const REGISTER_TERMINAL_VALIDATION_MESSAGES = new Set([
  REGISTER_NUMBER_REQUIRED_MESSAGE,
  REGISTER_NUMBER_UNIQUE_MESSAGE,
]);

function normalizeRegisterNumber(value?: string): string | undefined {
  const registerNumber = value?.trim();
  return registerNumber && registerNumber.length > 0 ? registerNumber : undefined;
}

function mapRegisterTerminalError(
  error: unknown,
): CommandResult<never> | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  if (REGISTER_TERMINAL_VALIDATION_MESSAGES.has(error.message)) {
    return userError({
      code: "validation_failed",
      message: error.message,
    });
  }

  return undefined;
}

async function assertRegisterNumberIsAvailable(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    registerNumber: string;
    terminalId?: Id<"posTerminal">;
  },
): Promise<string> {
  const registerNumber = normalizeRegisterNumber(args.registerNumber);
  if (!registerNumber) {
    throw new Error(REGISTER_NUMBER_REQUIRED_MESSAGE);
  }

  const conflict = await getTerminalByStoreIdAndRegisterNumber(ctx, {
    storeId: args.storeId,
    registerNumber,
  });
  if (conflict && (!args.terminalId || conflict._id !== args.terminalId)) {
    throw new Error(REGISTER_NUMBER_UNIQUE_MESSAGE);
  }

  return registerNumber;
}

export async function registerTerminal(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    fingerprintHash: string;
    displayName: string;
    registerNumber: string;
    registeredByUserId: Id<"athenaUser">;
    browserInfo: Doc<"posTerminal">["browserInfo"];
  },
): Promise<CommandResult<Doc<"posTerminal">>> {
  try {
    const existing = await getTerminalByFingerprint(ctx, {
      storeId: args.storeId,
      fingerprintHash: args.fingerprintHash,
    });
    const nextRegisterNumber = await assertRegisterNumberIsAvailable(ctx, {
      storeId: args.storeId,
      registerNumber: args.registerNumber,
      terminalId: existing?._id,
    });

    if (existing) {
      await patchTerminalRecord(ctx, existing._id, {
        displayName: args.displayName,
        registeredByUserId: args.registeredByUserId,
        browserInfo: args.browserInfo,
        status: "active",
        registerNumber: nextRegisterNumber,
      });

      return ok({
        ...mapTerminalRecord(existing),
        displayName: args.displayName,
        registeredByUserId: args.registeredByUserId,
        browserInfo: args.browserInfo,
        status: "active",
        registerNumber: nextRegisterNumber,
      });
    }

    const terminalId = await registerTerminalRecord(ctx, {
      storeId: args.storeId,
      fingerprintHash: args.fingerprintHash,
      displayName: args.displayName,
      registerNumber: nextRegisterNumber,
      registeredByUserId: args.registeredByUserId,
      browserInfo: args.browserInfo,
      registeredAt: Date.now(),
      status: "active",
    });
    const terminal = await getTerminalById(ctx, terminalId);

    return ok(mapTerminalRecord(terminal!));
  } catch (error) {
    const mappedError = mapRegisterTerminalError(error);
    if (mappedError) {
      return mappedError;
    }
    throw error;
  }
}

export async function updateTerminal(
  ctx: MutationCtx,
  args: {
    terminalId: Id<"posTerminal">;
    displayName?: string;
    status?: "active" | "revoked" | "lost";
    browserInfo?: Doc<"posTerminal">["browserInfo"];
  },
) {
  const terminal = await getTerminalById(ctx, args.terminalId);
  if (!terminal) {
    throw new Error("Terminal not found");
  }

  const updates: Partial<Doc<"posTerminal">> = {};
  if (args.displayName !== undefined) {
    updates.displayName = args.displayName;
  }
  if (args.status !== undefined) {
    updates.status = args.status;
  }
  if (args.browserInfo !== undefined) {
    updates.browserInfo = args.browserInfo;
  }

  if (Object.keys(updates).length === 0) {
    return mapTerminalRecord(terminal);
  }

  await patchTerminalRecord(ctx, args.terminalId, updates);
  const updated = await getTerminalById(ctx, args.terminalId);

  return mapTerminalRecord(updated!);
}

export async function deleteTerminal(
  ctx: MutationCtx,
  args: {
    terminalId: Id<"posTerminal">;
  },
) {
  await deleteTerminalRecord(ctx, args.terminalId);
  return null;
}

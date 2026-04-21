import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";

import {
  getTerminalByFingerprint,
  getTerminalById,
  mapTerminalRecord,
  patchTerminalRecord,
  registerTerminalRecord,
} from "../../infrastructure/repositories/terminalRepository";
import { deleteTerminalRecord } from "../../infrastructure/repositories/terminalRepository";

export async function registerTerminal(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    fingerprintHash: string;
    displayName: string;
    registeredByUserId: Id<"athenaUser">;
    browserInfo: Doc<"posTerminal">["browserInfo"];
  },
) {
  const existing = await getTerminalByFingerprint(ctx, {
    storeId: args.storeId,
    fingerprintHash: args.fingerprintHash,
  });

  if (existing) {
    await patchTerminalRecord(ctx, existing._id, {
      displayName: args.displayName,
      registeredByUserId: args.registeredByUserId,
      browserInfo: args.browserInfo,
      status: "active",
    });

    const updated = await getTerminalById(ctx, existing._id);
    return mapTerminalRecord(updated!);
  }

  const terminalId = await registerTerminalRecord(ctx, {
    storeId: args.storeId,
    fingerprintHash: args.fingerprintHash,
    displayName: args.displayName,
    registeredByUserId: args.registeredByUserId,
    browserInfo: args.browserInfo,
    registeredAt: Date.now(),
    status: "active",
  });
  const terminal = await getTerminalById(ctx, terminalId);

  return mapTerminalRecord(terminal!);
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

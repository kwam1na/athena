import type { Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";

import {
  getTerminalByFingerprint as getTerminalByFingerprintRecord,
  listTerminalsForStore,
} from "../../infrastructure/repositories/terminalRepository";

export async function listTerminals(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
  },
) {
  return listTerminalsForStore(ctx, args.storeId);
}

export async function getTerminalByFingerprint(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    fingerprintHash: string;
  },
) {
  return getTerminalByFingerprintRecord(ctx, args);
}

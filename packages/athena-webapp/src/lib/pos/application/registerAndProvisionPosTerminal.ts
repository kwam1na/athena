import type { Id } from "~/convex/_generated/dataModel";

import type { BrowserInfo } from "@/lib/browserFingerprint";
import {
  createIndexedDbPosLocalStorageAdapter,
  createPosLocalStore,
  POS_LOCAL_STORE_SCHEMA_VERSION,
} from "@/lib/pos/infrastructure/local/posLocalStore";

type TerminalStatus = "active" | "revoked" | "lost";

export type ProvisionedTerminalRecord = {
  _id: Id<"posTerminal">;
  _creationTime: number;
  storeId: Id<"store">;
  fingerprintHash: string;
  syncSecretHash?: string;
  displayName: string;
  registerNumber?: string;
  registeredByUserId: Id<"athenaUser">;
  browserInfo: BrowserInfo;
  registeredAt: number;
  status: TerminalStatus;
};

async function createTerminalSyncSecretToken() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function registerAndProvisionPosTerminal(input: {
  activeStoreId: Id<"store">;
  browserInfo: BrowserInfo;
  displayName: string;
  fingerprintHash: string;
  registerNumber: string;
  registerTerminalMutation: (args: {
    browserInfo: BrowserInfo;
    displayName: string;
    fingerprintHash: string;
    registerNumber: string;
    storeId: Id<"store">;
    syncSecretHash: string;
  }) => Promise<
    | { kind: "ok"; data: ProvisionedTerminalRecord }
    | { kind: "user_error"; error: { message: string } }
  >;
  storeFactory?: () => ReturnType<typeof createPosLocalStore>;
  now?: () => number;
}) {
  const syncSecretToken = await createTerminalSyncSecretToken();
  const result = await input.registerTerminalMutation({
    storeId: input.activeStoreId,
    fingerprintHash: input.fingerprintHash,
    syncSecretHash: syncSecretToken,
    displayName: input.displayName,
    registerNumber: input.registerNumber,
    browserInfo: input.browserInfo,
  });
  if (result.kind === "user_error") return result;

  const seedWrite = await (
    input.storeFactory?.() ??
    createPosLocalStore({
      adapter: createIndexedDbPosLocalStorageAdapter(),
    })
  ).writeProvisionedTerminalSeed({
    terminalId: input.fingerprintHash,
    cloudTerminalId: result.data._id,
    syncSecretHash: result.data.syncSecretHash ?? syncSecretToken,
    storeId: input.activeStoreId,
    registerNumber: result.data.registerNumber,
    displayName: result.data.displayName,
    provisionedAt: input.now?.() ?? Date.now(),
    schemaVersion: POS_LOCAL_STORE_SCHEMA_VERSION,
  });
  if (!seedWrite.ok) {
    throw new Error(seedWrite.error.message);
  }

  return result;
}

import type { Id } from "~/convex/_generated/dataModel";
import {
  DEFAULT_POS_TERMINAL_TRANSACTION_CAPABILITY,
  normalizePosTerminalTransactionCapability,
  type PosTerminalTransactionCapability,
} from "~/shared/posTerminalCapability";
import {
  DEFAULT_POS_TERMINAL_LOGIN_MODE,
  normalizePosTerminalLoginMode,
  type PosTerminalLoginMode,
} from "~/shared/posTerminalLoginMode";

import type { BrowserInfo } from "@/lib/browserFingerprint";
import { POS_LOCAL_LOGICAL_RECORD_VERSION } from "./posLocalStoreTypes";
import type {
  PosLocalIntegrityPort,
  PosLocalSeedPort,
} from "./posLocalStorePort";

type TerminalStatus = "active" | "revoked" | "lost";

export type ProvisionedTerminalRecord = {
  _id: Id<"posTerminal">;
  _creationTime: number;
  storeId: Id<"store">;
  fingerprintHash: string;
  heartbeatEnabled?: boolean;
  syncSecretHash?: string;
  displayName: string;
  registerNumber?: string;
  loginMode?: PosTerminalLoginMode;
  transactionCapability?: PosTerminalTransactionCapability;
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
  heartbeatEnabled?: boolean;
  orgUrlSlug?: string;
  registerNumber: string;
  requestPersistentStorage?: () => Promise<unknown>;
  loginMode?: PosTerminalLoginMode;
  transactionCapability?: PosTerminalTransactionCapability;
  registerTerminalMutation: (args: {
    browserInfo: BrowserInfo;
    displayName: string;
    fingerprintHash: string;
    heartbeatEnabled?: boolean;
    loginMode?: PosTerminalLoginMode;
    registerNumber: string;
    storeId: Id<"store">;
    syncSecretHash: string;
    transactionCapability?: PosTerminalTransactionCapability;
  }) => Promise<
    | { kind: "ok"; data: ProvisionedTerminalRecord }
    | { kind: "user_error"; error: { message: string } }
  >;
  storeFactory: () => PosLocalSeedPort & PosLocalIntegrityPort;
  storeUrlSlug?: string;
  now?: () => number;
}) {
  // Advisory only: denial must not block provisioning or local POS operation.
  try {
    await input.requestPersistentStorage?.();
  } catch {
    // Persistence capability is reflected through storage health after setup.
  }
  const syncSecretToken = await createTerminalSyncSecretToken();
  const result = await input.registerTerminalMutation({
    storeId: input.activeStoreId,
    fingerprintHash: input.fingerprintHash,
    ...(input.heartbeatEnabled === undefined
      ? {}
      : { heartbeatEnabled: input.heartbeatEnabled }),
    syncSecretHash: syncSecretToken,
    displayName: input.displayName,
    registerNumber: input.registerNumber,
    ...(input.loginMode
      ? { loginMode: normalizePosTerminalLoginMode(input.loginMode) }
      : {}),
    ...(input.transactionCapability
      ? {
          transactionCapability: normalizePosTerminalTransactionCapability(
            input.transactionCapability,
          ),
        }
      : {}),
    browserInfo: input.browserInfo,
  });
  if (result.kind === "user_error") return result;

  const store = input.storeFactory();
  const seed = {
    terminalId: input.fingerprintHash,
    cloudTerminalId: result.data._id,
    syncSecretHash: result.data.syncSecretHash ?? syncSecretToken,
    storeId: input.activeStoreId,
    orgUrlSlug: input.orgUrlSlug,
    registerNumber: result.data.registerNumber,
    loginMode:
      result.data.loginMode ??
      normalizePosTerminalLoginMode(input.loginMode) ??
      DEFAULT_POS_TERMINAL_LOGIN_MODE,
    transactionCapability:
      result.data.transactionCapability ??
      normalizePosTerminalTransactionCapability(input.transactionCapability) ??
      DEFAULT_POS_TERMINAL_TRANSACTION_CAPABILITY,
    displayName: result.data.displayName,
    provisionedAt: input.now?.() ?? Date.now(),
    schemaVersion: POS_LOCAL_LOGICAL_RECORD_VERSION,
    storeUrlSlug: input.storeUrlSlug,
  };
  const seedWrite = store.writeProvisionedTerminalSeedAndClearTerminalIntegrity
    ? await store.writeProvisionedTerminalSeedAndClearTerminalIntegrity({
        seed,
        terminalIntegrity: {
          storeId: input.activeStoreId,
          terminalId: input.fingerprintHash,
        },
      })
    : await store.writeProvisionedTerminalSeed(seed);
  if (!seedWrite.ok) {
    throw new Error(seedWrite.error.message);
  }
  if (
    !store.writeProvisionedTerminalSeedAndClearTerminalIntegrity &&
    typeof store.clearTerminalIntegrityState === "function"
  ) {
    const integrityClear = await store.clearTerminalIntegrityState({
      storeId: input.activeStoreId,
      terminalId: input.fingerprintHash,
    });
    if (!integrityClear.ok) {
      throw new Error(integrityClear.error.message);
    }
  }

  return result;
}

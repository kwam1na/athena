import { api } from "~/convex/_generated/api";
import { convex } from "../convexClient";
import { getDefaultPosLocalStore } from "@/lib/pos/infrastructure/local/posLocalStorageRuntime";
import { verifyPosOfflineAuthorityReceipt } from "@/lib/pos/security/offlineAuthorityPublicKeys";
import type { PosRecoveryActivation } from "@/components/auth/Login/posRecoveryFlow";

const ASSERTION_ATTEMPTS = 40;
const ASSERTION_RETRY_DELAY_MS = 50;

export async function assertActivatedPosRecoverySession(
  expected: PosRecoveryActivation,
) {
  for (let attempt = 0; attempt < ASSERTION_ATTEMPTS; attempt += 1) {
    try {
      const current = await loadCurrentActivation();
      if (
        current.authorityExpiresAt === expected.authorityExpiresAt &&
        current.offlineAuthorityReceipt === expected.offlineAuthorityReceipt &&
        current.posApplicationSessionBindingId ===
          expected.posApplicationSessionBindingId &&
        current.servicePrincipalSessionId ===
          expected.servicePrincipalSessionId &&
        current.storeId === expected.storeId &&
        current.terminalId === expected.terminalId
      ) {
        await persistActivatedOfflineAuthorityReceipt(expected);
        return;
      }
    } catch {
      // The root provider remount is asynchronous; retry against its new token.
    }
    await retryDelay();
  }
  throw new Error("pos_recovery_session_assertion_failed");
}

export async function recoverPromotedPosRecoverySession() {
  for (let attempt = 0; attempt < ASSERTION_ATTEMPTS; attempt += 1) {
    try {
      const activation = await loadCurrentActivation();
      await persistActivatedOfflineAuthorityReceipt(activation);
      return activation;
    } catch {
      // The promoted provider may still be mounting against pending storage.
    }
    await retryDelay();
  }
  throw new Error("pos_recovery_session_assertion_failed");
}

async function loadCurrentActivation(): Promise<PosRecoveryActivation> {
  const current = await convex.query(
    api.pos.public.terminalAppSessions.getCurrentPosTerminalServiceSession,
    {},
  );
  return {
    authorityExpiresAt: current.authorityExpiresAt,
    offlineAuthorityReceipt: current.offlineAuthorityReceipt,
    posApplicationSessionBindingId: current.posApplicationSessionBindingId,
    servicePrincipalSessionId: current.servicePrincipalSessionId,
    storeId: current.storeId,
    terminalId: current.terminalId,
  };
}

async function persistActivatedOfflineAuthorityReceipt(
  activation: PosRecoveryActivation,
) {
  const verification = await verifyPosOfflineAuthorityReceipt({
    envelope: activation.offlineAuthorityReceipt,
    expectedStoreId: activation.storeId,
    expectedTerminalId: activation.terminalId,
  });
  if (verification.status !== "valid") {
    throw new Error("pos_offline_authority_receipt_invalid");
  }

  const store = getDefaultPosLocalStore();
  const seedResult = await store.readProvisionedTerminalSeed();
  const seed = seedResult.ok ? seedResult.value : null;
  if (
    !seed ||
    seed.storeId !== activation.storeId ||
    seed.cloudTerminalId !== activation.terminalId
  ) {
    throw new Error("pos_offline_authority_receipt_scope_invalid");
  }
  const writeResult = await store.writeProvisionedTerminalSeed({
    ...seed,
    offlineAuthorityReceipt: verification.receipt,
  });
  if (!writeResult.ok) {
    throw new Error("pos_offline_authority_receipt_persistence_failed");
  }
}

function retryDelay() {
  return new Promise((resolve) =>
    window.setTimeout(resolve, ASSERTION_RETRY_DELAY_MS),
  );
}

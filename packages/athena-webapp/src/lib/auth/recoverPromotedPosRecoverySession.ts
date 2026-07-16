import { api } from "~/convex/_generated/api";
import { convex } from "../convexClient";
import { getDefaultPosLocalStore } from "@/lib/pos/infrastructure/local/posLocalStorageRuntime";
import { verifyPosOfflineAuthorityReceipt } from "@/lib/pos/security/offlineAuthorityPublicKeys";
import type { PosRecoveryActivation } from "@/components/auth/Login/posRecoveryFlow";

const ASSERTION_ATTEMPTS = 40;
const ASSERTION_RETRY_MIN_DELAY_MS = 50;
const ASSERTION_RETRY_MAX_DELAY_MS = 1_000;

export async function assertActivatedPosRecoverySession(
  expected: PosRecoveryActivation,
) {
  for (let attempt = 0; attempt < ASSERTION_ATTEMPTS; attempt += 1) {
    try {
      const current = await loadCurrentActivation();
      if (
        current !== null &&
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
      // Transport failures are retried alongside the not-yet-remounted state.
    }
    await retryDelay(attempt);
  }
  throw new Error("pos_recovery_session_assertion_failed");
}

export async function recoverPromotedPosRecoverySession() {
  for (let attempt = 0; attempt < ASSERTION_ATTEMPTS; attempt += 1) {
    try {
      const activation = await loadCurrentActivation();
      if (activation !== null) {
        await persistActivatedOfflineAuthorityReceipt(activation);
        return activation;
      }
    } catch {
      // Transport failures are retried alongside the not-yet-remounted state.
    }
    await retryDelay(attempt);
  }
  throw new Error("pos_recovery_session_assertion_failed");
}

async function loadCurrentActivation(): Promise<PosRecoveryActivation | null> {
  const current = await convex.query(
    api.pos.public.terminalAppSessions.getCurrentPosTerminalServiceSession,
    {},
  );
  // The root provider remount is asynchronous; the caller retries against the
  // new token once the query reports an authorized service session.
  if (current.status !== "active") return null;
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

function retryDelay(attempt: number) {
  // Fast polls cover the common quick remount; later polls back off so the
  // overall window tolerates a slow auth handshake without giving up early.
  const delayMs = Math.min(
    ASSERTION_RETRY_MIN_DELAY_MS * 2 ** Math.floor(attempt / 5),
    ASSERTION_RETRY_MAX_DELAY_MS,
  );
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

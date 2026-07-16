import { useEffect, useMemo, useRef, useState } from "react";

import {
  LOGGED_IN_USER_ID_KEY,
  POS_APP_ACCOUNT_ID_KEY,
} from "@/lib/constants";
import {
  POS_OFFLINE_AUTHORITY_PUBLIC_KEYS,
  verifyPosOfflineAuthorityReceipt,
  type PosOfflineAuthorityPublicKey,
} from "@/lib/pos/security/offlineAuthorityPublicKeys";
import type { Id } from "~/convex/_generated/dataModel";
import type { PosLocalEntryContext } from "../local/localPosEntryContext";

const POS_HUB_ROUTE_INTENT = "pos_hub";

export type PosTerminalAppSessionRecoveryAssertion = {
  expiresAt: number;
  issuedAt: number;
  nonce: string;
  receiptVersion: number;
  storeId: string;
  terminalId: string;
};

export type PosTerminalAppSessionRecoveryBlockReason =
  | "app_account_disabled"
  | "app_account_not_pos_scoped"
  | "invalid_terminal_proof"
  | "missing_terminal_proof"
  | "pos_recovery_required"
  | "receipt_invalid"
  | "retry_exhausted"
  | "stale_assertion"
  | "store_mismatch"
  | "terminal_not_available"
  | "terminal_revoked"
  | "unsupported_route_scope";

export type PosTerminalAppSessionRecoveryState =
  | {
      assertion: null;
      reason: null;
      status: "idle" | "validating" | "waiting_for_network";
    }
  | {
      assertion: null;
      attempt: number;
      reason: null;
      status: "retrying";
    }
  | {
      assertion: PosTerminalAppSessionRecoveryAssertion;
      reason: null;
      status: "recoverable";
    }
  | {
      assertion: null;
      reason: PosTerminalAppSessionRecoveryBlockReason;
      status: "blocked";
    };

export type PosTerminalAppSessionRecoveryScheduleRetry = (
  delayMs: number,
  retry: () => void,
) => () => void;

export type PosTerminalAppSessionRecoveryInput = {
  enabled?: boolean;
  isAppUserMissing: boolean;
  localEntryContext: PosLocalEntryContext;
  /** Legacy account IDs are migration metadata only and never authority. */
  storedAppAccountId?: Id<"athenaUser"> | string | null;
  routeIntent?: string | null;
  scheduleValidationTimeout?: PosTerminalAppSessionRecoveryScheduleRetry;
  publicKeys?: readonly PosOfflineAuthorityPublicKey[];
  now?: () => number;
};

const idleState: PosTerminalAppSessionRecoveryState = {
  assertion: null,
  reason: null,
  status: "idle",
};

export function readStoredPosAppAccountId(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const storedPosAccountId = window.localStorage.getItem(POS_APP_ACCOUNT_ID_KEY);
    if (storedPosAccountId) return storedPosAccountId;

    const legacyLoggedInUserId = window.localStorage.getItem(LOGGED_IN_USER_ID_KEY);
    if (legacyLoggedInUserId) {
      window.localStorage.setItem(POS_APP_ACCOUNT_ID_KEY, legacyLoggedInUserId);
    }
    return legacyLoggedInUserId;
  } catch {
    return null;
  }
}

export function resetPosTerminalAppSessionRecoveryRuntimeForTests() {
  // Retained as a compatibility seam for callers that reset the old shared
  // mutation cache. Receipt verification has no cross-hook mutable cache.
}

export function usePosTerminalAppSessionRecovery(
  input: PosTerminalAppSessionRecoveryInput,
): PosTerminalAppSessionRecoveryState {
  const [state, setState] =
    useState<PosTerminalAppSessionRecoveryState>(idleState);
  const localEntry =
    input.localEntryContext.status === "ready"
      ? input.localEntryContext
      : null;
  const localStoreId = localEntry?.storeId;
  const terminalSeedStoreId = localEntry?.terminalSeed?.storeId;
  const terminalId = localEntry?.terminalSeed?.cloudTerminalId;
  const receiptEnvelope =
    localEntry?.terminalSeed?.offlineAuthorityReceipt?.envelope;
  const target = useMemo(() => {
    if (
      input.enabled === false ||
      input.routeIntent !== POS_HUB_ROUTE_INTENT ||
      !input.isAppUserMissing ||
      !localStoreId ||
      !terminalSeedStoreId ||
      !terminalId
    ) {
      return null;
    }
    if (terminalSeedStoreId !== localStoreId) {
      return { status: "store_mismatch" as const };
    }
    return {
      envelope: receiptEnvelope ?? null,
      status: "ready" as const,
      storeId: localStoreId,
      terminalId,
    };
  }, [
    input.enabled,
    input.isAppUserMissing,
    input.routeIntent,
    localStoreId,
    receiptEnvelope,
    terminalId,
    terminalSeedStoreId,
  ]);
  const publicKeys = input.publicKeys ?? POS_OFFLINE_AUTHORITY_PUBLIC_KEYS;
  const nowRef = useRef(input.now ?? Date.now);
  const now = nowRef.current;

  useEffect(() => {
    let cancelled = false;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    if (!target) {
      setState(idleState);
      return;
    }
    if (target.status === "store_mismatch") {
      setState({ assertion: null, reason: "store_mismatch", status: "blocked" });
      return;
    }
    if (!target.envelope) {
      setState({
        assertion: null,
        reason: "pos_recovery_required",
        status: "blocked",
      });
      return;
    }

    setState({ assertion: null, reason: null, status: "validating" });
    void verifyPosOfflineAuthorityReceipt({
      envelope: target.envelope,
      expectedStoreId: target.storeId,
      expectedTerminalId: target.terminalId,
      now: now(),
      publicKeys,
    }).then((verification) => {
      if (cancelled) return;
      if (verification.status !== "valid") {
        setState({
          assertion: null,
          reason:
            verification.reason === "outside_lease"
              ? "stale_assertion"
              : "receipt_invalid",
          status: "blocked",
        });
        return;
      }
      const { payload } = verification.receipt;
      setState({
        assertion: {
          expiresAt: payload.expiresAt,
          issuedAt: payload.issuedAt,
          nonce: payload.nonce,
          receiptVersion: payload.version,
          storeId: payload.storeId,
          terminalId: payload.terminalId,
        },
        reason: null,
        status: "recoverable",
      });
      const delayMs = Math.max(0, payload.expiresAt - now() + 1);
      expiryTimer = setTimeout(() => {
        if (!cancelled) {
          setState({
            assertion: null,
            reason: "stale_assertion",
            status: "blocked",
          });
        }
      }, delayMs);
    });

    return () => {
      cancelled = true;
      if (expiryTimer) clearTimeout(expiryTimer);
    };
  }, [now, publicKeys, target]);

  return state;
}

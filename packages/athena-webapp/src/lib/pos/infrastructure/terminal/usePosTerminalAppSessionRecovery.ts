import { useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionArgs } from "convex/server";

import {
  LOGGED_IN_USER_ID_KEY,
  POS_APP_ACCOUNT_ID_KEY,
} from "@/lib/constants";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import type { PosLocalEntryContext } from "../local/localPosEntryContext";

const POS_HUB_ROUTE_INTENT = "pos_hub";
const DEFAULT_RETRY_DELAYS_MS = [500, 1_500, 3_000];
const DEFAULT_VALIDATION_TIMEOUT_MS = 10_000;

type ValidateRecoveryArgs = FunctionArgs<
  typeof api.pos.public.terminalAppSessions.validateTerminalAppSessionRecovery
>;

type RecoveryBlockedReason =
  | "missing_terminal_proof"
  | "terminal_not_available"
  | "invalid_terminal_proof"
  | "store_mismatch"
  | "terminal_revoked"
  | "app_account_disabled"
  | "app_account_not_pos_scoped"
  | "unsupported_route_scope";

export type PosTerminalAppSessionRecoveryAssertion = {
  accountId: Id<"athenaUser">;
  expiresAt: number;
  issuedAt: number;
  recoveryAttemptId: string;
  routeScope: typeof POS_HUB_ROUTE_INTENT;
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
};

type RecoveryResult =
  | {
      assertion: PosTerminalAppSessionRecoveryAssertion;
      diagnostics: { reason: "validated" };
      status: "recoverable";
    }
  | {
      diagnostics: { reason: RecoveryBlockedReason };
      reason: RecoveryBlockedReason;
      status: "blocked";
    }
  | {
      diagnostics: { reason: "transient_failure" };
      status: "retryable";
    };

type ValidateRecoveryMutation = (
  args: ValidateRecoveryArgs,
) => Promise<RecoveryResult>;

export type PosTerminalAppSessionRecoveryBlockReason =
  | RecoveryBlockedReason
  | "retry_exhausted"
  | "stale_assertion";

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
  retryDelaysMs?: number[];
  routeIntent?: string | null;
  scheduleRetry?: PosTerminalAppSessionRecoveryScheduleRetry;
  scheduleValidationTimeout?: PosTerminalAppSessionRecoveryScheduleRetry;
  storedAppAccountId?: Id<"athenaUser"> | string | null;
  validationTimeoutMs?: number;
};

type RecoveryTarget = {
  args: ValidateRecoveryArgs;
  key: string;
  storeId: string;
  terminalId: string;
};

type RecoveryTargetInput = {
  enabled?: boolean;
  isAppUserMissing: boolean;
  orgUrlSlug?: string;
  routeIntent?: string | null;
  source?: "live" | "local";
  status: PosLocalEntryContext["status"];
  storeId?: string;
  storedAppAccountId?: Id<"athenaUser"> | string | null;
  storeUrlSlug?: string;
  terminalCloudId?: string;
  terminalLocalId?: string;
  terminalProof?: string;
  terminalStoreId?: string;
};

const inFlightRecoveries = new Map<string, Promise<RecoveryResult>>();

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
  inFlightRecoveries.clear();
}

export function usePosTerminalAppSessionRecovery(
  input: PosTerminalAppSessionRecoveryInput,
): PosTerminalAppSessionRecoveryState {
  const validateRecovery = useMutation(
    api.pos.public.terminalAppSessions.validateTerminalAppSessionRecovery,
  ) as ValidateRecoveryMutation;
  const [isOnline, setIsOnline] = useState(getBrowserOnline);
  const [state, setState] =
    useState<PosTerminalAppSessionRecoveryState>(idleState);

  useEffect(() => {
    const updateOnlineStatus = () => setIsOnline(getBrowserOnline());

    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);

    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
    };
  }, []);

  const retryDelaysKey = (input.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS).join(
    ":",
  );
  const retryDelaysMs = useMemo(
    () => input.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS,
    [retryDelaysKey],
  );
  const scheduleRetry = input.scheduleRetry ?? scheduleBrowserRetry;
  const scheduleValidationTimeout =
    input.scheduleValidationTimeout ?? scheduleBrowserRetry;
  const validationTimeoutMs =
    input.validationTimeoutMs ?? DEFAULT_VALIDATION_TIMEOUT_MS;
  const localEntryContext = input.localEntryContext;
  const localEntryReady =
    localEntryContext.status === "ready" ? localEntryContext : null;
  const localTerminalSeed = localEntryReady?.terminalSeed ?? null;
  const target = useMemo(
    () =>
      resolveRecoveryTarget({
        enabled: input.enabled,
        isAppUserMissing: input.isAppUserMissing,
        orgUrlSlug: localEntryReady?.orgUrlSlug,
        routeIntent: input.routeIntent,
        source: localEntryReady?.source,
        status: localEntryContext.status,
        storeId: localEntryReady?.storeId,
        storedAppAccountId: input.storedAppAccountId,
        storeUrlSlug: localEntryReady?.storeUrlSlug,
        terminalCloudId: localTerminalSeed?.cloudTerminalId,
        terminalLocalId: localTerminalSeed?.terminalId,
        terminalProof: localTerminalSeed?.syncSecretHash,
        terminalStoreId: localTerminalSeed?.storeId,
      }),
    [
      input.enabled,
      input.isAppUserMissing,
      input.routeIntent,
      input.storedAppAccountId,
      localEntryContext.status,
      localEntryReady?.orgUrlSlug,
      localEntryReady?.source,
      localEntryReady?.storeId,
      localEntryReady?.storeUrlSlug,
      localTerminalSeed?.cloudTerminalId,
      localTerminalSeed?.storeId,
      localTerminalSeed?.syncSecretHash,
      localTerminalSeed?.terminalId,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    let cancelScheduledRetry: (() => void) | null = null;
    let cancelAssertionExpiry: (() => void) | null = null;

    if (!target) {
      setState(idleState);
      return;
    }

    if (!isOnline) {
      setState({
        assertion: null,
        reason: null,
        status: "waiting_for_network",
      });
      return;
    }

    let attemptIndex = 0;

    const runAttempt = () => {
      setState((current) =>
        current.status === "retrying"
          ? current
          : { assertion: null, reason: null, status: "validating" },
      );

      runSharedRecovery(
        target.key,
        () => validateRecovery(target.args),
        {
          scheduleTimeout: scheduleValidationTimeout,
          timeoutMs: validationTimeoutMs,
        },
      )
        .then((result) => {
          if (cancelled) return;

          if (result.status === "recoverable") {
            if (
              !isScopedRecoveryAssertion({
                assertion: result.assertion,
                storeId: target.storeId,
                terminalId: target.terminalId,
              })
            ) {
              setState({
                assertion: null,
                reason: "stale_assertion",
                status: "blocked",
              });
              return;
            }

            setState({
              assertion: result.assertion,
              reason: null,
              status: "recoverable",
            });
            cancelAssertionExpiry?.();
            cancelAssertionExpiry = scheduleAssertionExpiry(
              result.assertion,
              () => {
                if (cancelled) return;

                setState((current) =>
                  current.status === "recoverable" &&
                  current.assertion.recoveryAttemptId ===
                    result.assertion.recoveryAttemptId
                    ? {
                        assertion: null,
                        reason: "stale_assertion",
                        status: "blocked",
                      }
                    : current,
                );
              },
            );
            return;
          }

          if (result.status === "blocked") {
            setState({
              assertion: null,
              reason: result.reason,
              status: "blocked",
            });
            return;
          }

          scheduleNextAttempt();
        })
        .catch(() => {
          if (!cancelled) {
            scheduleNextAttempt();
          }
        });
    };

    const scheduleNextAttempt = () => {
      const retryDelayMs = retryDelaysMs[attemptIndex];

      if (retryDelayMs === undefined) {
        setState({
          assertion: null,
          reason: "retry_exhausted",
          status: "blocked",
        });
        return;
      }

      attemptIndex += 1;
      setState({
        assertion: null,
        attempt: attemptIndex,
        reason: null,
        status: "retrying",
      });
      cancelScheduledRetry = scheduleRetry(retryDelayMs, () => {
        cancelScheduledRetry = null;
        if (cancelled) return;

        if (!getBrowserOnline()) {
          setState({
            assertion: null,
            reason: null,
            status: "waiting_for_network",
          });
          return;
        }

        runAttempt();
      });
    };

    runAttempt();

    return () => {
      cancelled = true;
      cancelScheduledRetry?.();
      cancelAssertionExpiry?.();
    };
  }, [
    isOnline,
    retryDelaysMs,
    scheduleRetry,
    scheduleValidationTimeout,
    target,
    validateRecovery,
    validationTimeoutMs,
  ]);

  return state;
}

function resolveRecoveryTarget(input: RecoveryTargetInput): RecoveryTarget | null {
  if (input.enabled === false) return null;
  if (input.routeIntent !== POS_HUB_ROUTE_INTENT) return null;
  if (!input.isAppUserMissing) return null;
  if (!input.storedAppAccountId) return null;
  if (input.status !== "ready") return null;
  if (!input.storeId) return null;
  if (!input.orgUrlSlug || !input.storeUrlSlug || !input.source) return null;

  if (!input.terminalStoreId) return null;
  if (input.terminalStoreId !== input.storeId) return null;
  if (!input.terminalProof) return null;

  const terminalId = input.terminalCloudId || input.terminalLocalId;
  if (!terminalId) return null;

  const args: ValidateRecoveryArgs = {
    accountId: input.storedAppAccountId as Id<"athenaUser">,
    routeIntent: POS_HUB_ROUTE_INTENT,
    storeId: input.storeId as Id<"store">,
    terminalId: terminalId as Id<"posTerminal">,
    terminalProof: input.terminalProof,
    metadata: {
      orgUrlSlug: input.orgUrlSlug,
      source: input.source,
      storeUrlSlug: input.storeUrlSlug,
    },
  };

  return {
    args,
    key: [
      input.storeId,
      terminalId,
      input.storedAppAccountId,
      input.terminalProof,
    ].join(":"),
    storeId: input.storeId,
    terminalId,
  };
}

function runSharedRecovery(
  key: string,
  run: () => Promise<RecoveryResult>,
  timeout: {
    scheduleTimeout: PosTerminalAppSessionRecoveryScheduleRetry;
    timeoutMs: number;
  },
): Promise<RecoveryResult> {
  const existing = inFlightRecoveries.get(key);
  if (existing) return existing;

  const recovery = runWithTimeout(run, timeout).finally(() => {
    if (inFlightRecoveries.get(key) === recovery) {
      inFlightRecoveries.delete(key);
    }
  });

  inFlightRecoveries.set(key, recovery);
  return recovery;
}

function runWithTimeout(
  run: () => Promise<RecoveryResult>,
  timeout: {
    scheduleTimeout: PosTerminalAppSessionRecoveryScheduleRetry;
    timeoutMs: number;
  },
) {
  let cancelTimeout: (() => void) | null = null;
  let settled = false;

  return new Promise<RecoveryResult>((resolve, reject) => {
    cancelTimeout = timeout.scheduleTimeout(timeout.timeoutMs, () => {
      if (settled) return;
      settled = true;
      reject(new Error("pos_terminal_app_session_recovery_timeout"));
    });

    run().then(
      (result) => {
        if (settled) return;
        settled = true;
        cancelTimeout?.();
        resolve(result);
      },
      (error) => {
        if (settled) return;
        settled = true;
        cancelTimeout?.();
        reject(error);
      },
    );
  }).finally(() => {
    cancelTimeout?.();
  });
}

function isScopedRecoveryAssertion(input: {
  assertion: PosTerminalAppSessionRecoveryAssertion;
  storeId: string;
  terminalId: string;
}) {
  return (
    input.assertion.routeScope === POS_HUB_ROUTE_INTENT &&
    input.assertion.storeId === input.storeId &&
    input.assertion.terminalId === input.terminalId &&
    input.assertion.expiresAt > Date.now()
  );
}

function getBrowserOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

function scheduleBrowserRetry(delayMs: number, retry: () => void) {
  const timeoutId = window.setTimeout(retry, delayMs);
  return () => window.clearTimeout(timeoutId);
}

function scheduleAssertionExpiry(
  assertion: PosTerminalAppSessionRecoveryAssertion,
  expire: () => void,
) {
  const timeoutId = window.setTimeout(
    expire,
    Math.max(0, assertion.expiresAt - Date.now()),
  );
  return () => window.clearTimeout(timeoutId);
}

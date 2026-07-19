import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { buildOperationalEvent } from "../../../operations/operationalEvents";
import { redactSensitiveDiagnosticText } from "../diagnosticRedaction";
import { resolveTerminalHealthAlertTransitions } from "../terminalRuntime/terminalHealthAlerts";
import {
  ok,
  userError,
  type CommandResult,
} from "../../../../shared/commandResult";
import {
  normalizePosTerminalTransactionCapability,
  type PosTerminalTransactionCapability,
} from "../../../../shared/posTerminalCapability";
import {
  normalizePosTerminalLoginMode,
  type PosTerminalLoginMode,
} from "../../../../shared/posTerminalLoginMode";
import {
  canInspectRuntimeCloudDrawerAuthority,
  isRegisterSessionSaleUsable,
} from "../../../../shared/registerSessionLifecyclePolicy";
import { POS_USABLE_REGISTER_SESSION_STATUSES } from "../../../../shared/registerSessionStatus";
import { POS_REGISTER_NUMBER_CONFLICT_KIND } from "../../../../shared/posTerminalRegistrationError";

import {
  getTerminalByFingerprint,
  getTerminalById,
  getTerminalByStoreIdAndRegisterNumber,
  mapTerminalRecord,
  patchTerminalRecord,
  registerTerminalRecord,
  upsertLatestRuntimeStatusWithOutcome,
} from "../../infrastructure/repositories/terminalRepository";
import { deleteTerminalRecord } from "../../infrastructure/repositories/terminalRepository";

const REGISTER_NUMBER_REQUIRED_MESSAGE =
  "A register number is required to identify the terminal.";
const REGISTER_NUMBER_UNIQUE_MESSAGE =
  "A terminal with this register number already exists in this store.";
const TERMINAL_REACTIVATION_REPROVISION_MESSAGE =
  "Re-provision this terminal before returning it to service.";
const TERMINAL_REGISTER_SESSION_LOOKUP_LIMIT = 25;

function normalizeRegisterNumber(value?: string): string | undefined {
  const registerNumber = value?.trim();
  return registerNumber && registerNumber.length > 0
    ? registerNumber
    : undefined;
}

function mapRegisterTerminalError(
  error: unknown,
): CommandResult<never> | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  if (error.message === REGISTER_NUMBER_UNIQUE_MESSAGE) {
    return userError({
      code: "conflict",
      message: error.message,
      metadata: { conflictKind: POS_REGISTER_NUMBER_CONFLICT_KIND },
    });
  }

  if (error.message === REGISTER_NUMBER_REQUIRED_MESSAGE) {
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
    allowRegisterNumberChange?: boolean;
    storeId: Id<"store">;
    fingerprintHash: string;
    syncSecretHash: string;
    displayName: string;
    heartbeatEnabled?: boolean;
    registerNumber: string;
    loginMode?: PosTerminalLoginMode;
    transactionCapability?: PosTerminalTransactionCapability;
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
    const transactionCapability =
      args.transactionCapability === undefined && existing
        ? normalizePosTerminalTransactionCapability(
            existing.transactionCapability,
          )
        : normalizePosTerminalTransactionCapability(args.transactionCapability);
    const loginMode =
      args.loginMode === undefined && existing
        ? normalizePosTerminalLoginMode(existing.loginMode)
        : normalizePosTerminalLoginMode(args.loginMode);

    if (existing) {
      if (existing.status !== "active") {
        return userError({
          code: "authorization_failed",
          message: "This terminal must be reactivated by an administrator.",
        });
      }

      if (
        existing.registerNumber !== nextRegisterNumber &&
        !args.allowRegisterNumberChange
      ) {
        return userError({
          code: "validation_failed",
          message:
            "This terminal is already assigned to another register number.",
        });
      }

      await patchTerminalRecord(ctx, existing._id, {
        displayName: args.displayName,
        heartbeatEnabled: args.heartbeatEnabled ?? true,
        syncSecretHash: args.syncSecretHash,
        registeredByUserId: args.registeredByUserId,
        browserInfo: args.browserInfo,
        status: "active",
        registerNumber: nextRegisterNumber,
        loginMode,
        transactionCapability,
      });

      return ok({
        ...mapTerminalRecord(existing),
        syncSecretHash: args.syncSecretHash,
        displayName: args.displayName,
        registeredByUserId: args.registeredByUserId,
        browserInfo: args.browserInfo,
        status: "active",
        registerNumber: nextRegisterNumber,
        loginMode,
        transactionCapability,
      });
    }

    const terminalId = await registerTerminalRecord(ctx, {
      storeId: args.storeId,
      fingerprintHash: args.fingerprintHash,
      syncSecretHash: args.syncSecretHash,
      displayName: args.displayName,
      heartbeatEnabled: args.heartbeatEnabled ?? true,
      registerNumber: nextRegisterNumber,
      registeredByUserId: args.registeredByUserId,
      browserInfo: args.browserInfo,
      registeredAt: Date.now(),
      status: "active",
      loginMode,
      transactionCapability,
    });
    const terminal = await getTerminalById(ctx, terminalId);

    return ok({
      ...mapTerminalRecord(terminal!),
      syncSecretHash: args.syncSecretHash,
    });
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
    heartbeatEnabled?: boolean;
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
  if (args.heartbeatEnabled !== undefined) {
    updates.heartbeatEnabled = args.heartbeatEnabled;
  }
  if (args.status !== undefined) {
    if (terminal.status !== "active" && args.status === "active") {
      throw new Error(TERMINAL_REACTIVATION_REPROVISION_MESSAGE);
    }
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

export type TerminalRuntimeStatusInput = {
  reportedAt: number;
  source: Doc<"posTerminalRuntimeStatus">["source"];
  appVersion?: string;
  buildSha?: string;
  browserInfo?: {
    userAgent?: string;
    platform?: string;
    language?: string;
    online?: boolean;
  };
  appSessionRecovery?: {
    status: AppSessionRecoveryStatus;
  };
  appShell?: {
    observedAt: number;
    ready: boolean;
  };
  appUpdate?: {
    blockerSummary?: AppUpdateBlockerCode;
    canApply: boolean;
    commandExecutionId?: string;
    commandId?: string;
    commandIssuedAt?: number;
    commandNonce?: string;
    currentBuildId?: string;
    detectorStatus: AppUpdateDetectorStatus;
    observedAt: number;
    pendingBuildId?: string;
    selectedBlockerCode?: AppUpdateBlockerCode;
    stagingAssetCount?: number;
    stagingFailedAssetCount?: number;
    stagingReason?: AppUpdateStagingReason;
    stagingRejectedAssetCount?: number;
    stagingStatus?: AppUpdateStagingStatus;
    status: AppUpdateStatus;
  };
  localStore: {
    available: boolean;
    schemaVersion?: number;
    terminalSeedReady: boolean;
    failureMessage?: string;
    engineReadiness?: Doc<"posTerminalRuntimeStatus">["localStore"]["engineReadiness"];
    healthFreshness?: Doc<"posTerminalRuntimeStatus">["localStore"]["healthFreshness"];
    healthObservedAt?: number;
    lastSuccessfulDurableCommitAt?: number;
    ledgerPressure?: Doc<"posTerminalRuntimeStatus">["localStore"]["ledgerPressure"];
    maintenance?: Doc<"posTerminalRuntimeStatus">["localStore"]["maintenance"];
    migration?: Doc<"posTerminalRuntimeStatus">["localStore"]["migration"];
    persistence?: Doc<"posTerminalRuntimeStatus">["localStore"]["persistence"];
    pressure?: Doc<"posTerminalRuntimeStatus">["localStore"]["pressure"];
    quotaBytes?: number;
    usageBytes?: number;
  };
  sync: {
    status: Doc<"posTerminalRuntimeStatus">["sync"]["status"];
    pendingEventCount: number;
    uploadableEventCount: number;
    failedEventCount: number;
    reviewEventCount: number;
    localOnlyEventCount: number;
    reviewEvents?: NonNullable<
      Doc<"posTerminalRuntimeStatus">["sync"]["reviewEvents"]
    >;
    oldestPendingEventAt?: number;
    nextPendingUploadSequence?: number;
    lastSyncedSequence?: number;
    lastTrigger?: string;
    lastFailureMessage?: string;
    backoffUntil?: number;
    heldEventCount?: number;
    heldWithoutProgress?: boolean;
  };
  runtimeCounters?: Record<string, number>;
  staffAuthority: {
    status: Doc<"posTerminalRuntimeStatus">["staffAuthority"]["status"];
    staffProfileId?: Id<"staffProfile">;
    expiresAt?: number;
  };
  saleAuthority?: {
    observedAt: number;
    status: NonNullable<
      Doc<"posTerminalRuntimeStatus">["saleAuthority"]
    >["status"];
    localPosSessionId?: string;
    localRegisterSessionId?: string;
    staffProfileId?: Id<"staffProfile">;
    transactionMode?: NonNullable<
      Doc<"posTerminalRuntimeStatus">["saleAuthority"]
    >["transactionMode"];
  };
  activeRegisterSession?: {
    cloudRegisterSessionId?: string;
    localRegisterSessionId: string;
    observedAt: number;
    openedAt?: number;
    registerNumber?: string;
    status: NonNullable<
      Doc<"posTerminalRuntimeStatus">["activeRegisterSession"]
    >["status"];
  };
  terminalIntegrity?: {
    observedAt: number;
    reason?: TerminalIntegrityReason;
    status: TerminalIntegrityStatus;
  };
  drawerAuthority?: {
    cloudRegisterSessionId?: string;
    localRegisterSessionId: string;
    observedAt: number;
    reason?: DrawerAuthorityReason;
    status: DrawerAuthorityStatus;
  };
  snapshots: {
    catalogAgeMs?: number;
    serviceCatalogAgeMs?: number;
    availabilityAgeMs?: number;
    registerReadModelAgeMs?: number;
  };
};

type TerminalIntegrityStatus =
  | "healthy"
  | "repairing"
  | "requires_reprovision"
  | "reset_required";

type TerminalIntegrityReason =
  | "authorization_failed"
  | "ownership_conflict"
  | "repair_rejected"
  | "seed_write_failed"
  | "store_access_missing"
  | "terminal_revoked"
  | "unknown";

type DrawerAuthorityStatus = "healthy" | "blocked";

type DrawerAuthorityReason =
  | "authority_unknown"
  | "cloud_closed"
  | "cloud_session_missing"
  | "lifecycle_rejected";

type DrawerAuthorityDirective = {
  cloudRegisterSessionId?: string;
  localRegisterSessionId: string;
  message?: string;
  observedAt: number;
  reason?: DrawerAuthorityReason;
  registerNumber?: string;
  status: DrawerAuthorityStatus;
};

type ActiveRegisterSessionDirective = {
  cloudRegisterSessionId: string;
  expectedCash: number;
  localRegisterSessionId: string;
  observedAt: number;
  openedAt: number;
  openingFloat: number;
  registerNumber?: string;
  staffProfileId?: Id<"staffProfile">;
  status: "active";
};

type AppSessionRecoveryStatus =
  | "ready"
  | "recovering"
  | "retrying"
  | "waiting_for_network"
  | "blocked_terminal"
  | "blocked_app_account"
  | "blocked_store_mismatch"
  | "retry_exhausted"
  | "stale_assertion";

type AppUpdateStatus =
  | "current"
  | "checking"
  | "update_ready"
  | "update_ready_unstaged"
  | "blocked"
  | "applying"
  | "detector_failed"
  | "unknown";

type AppUpdateStagingStatus = "staged" | "unstaged" | "unknown";

type AppUpdateStagingReason =
  | "asset-staging-failed"
  | "no-entry-html"
  | "no-static-assets"
  | "cache-storage-unavailable"
  | "service-worker-unavailable"
  | "service-worker-timeout"
  | "service-worker-error"
  | "unknown";

type AppUpdateDetectorStatus = "ok" | "failed" | "unknown";

type AppUpdateBlockerCode =
  | "active_sale"
  | "active_command"
  | "resume_required"
  | "unknown";

const TERMINAL_NOT_ACTIVE_FOR_STORE_MESSAGE =
  "This terminal is not active for this store.";

export async function submitTerminalRuntimeStatus(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    trustedTerminal?: Doc<"posTerminal">;
    status: TerminalRuntimeStatusInput;
  },
): Promise<
  CommandResult<{
    activeRegisterSessionDirective?: ActiveRegisterSessionDirective;
    acceptedForSideEffects: boolean;
    drawerAuthorityDirective?: DrawerAuthorityDirective;
    recoveryVerificationCursor?: string;
    runtimeStatusId: Id<"posTerminalRuntimeStatus">;
    terminalId: Id<"posTerminal">;
    reportedAt: number;
    receivedAt: number;
  }>
> {
  const terminal =
    args.trustedTerminal ?? (await getTerminalById(ctx, args.terminalId));
  if (
    !terminal ||
    terminal._id !== args.terminalId ||
    terminal.storeId !== args.storeId ||
    terminal.status !== "active"
  ) {
    return userError({
      code: "precondition_failed",
      message: TERMINAL_NOT_ACTIVE_FOR_STORE_MESSAGE,
    });
  }

  const receivedAt = Date.now();
  const reportedAt = positiveTimestamp(args.status.reportedAt) ?? receivedAt;
  const appSessionRecovery = cleanAppSessionRecovery(
    args.status.appSessionRecovery,
  );
  const activeRegisterSession = cleanActiveRegisterSession(
    args.status.activeRegisterSession,
  );
  const drawerAuthority = cleanDrawerAuthority(args.status.drawerAuthority);
  const runtimeCloudRegisterSessionCache = activeRegisterSession
    ? createRuntimeCloudRegisterSessionCache()
    : undefined;
  const runtimeStatusWrite = await upsertLatestRuntimeStatusWithOutcome(ctx, {
    storeId: args.storeId,
    terminalId: args.terminalId,
    reportedAt,
    receivedAt,
    source: args.status.source,
    appSessionRecovery,
    appShell: cleanAppShell(args.status.appShell),
    appUpdate: cleanAppUpdate(args.status.appUpdate),
    ...omitUndefined({
      appVersion: cleanOptionalString(args.status.appVersion, 80),
      buildSha: cleanOptionalString(args.status.buildSha, 80),
      browserInfo: cleanBrowserInfo(args.status.browserInfo),
    }),
    localStore: omitUndefined({
      available: args.status.localStore.available,
      schemaVersion: nonNegativeInteger(args.status.localStore.schemaVersion),
      terminalSeedReady: args.status.localStore.terminalSeedReady,
      failureMessage: cleanDiagnosticMessage(
        args.status.localStore.failureMessage,
        500,
      ),
      engineReadiness: args.status.localStore.engineReadiness,
      healthFreshness: args.status.localStore.healthFreshness,
      healthObservedAt: positiveTimestamp(
        args.status.localStore.healthObservedAt,
      ),
      lastSuccessfulDurableCommitAt: positiveTimestamp(
        args.status.localStore.lastSuccessfulDurableCommitAt,
      ),
      ledgerPressure: args.status.localStore.ledgerPressure,
      maintenance: args.status.localStore.maintenance,
      migration: args.status.localStore.migration,
      persistence: args.status.localStore.persistence,
      pressure: args.status.localStore.pressure,
      quotaBytes: positiveCount(args.status.localStore.quotaBytes),
      usageBytes: positiveCount(args.status.localStore.usageBytes),
    }),
    sync: omitUndefined({
      status: args.status.sync.status,
      pendingEventCount: nonNegativeInteger(args.status.sync.pendingEventCount),
      uploadableEventCount: nonNegativeInteger(
        args.status.sync.uploadableEventCount,
      ),
      failedEventCount: nonNegativeInteger(args.status.sync.failedEventCount),
      reviewEventCount: nonNegativeInteger(args.status.sync.reviewEventCount),
      localOnlyEventCount: nonNegativeInteger(
        args.status.sync.localOnlyEventCount,
      ),
      oldestPendingEventAt: positiveTimestamp(
        args.status.sync.oldestPendingEventAt,
      ),
      nextPendingUploadSequence: positiveInteger(
        args.status.sync.nextPendingUploadSequence,
      ),
      lastSyncedSequence: nonNegativeInteger(
        args.status.sync.lastSyncedSequence,
      ),
      lastTrigger: cleanOptionalString(args.status.sync.lastTrigger, 80),
      lastFailureMessage: cleanDiagnosticMessage(
        args.status.sync.lastFailureMessage,
        500,
      ),
      backoffUntil: positiveTimestamp(args.status.sync.backoffUntil),
      heldEventCount: positiveCount(args.status.sync.heldEventCount),
      heldWithoutProgress:
        typeof args.status.sync.heldWithoutProgress === "boolean"
          ? args.status.sync.heldWithoutProgress
          : undefined,
    }),
    ...omitUndefined({
      runtimeCounters: cleanRuntimeCounters(args.status.runtimeCounters),
    }),
    staffAuthority: omitUndefined({
      status: args.status.staffAuthority.status,
      staffProfileId: args.status.staffAuthority.staffProfileId,
      expiresAt: positiveTimestamp(args.status.staffAuthority.expiresAt),
    }),
    saleAuthority: cleanSaleAuthority(args.status.saleAuthority),
    activeRegisterSession,
    snapshots: omitUndefined({
      catalogAgeMs: nonNegativeInteger(args.status.snapshots.catalogAgeMs),
      serviceCatalogAgeMs: nonNegativeInteger(
        args.status.snapshots.serviceCatalogAgeMs,
      ),
      availabilityAgeMs: nonNegativeInteger(
        args.status.snapshots.availabilityAgeMs,
      ),
      registerReadModelAgeMs: nonNegativeInteger(
        args.status.snapshots.registerReadModelAgeMs,
      ),
    }),
    terminalIntegrity: cleanTerminalIntegrity(args.status.terminalIntegrity),
    drawerAuthority,
  });
  if (!runtimeStatusWrite.didWrite) {
    return ok({
      acceptedForSideEffects: false,
      recoveryVerificationCursor:
        runtimeStatusWrite.recoveryVerificationCursor,
      runtimeStatusId: runtimeStatusWrite.runtimeStatusId,
      terminalId: args.terminalId,
      reportedAt,
      receivedAt,
    });
  }

  // Health alerting rides on this write: the previous row came back from the
  // upsert (which reads it regardless), so transition detection costs zero
  // additional reads. Only an actual edge into a degraded condition — rare by
  // construction (edge trigger + cooldown) — pays one patch, one insert, and
  // one scheduled email action.
  const healthAlertTransitions = resolveTerminalHealthAlertTransitions({
    previous: runtimeStatusWrite.previous,
    next: { localStore: args.status.localStore, sync: args.status.sync },
    now: receivedAt,
  });
  if (healthAlertTransitions.conditionsToAlert.length > 0) {
    await ctx.db.patch(
      "posTerminalRuntimeStatus",
      runtimeStatusWrite.runtimeStatusId,
      { healthAlerts: healthAlertTransitions.healthAlerts },
    );
    await ctx.db.insert(
      "operationalEvent",
      buildOperationalEvent({
        storeId: args.storeId,
        eventType: "pos_terminal_health_alert",
        subjectType: "posTerminal",
        subjectId: args.terminalId,
        subjectLabel: terminal.displayName,
        terminalId: args.terminalId,
        actorType: "automation",
        message: `Terminal "${terminal.displayName}" needs attention: ${healthAlertTransitions.conditionsToAlert.join(", ")}`,
        metadata: {
          conditions: healthAlertTransitions.conditionsToAlert.join(","),
          source: "terminal-heartbeat",
        },
      }),
    );
    await ctx.scheduler.runAfter(
      0,
      internal.operations.posTerminalHealthAlertEmail
        .sendPosTerminalHealthAlertToAdmins,
      {
        storeId: args.storeId,
        terminalId: args.terminalId,
        conditions: healthAlertTransitions.conditionsToAlert,
        observedAt: receivedAt,
      },
    );
  }

  const drawerAuthorityDirective = await buildRuntimeDrawerAuthorityDirective(
    ctx,
    {
      activeRegisterSession,
      drawerAuthority,
      receivedAt,
      runtimeCloudRegisterSessionCache,
      storeId: args.storeId,
    },
  );
  const activeRegisterSessionDirective =
    await buildRuntimeActiveRegisterSessionDirective(ctx, {
      activeRegisterSession,
      receivedAt,
      runtimeStatus: args.status,
      runtimeCloudRegisterSessionCache,
      storeId: args.storeId,
      terminal,
    });

  return ok({
    ...omitUndefined({
      activeRegisterSessionDirective,
      drawerAuthorityDirective,
    }),
    acceptedForSideEffects: true,
    recoveryVerificationCursor:
      runtimeStatusWrite.recoveryVerificationCursor,
    runtimeStatusId: runtimeStatusWrite.runtimeStatusId,
    terminalId: args.terminalId,
    reportedAt,
    receivedAt,
  });
}

async function buildRuntimeActiveRegisterSessionDirective(
  ctx: MutationCtx,
  args: {
    activeRegisterSession:
      | ReturnType<typeof cleanActiveRegisterSession>
      | undefined;
    receivedAt: number;
    runtimeStatus: TerminalRuntimeStatusInput;
    runtimeCloudRegisterSessionCache?: RuntimeCloudRegisterSessionCache;
    storeId: Id<"store">;
    terminal: Doc<"posTerminal">;
  },
): Promise<ActiveRegisterSessionDirective | undefined> {
  if (
    !args.runtimeStatus.localStore.available ||
    !args.runtimeStatus.localStore.terminalSeedReady
  ) {
    return undefined;
  }
  if (!ctx.db || typeof (ctx.db as { query?: unknown }).query !== "function") {
    return undefined;
  }

  let runtimeCloudRegisterSession: Doc<"registerSession"> | null = null;
  if (args.activeRegisterSession) {
    runtimeCloudRegisterSession = await loadRuntimeActiveCloudRegisterSession(
      ctx,
      {
        activeRegisterSession: args.activeRegisterSession,
        storeId: args.storeId,
      },
      args.runtimeCloudRegisterSessionCache,
    );
    if (
      !runtimeCloudRegisterSession ||
      isRegisterSessionSaleUsable(runtimeCloudRegisterSession)
    ) {
      return undefined;
    }
  }

  const cloudRegisterSession = await getSaleUsableRegisterSessionForTerminal(
    ctx,
    {
      registerNumber: args.terminal.registerNumber,
      storeId: args.storeId,
      terminalId: args.terminal._id,
    },
  );
  if (!cloudRegisterSession) {
    return undefined;
  }
  if (args.activeRegisterSession) {
    if (runtimeCloudRegisterSession?._id === cloudRegisterSession._id) {
      return undefined;
    }
  }

  return omitUndefined({
    cloudRegisterSessionId: cloudRegisterSession._id,
    expectedCash: cloudRegisterSession.expectedCash,
    localRegisterSessionId: cloudRegisterSession._id,
    observedAt: args.receivedAt,
    openedAt: cloudRegisterSession.openedAt,
    openingFloat: cloudRegisterSession.openingFloat,
    registerNumber: cloudRegisterSession.registerNumber,
    staffProfileId: cloudRegisterSession.openedByStaffProfileId,
    status: "active" as const,
  });
}

async function getRuntimeActiveCloudRegisterSession(
  ctx: MutationCtx,
  args: {
    activeRegisterSession: NonNullable<
      ReturnType<typeof cleanActiveRegisterSession>
    >;
    storeId: Id<"store">;
  },
): Promise<Doc<"registerSession"> | null> {
  const registerSessionId = ctx.db.normalizeId(
    "registerSession",
    args.activeRegisterSession.cloudRegisterSessionId ??
      args.activeRegisterSession.localRegisterSessionId,
  );
  if (!registerSessionId) {
    return null;
  }

  const registerSession = await ctx.db.get(
    "registerSession",
    registerSessionId,
  );
  if (!registerSession || registerSession.storeId !== args.storeId) {
    return null;
  }

  return registerSession;
}

type RuntimeCloudRegisterSessionCache = {
  loaded: boolean;
  session: Doc<"registerSession"> | null;
};

function createRuntimeCloudRegisterSessionCache(): RuntimeCloudRegisterSessionCache {
  return {
    loaded: false,
    session: null,
  };
}

async function loadRuntimeActiveCloudRegisterSession(
  ctx: MutationCtx,
  args: {
    activeRegisterSession: NonNullable<
      ReturnType<typeof cleanActiveRegisterSession>
    >;
    storeId: Id<"store">;
  },
  cache?: RuntimeCloudRegisterSessionCache,
) {
  if (cache?.loaded) {
    return cache.session;
  }

  const session = await getRuntimeActiveCloudRegisterSession(ctx, args);
  if (cache) {
    cache.loaded = true;
    cache.session = session;
  }
  return session;
}

async function getSaleUsableRegisterSessionForTerminal(
  ctx: MutationCtx,
  args: {
    registerNumber?: string | null;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
): Promise<Doc<"registerSession"> | null> {
  const registerNumber = args.registerNumber?.trim();
  const recentSessionsByUsableStatus = await Promise.all(
    POS_USABLE_REGISTER_SESSION_STATUSES.map((status) =>
      ctx.db
        .query("registerSession")
        .withIndex("by_storeId_status_terminalId", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("status", status)
            .eq("terminalId", args.terminalId),
        )
        .order("desc")
        .take(TERMINAL_REGISTER_SESSION_LOOKUP_LIMIT),
    ),
  );
  const directMatch = latestCompatibleRegisterSessionCandidate(
    recentSessionsByUsableStatus.flat(),
    { registerNumber },
  );
  if (directMatch) return directMatch;

  return null;
}

function latestCompatibleRegisterSessionCandidate(
  sessions: Array<Doc<"registerSession">>,
  args: {
    registerNumber?: string;
  },
) {
  return (
    sessions
      .filter((session) => isRegisterNumberCompatible(session, args))
      .sort((left, right) => right._creationTime - left._creationTime)[0] ??
    null
  );
}

function isRegisterNumberCompatible(
  session: Pick<Doc<"registerSession">, "registerNumber">,
  args: {
    registerNumber?: string;
  },
) {
  return (
    !args.registerNumber ||
    !session.registerNumber ||
    session.registerNumber === args.registerNumber
  );
}

async function buildRuntimeDrawerAuthorityDirective(
  ctx: MutationCtx,
  args: {
    activeRegisterSession:
      | ReturnType<typeof cleanActiveRegisterSession>
      | undefined;
    drawerAuthority: ReturnType<typeof cleanDrawerAuthority> | undefined;
    receivedAt: number;
    runtimeCloudRegisterSessionCache?: RuntimeCloudRegisterSessionCache;
    storeId: Id<"store">;
  },
): Promise<DrawerAuthorityDirective | undefined> {
  const session = args.activeRegisterSession;
  if (
    !session ||
    !session.cloudRegisterSessionId ||
    !canInspectRuntimeCloudDrawerAuthority(session)
  ) {
    return undefined;
  }
  if (
    args.drawerAuthority?.status === "blocked" &&
    args.drawerAuthority.reason === "cloud_closed" &&
    args.drawerAuthority.localRegisterSessionId ===
      session.localRegisterSessionId &&
    args.drawerAuthority.cloudRegisterSessionId ===
      session.cloudRegisterSessionId
  ) {
    return undefined;
  }

  const cloudRegisterSession = await loadRuntimeActiveCloudRegisterSession(
    ctx,
    {
      activeRegisterSession: session,
      storeId: args.storeId,
    },
    args.runtimeCloudRegisterSessionCache,
  );
  if (
    !cloudRegisterSession ||
    isRegisterSessionSaleUsable(cloudRegisterSession)
  ) {
    return undefined;
  }

  return omitUndefined({
    cloudRegisterSessionId: session.cloudRegisterSessionId,
    localRegisterSessionId: session.localRegisterSessionId,
    message:
      "The mapped cloud register is closed. Open a register before selling.",
    observedAt: args.receivedAt,
    reason: "cloud_closed" as const,
    registerNumber: session.registerNumber,
    status: "blocked" as const,
  });
}

function cleanSaleAuthority(
  saleAuthority: TerminalRuntimeStatusInput["saleAuthority"],
) {
  if (!saleAuthority) return undefined;

  return omitUndefined({
    observedAt: positiveTimestamp(saleAuthority.observedAt) ?? Date.now(),
    status: saleAuthorityStatuses.has(saleAuthority.status)
      ? saleAuthority.status
      : "unknown",
    localPosSessionId: cleanOptionalString(
      saleAuthority.localPosSessionId,
      120,
    ),
    localRegisterSessionId: cleanOptionalString(
      saleAuthority.localRegisterSessionId,
      120,
    ),
    staffProfileId: saleAuthority.staffProfileId,
    transactionMode: saleAuthorityTransactionModes.has(
      saleAuthority.transactionMode,
    )
      ? saleAuthority.transactionMode
      : undefined,
  });
}

function cleanBrowserInfo(
  browserInfo: TerminalRuntimeStatusInput["browserInfo"],
) {
  if (!browserInfo) {
    return undefined;
  }

  const cleaned = omitUndefined({
    userAgent: cleanOptionalString(browserInfo.userAgent, 500),
    platform: cleanOptionalString(browserInfo.platform, 120),
    language: cleanOptionalString(browserInfo.language, 40),
    online: browserInfo.online,
  });

  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

function cleanAppSessionRecovery(
  appSessionRecovery: TerminalRuntimeStatusInput["appSessionRecovery"],
) {
  if (!appSessionRecovery) return undefined;

  return appSessionRecoveryStatuses.has(appSessionRecovery.status)
    ? { status: appSessionRecovery.status }
    : undefined;
}

function cleanAppShell(appShell: TerminalRuntimeStatusInput["appShell"]) {
  if (!appShell) return undefined;

  return {
    observedAt: positiveTimestamp(appShell.observedAt) ?? Date.now(),
    ready: appShell.ready === true,
  };
}

function cleanAppUpdate(appUpdate: TerminalRuntimeStatusInput["appUpdate"]) {
  if (!appUpdate) return undefined;

  return omitUndefined({
    blockerSummary: appUpdateBlockerCodes.has(appUpdate.blockerSummary)
      ? appUpdate.blockerSummary
      : undefined,
    canApply: appUpdate.canApply === true,
    commandExecutionId: cleanOptionalString(appUpdate.commandExecutionId, 120),
    commandId: cleanOptionalString(appUpdate.commandId, 120),
    commandIssuedAt: positiveTimestamp(appUpdate.commandIssuedAt),
    commandNonce: cleanOptionalString(appUpdate.commandNonce, 120),
    currentBuildId: cleanOptionalString(appUpdate.currentBuildId, 120),
    detectorStatus: appUpdateDetectorStatuses.has(appUpdate.detectorStatus)
      ? appUpdate.detectorStatus
      : "unknown",
    observedAt: positiveTimestamp(appUpdate.observedAt) ?? Date.now(),
    pendingBuildId: cleanOptionalString(appUpdate.pendingBuildId, 120),
    selectedBlockerCode: appUpdateBlockerCodes.has(
      appUpdate.selectedBlockerCode,
    )
      ? appUpdate.selectedBlockerCode
      : undefined,
    stagingStatus: appUpdateStagingStatuses.has(appUpdate.stagingStatus)
      ? appUpdate.stagingStatus
      : undefined,
    stagingReason: appUpdateStagingReasons.has(appUpdate.stagingReason)
      ? appUpdate.stagingReason
      : undefined,
    stagingAssetCount: positiveCount(appUpdate.stagingAssetCount),
    stagingFailedAssetCount: positiveCount(appUpdate.stagingFailedAssetCount),
    stagingRejectedAssetCount: positiveCount(
      appUpdate.stagingRejectedAssetCount,
    ),
    status: appUpdateStatuses.has(appUpdate.status)
      ? appUpdate.status
      : "unknown",
  });
}

function cleanOptionalString(value: string | undefined, maxLength: number) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function cleanDiagnosticMessage(value: string | undefined, maxLength: number) {
  const cleaned = cleanOptionalString(value, maxLength);
  if (!cleaned) {
    return undefined;
  }

  return redactSensitiveDiagnosticText(cleaned);
}

function cleanTerminalIntegrity(
  terminalIntegrity: TerminalRuntimeStatusInput["terminalIntegrity"],
) {
  if (!terminalIntegrity) return undefined;

  return omitUndefined({
    observedAt: positiveTimestamp(terminalIntegrity.observedAt) ?? Date.now(),
    reason: terminalIntegrityReasons.has(terminalIntegrity.reason)
      ? terminalIntegrity.reason
      : undefined,
    status: terminalIntegrityStatuses.has(terminalIntegrity.status)
      ? terminalIntegrity.status
      : "reset_required",
  });
}

function cleanActiveRegisterSession(
  activeRegisterSession: TerminalRuntimeStatusInput["activeRegisterSession"],
) {
  if (!activeRegisterSession) return undefined;

  return omitUndefined({
    cloudRegisterSessionId: cleanOptionalString(
      activeRegisterSession.cloudRegisterSessionId,
      120,
    ),
    localRegisterSessionId:
      cleanOptionalString(activeRegisterSession.localRegisterSessionId, 120) ??
      "unknown",
    observedAt:
      positiveTimestamp(activeRegisterSession.observedAt) ?? Date.now(),
    openedAt: positiveTimestamp(activeRegisterSession.openedAt),
    registerNumber: cleanOptionalString(
      activeRegisterSession.registerNumber,
      30,
    ),
    status: activeRegisterSessionStatuses.has(activeRegisterSession.status)
      ? activeRegisterSession.status
      : "open",
  });
}

function cleanDrawerAuthority(
  drawerAuthority: TerminalRuntimeStatusInput["drawerAuthority"],
) {
  if (!drawerAuthority) return undefined;

  return omitUndefined({
    cloudRegisterSessionId: cleanOptionalString(
      drawerAuthority.cloudRegisterSessionId,
      120,
    ),
    localRegisterSessionId:
      cleanOptionalString(drawerAuthority.localRegisterSessionId, 120) ??
      "unknown",
    observedAt: positiveTimestamp(drawerAuthority.observedAt) ?? Date.now(),
    reason: drawerAuthorityReasons.has(drawerAuthority.reason)
      ? drawerAuthority.reason
      : undefined,
    status: drawerAuthorityStatuses.has(drawerAuthority.status)
      ? drawerAuthority.status
      : "blocked",
  });
}

const terminalIntegrityStatuses = new Set<TerminalIntegrityStatus>([
  "healthy",
  "repairing",
  "requires_reprovision",
  "reset_required",
]);

const saleAuthorityStatuses = new Set([
  "ready",
  "missing",
  "blocked",
  "unknown",
]);

const saleAuthorityTransactionModes = new Set([
  "products_and_services",
  "products_only",
  "services_only",
  undefined,
]);

const activeRegisterSessionStatuses = new Set([
  "open",
  "active",
  "closing",
  "closeout_rejected",
  "closed",
]);

const terminalIntegrityReasons = new Set<TerminalIntegrityReason | undefined>([
  "authorization_failed",
  "ownership_conflict",
  "repair_rejected",
  "seed_write_failed",
  "store_access_missing",
  "terminal_revoked",
  "unknown",
]);

const drawerAuthorityStatuses = new Set<DrawerAuthorityStatus>([
  "healthy",
  "blocked",
]);

const drawerAuthorityReasons = new Set<DrawerAuthorityReason | undefined>([
  "authority_unknown",
  "cloud_closed",
  "cloud_session_missing",
  "lifecycle_rejected",
]);

const appSessionRecoveryStatuses = new Set<AppSessionRecoveryStatus>([
  "ready",
  "recovering",
  "retrying",
  "waiting_for_network",
  "blocked_terminal",
  "blocked_app_account",
  "blocked_store_mismatch",
  "retry_exhausted",
  "stale_assertion",
]);

const appUpdateStatuses = new Set<AppUpdateStatus>([
  "current",
  "checking",
  "update_ready",
  "update_ready_unstaged",
  "blocked",
  "applying",
  "detector_failed",
  "unknown",
]);

const appUpdateStagingStatuses = new Set<AppUpdateStagingStatus | undefined>([
  "staged",
  "unstaged",
  "unknown",
  undefined,
]);

const appUpdateStagingReasons = new Set<AppUpdateStagingReason | undefined>([
  "asset-staging-failed",
  "no-entry-html",
  "no-static-assets",
  "cache-storage-unavailable",
  "service-worker-unavailable",
  "service-worker-timeout",
  "service-worker-error",
  "unknown",
  undefined,
]);

const appUpdateDetectorStatuses = new Set<AppUpdateDetectorStatus>([
  "ok",
  "failed",
  "unknown",
]);

const appUpdateBlockerCodes = new Set<AppUpdateBlockerCode | undefined>([
  "active_sale",
  "active_command",
  "resume_required",
  "unknown",
  undefined,
]);

function positiveTimestamp(value: number | undefined) {
  return Number.isFinite(value) && value !== undefined && value > 0
    ? value
    : undefined;
}

function positiveInteger(value: number | undefined) {
  return Number.isSafeInteger(value) && value !== undefined && value > 0
    ? value
    : undefined;
}

function positiveCount(value: number | undefined) {
  return Number.isFinite(value) && value !== undefined && value >= 0
    ? Math.floor(value)
    : undefined;
}

function nonNegativeInteger(value: number | undefined) {
  return Number.isSafeInteger(value) && value !== undefined && value >= 0
    ? value
    : 0;
}

const RUNTIME_COUNTER_MAX_KEYS = 30;

function cleanRuntimeCounters(
  counters: Record<string, number> | undefined,
): Record<string, number> | undefined {
  if (!counters) {
    return undefined;
  }
  const cleaned: Record<string, number> = {};
  for (const [key, value] of Object.entries(counters)) {
    if (Object.keys(cleaned).length >= RUNTIME_COUNTER_MAX_KEYS) {
      break;
    }
    const count = positiveCount(value);
    if (count === undefined || key.length === 0 || key.length > 80) {
      continue;
    }
    cleaned[key] = count;
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

function omitUndefined<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as {
    [Key in keyof T as undefined extends T[Key] ? Key : Key]: Exclude<
      T[Key],
      undefined
    >;
  };
}

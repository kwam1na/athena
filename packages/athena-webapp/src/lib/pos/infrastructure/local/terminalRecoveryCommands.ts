import type {
  PosDrawerAuthorityBlockReason,
  PosDrawerAuthorityState,
  PosLocalEventRecord,
  PosLocalStoreResult,
  PosLocalSyncEventStatus,
  PosProvisionedTerminalSeed,
  createPosLocalStore,
} from "./posLocalStore";
import type {
  UpdateApplyOptions,
  UpdateCoordinatorSnapshot,
} from "@/lib/app-update/updateCoordinator";

export type PosTerminalRecoveryCommandType =
  | "retry_sync"
  | "collect_local_review"
  | "clear_local_review_items"
  | "repair_terminal_seed"
  | "clear_stale_drawer_authority"
  | "refresh_staff_authority"
  | "refresh_snapshots"
  | "report_diagnostics"
  | "update_app";

export type PosTerminalRecoveryCommand = {
  _id?: string;
  commandContext?: unknown;
  commandId?: string;
  commandType?: PosTerminalRecoveryCommandType;
  executionId?: string;
  expectedEvidence?: unknown;
  storeId: string;
  terminalId: string;
  type?: PosTerminalRecoveryCommandType;
  payload?: unknown;
  preconditions?: unknown;
};

export type PosTerminalRecoveryCommandResult = {
  clearedLocalReviewEventIds?: string[];
  commandId: string;
  diagnostics?: Record<string, string | number | boolean | null>;
  localReviewEvents?: PosTerminalRecoveryLocalReviewEvent[];
  message?: string;
  onAcknowledgeFailed?: () => void;
  postAcknowledge?: () =>
    | { applied?: boolean; message?: string }
    | void
    | Promise<{ applied?: boolean; message?: string } | void>;
  reason?:
    | "local_store_failure"
    | "missing_callback"
    | "missing_payload"
    | "precondition_failed"
    | "terminal_mismatch"
    | "unsupported_command"
    | "unsafe_authority_state";
  status: "completed" | "failed" | "ignored" | "precondition_failed";
  type: string;
};

export type PosTerminalRecoveryLocalReviewEvent = {
  createdAt: number;
  localEventId: string;
  localPosSessionId?: string;
  localRegisterSessionId?: string;
  sequence: number;
  status: string;
  type: string;
  uploaded?: boolean;
  uploadSequence?: number;
};

export type PosTerminalRecoveryCommandCallbackResult = {
  message?: string;
  refreshedAt?: number;
  status?: string;
};

type PosLocalRuntimeStore = ReturnType<typeof createPosLocalStore>;

export type PosAppUpdateCoordinatorAdapter = {
  applyUpdate: (options?: UpdateApplyOptions) => boolean;
  getSnapshot: () => UpdateCoordinatorSnapshot;
};

export type PosTerminalRecoveryCommandContext = {
  command: PosTerminalRecoveryCommand;
  onRetrySync?: (() => void | Promise<void>) | null;
  refreshSnapshots?:
    | ((scope: {
        storeId: string;
        terminalId: string;
      }) =>
        | Promise<PosTerminalRecoveryCommandCallbackResult>
        | PosTerminalRecoveryCommandCallbackResult)
    | null;
  refreshStaffAuthority?:
    | ((scope: {
        storeId: string;
        terminalId: string;
      }) =>
        | Promise<PosTerminalRecoveryCommandCallbackResult>
        | PosTerminalRecoveryCommandCallbackResult)
    | null;
  reportDiagnostics?:
    | ((scope: {
        storeId: string;
        terminalId: string;
      }) =>
        | Promise<PosTerminalRecoveryCommandCallbackResult>
        | PosTerminalRecoveryCommandCallbackResult)
    | null;
  appUpdateCoordinator?: PosAppUpdateCoordinatorAdapter | null;
  store: PosLocalRuntimeStore;
  storeId: string;
  terminalId: string;
  terminalSeed?: PosProvisionedTerminalSeed | null;
};

type RepairTerminalSeedPayload = {
  seed: PosProvisionedTerminalSeed;
};

type RepairTerminalSeedContext = {
  expectedTerminalSeedIdentity?: string;
};

type ClearStaleDrawerAuthorityPreconditions = {
  blockerReason: PosDrawerAuthorityBlockReason;
  cloudRegisterSessionId: string;
  localEventSettlement: "settled";
  localRegisterSessionId: string;
};

type ClearLocalReviewItemsRequest =
  | { clearAll: true; limit: number; localEventIds: string[] }
  | { clearAll: false; localEventIds: string[] };

const CLEAR_LOCAL_REVIEW_ITEMS_HARD_CAP = 100;
const COLLECT_LOCAL_REVIEW_ITEMS_HARD_CAP = 100;

const SUPPORTED_COMMAND_TYPES = new Set<string>([
  "retry_sync",
  "collect_local_review",
  "clear_local_review_items",
  "repair_terminal_seed",
  "clear_stale_drawer_authority",
  "refresh_staff_authority",
  "refresh_snapshots",
  "report_diagnostics",
  "update_app",
]);

const activeUpdateAppCommands = new Set<string>();

export async function executeTerminalRecoveryCommand(
  context: PosTerminalRecoveryCommandContext,
): Promise<PosTerminalRecoveryCommandResult> {
  const { command } = context;
  const commandType = getCommandType(command);

  if (!commandType || !SUPPORTED_COMMAND_TYPES.has(commandType)) {
    return failed(command, "unsupported_command");
  }

  if (!matchesTerminalScope(context)) {
    return {
      commandId: getCommandId(command),
      reason: "terminal_mismatch",
      status: "ignored",
      type: commandType,
    };
  }
  if (typeof command.executionId !== "string" || command.executionId.length === 0) {
    return preconditionFailed(command);
  }

  try {
    switch (commandType) {
      case "retry_sync":
        return executeRetrySync(context);
      case "collect_local_review":
        return executeCollectLocalReview(context);
      case "clear_local_review_items":
        return executeClearLocalReviewItems(context);
      case "repair_terminal_seed":
        return executeRepairTerminalSeed(context);
      case "clear_stale_drawer_authority":
        return executeClearStaleDrawerAuthority(context);
      case "refresh_staff_authority":
        return executeCallbackCommand(context, context.refreshStaffAuthority);
      case "refresh_snapshots":
        return executeCallbackCommand(context, context.refreshSnapshots);
      case "report_diagnostics":
        return executeCallbackCommand(context, context.reportDiagnostics, {
          allowMissingCallback: true,
        });
      case "update_app":
        return executeUpdateApp(context);
      default:
        return failed(command, "unsupported_command");
    }
  } catch (error) {
    return failed(command, "local_store_failure", {
      message: safeRecoveryMessage(error),
    });
  }
}

async function executeUpdateApp(
  context: PosTerminalRecoveryCommandContext,
): Promise<PosTerminalRecoveryCommandResult> {
  const commandKey = getCommandExecutionKey(context.command);
  if (activeUpdateAppCommands.has(commandKey)) {
    return preconditionFailed(context.command);
  }

  const coordinator = context.appUpdateCoordinator;
  if (!coordinator) {
    return completed(context.command, {
      diagnostics: {
        appUpdateStatus: "unknown",
        terminalId: context.terminalId,
      },
      message: "App update status is not available on this terminal.",
    });
  }

  activeUpdateAppCommands.add(commandKey);
  const releaseLock = () => activeUpdateAppCommands.delete(commandKey);
  let snapshot: UpdateCoordinatorSnapshot;
  try {
    snapshot = coordinator.getSnapshot();
  } catch (error) {
    releaseLock();
    return completed(context.command, {
      diagnostics: {
        appUpdateStatus: "detector_failed",
        terminalId: context.terminalId,
      },
      message: safeRecoveryMessage(error),
    });
  }

  const appUpdateStatus = toCanonicalAppUpdateStatus(snapshot);
  const baseDiagnostics = {
    appUpdateCanApply: snapshot.canApply,
    appUpdateStatus,
    ...(snapshot.staging?.reason
      ? { appUpdateStagingReason: snapshot.staging.reason }
      : {}),
    ...(typeof snapshot.staging?.assetCount === "number"
      ? { appUpdateStagingAssetCount: snapshot.staging.assetCount }
      : {}),
    ...(typeof snapshot.staging?.failedAssetCount === "number"
      ? { appUpdateStagingFailedAssetCount: snapshot.staging.failedAssetCount }
      : {}),
    ...(typeof snapshot.staging?.rejectedAssetCount === "number"
      ? { appUpdateStagingRejectedAssetCount: snapshot.staging.rejectedAssetCount }
      : {}),
    ...(snapshot.currentBuildId
      ? { currentBuildId: snapshot.currentBuildId }
      : {}),
    ...(snapshot.pendingBuildId
      ? { pendingBuildId: snapshot.pendingBuildId }
      : {}),
    terminalId: context.terminalId,
  };

  if (!snapshot.canApply) {
    releaseLock();
    return completed(context.command, {
      diagnostics: baseDiagnostics,
      message: getAppUpdateEvaluationMessage(appUpdateStatus),
    });
  }

  return completed(context.command, {
    diagnostics: {
      ...baseDiagnostics,
      appUpdateStatus: "applying",
    },
    message: "App update accepted and will apply when the terminal is safe to refresh.",
    onAcknowledgeFailed: releaseLock,
    postAcknowledge: () => {
      try {
        const applied = coordinator.applyUpdate({ bypassUnloadPrompt: true });
        return applied
          ? { applied: true }
          : {
              applied: false,
              message:
                "App update was accepted, but refresh is now blocked by local work.",
            };
      } finally {
        releaseLock();
      }
    },
  });
}

async function executeRetrySync(
  context: PosTerminalRecoveryCommandContext,
): Promise<PosTerminalRecoveryCommandResult> {
  await context.onRetrySync?.();
  return completed(context.command, {
    diagnostics: { terminalId: context.terminalId },
  });
}

async function executeCollectLocalReview(
  context: PosTerminalRecoveryCommandContext,
): Promise<PosTerminalRecoveryCommandResult> {
  const events = await context.store.listEvents();
  if (!events.ok) {
    return failed(context.command, "local_store_failure", {
      message: events.error.message,
    });
  }

  const reviewEvents = getScopedLocalReviewEvents(events.value, context);
  const uploadedReviewEventCount = reviewEvents.filter(
    (event) => event.sync.uploaded === true,
  ).length;
  if (reviewEvents.length > 0) {
    await context.onRetrySync?.();
  }

  return completed(context.command, {
    diagnostics: {
      reviewEventCount: reviewEvents.length,
      terminalId: context.terminalId,
      uploadedReviewEventCount,
    },
    localReviewEvents: reviewEvents
      .slice(0, COLLECT_LOCAL_REVIEW_ITEMS_HARD_CAP)
      .map(toLocalReviewEvidence),
    message:
      reviewEvents.length === 0
        ? "No local review items were found on this terminal."
        : `${reviewEvents.length} local review item${reviewEvents.length === 1 ? "" : "s"} ${reviewEvents.length === 1 ? "was" : "were"} collected and queued for sync retry.`,
  });
}

function toLocalReviewEvidence(
  event: PosLocalEventRecord,
): PosTerminalRecoveryLocalReviewEvent {
  return {
    createdAt: event.createdAt,
    localEventId: event.localEventId,
    ...(event.localPosSessionId
      ? { localPosSessionId: event.localPosSessionId }
      : {}),
    ...(event.localRegisterSessionId
      ? { localRegisterSessionId: event.localRegisterSessionId }
      : {}),
    sequence: event.sequence,
    status: event.sync.status,
    type: event.type,
    ...(event.sync.uploaded !== undefined
      ? { uploaded: event.sync.uploaded }
      : {}),
    ...(typeof event.uploadSequence === "number"
      ? { uploadSequence: event.uploadSequence }
      : {}),
  };
}

async function executeClearLocalReviewItems(
  context: PosTerminalRecoveryCommandContext,
): Promise<PosTerminalRecoveryCommandResult> {
  const request = toClearLocalReviewItemsRequest(context.command);
  if (!request) {
    return preconditionFailed(context.command);
  }

  const events = await context.store.listEvents();
  if (!events.ok) {
    return failed(context.command, "local_store_failure", {
      message: events.error.message,
    });
  }

  const reviewEvents = request.clearAll
    ? getScopedLocalReviewEvents(events.value, context)
    : getScopedUploadedLocalReviewEvents(events.value, context);
  const previouslyClearedEvents = getScopedTerminalRecoveryClearedReviewEvents(
    events.value,
    context,
  );
  const selection = selectLocalReviewEventIdsForClear(
    request,
    reviewEvents,
    previouslyClearedEvents,
  );
  if (!selection.allRequestedIdsAccountedFor) {
    return preconditionFailed(context.command);
  }

  const clear = await context.store.clearLocalReviewEvents(selection.idsToClear);
  if (!clear.ok) {
    return failed(context.command, "local_store_failure", {
      message: clear.error.message,
    });
  }

  const remainingEvents = await context.store.listEvents();
  if (!remainingEvents.ok) {
    return failed(context.command, "local_store_failure", {
      message: remainingEvents.error.message,
    });
  }

  const clearedReviewEventCount = clear.value.length;
  const remainingReviewEventCount = (request.clearAll
    ? getScopedLocalReviewEvents
    : getScopedUploadedLocalReviewEvents)(remainingEvents.value, context)
    .length;

  return completed(context.command, {
    clearedLocalReviewEventIds: selection.idsForAcknowledgement,
    diagnostics: {
      clearedReviewEventCount,
      remainingReviewEventCount,
      terminalId: context.terminalId,
    },
    message:
      clearedReviewEventCount === 0
        ? "No local review items matched this recovery command."
        : `${clearedReviewEventCount} local review item${clearedReviewEventCount === 1 ? "" : "s"} ${clearedReviewEventCount === 1 ? "was" : "were"} cleared on this terminal.`,
  });
}

async function executeRepairTerminalSeed(
  context: PosTerminalRecoveryCommandContext,
): Promise<PosTerminalRecoveryCommandResult> {
  const payload = toRepairTerminalSeedPayload(getCommandPayload(context.command));
  const seed = payload?.seed ?? context.terminalSeed;
  if (!seed) {
    return failed(context.command, "missing_payload");
  }
  if (!matchesSeedScope(seed, context)) {
    return preconditionFailed(context.command);
  }
  const repairContext = toRepairTerminalSeedContext(context.command.commandContext);
  if (
    repairContext?.expectedTerminalSeedIdentity &&
    !terminalScopeIds(context).has(repairContext.expectedTerminalSeedIdentity)
  ) {
    return preconditionFailed(context.command);
  }

  const writeSeed =
    context.store.writeProvisionedTerminalSeedAndClearTerminalIntegrity;
  if (typeof writeSeed !== "function") {
    return failed(context.command, "local_store_failure");
  }

  const result = await writeSeed({
    seed,
    terminalIntegrity: {
      storeId: context.storeId,
      terminalId: seed.terminalId,
    },
  });
  if (!result.ok) {
    return failed(context.command, "local_store_failure", {
      message: result.error.message,
    });
  }

  return completed(context.command, {
    diagnostics: { terminalId: seed.cloudTerminalId },
  });
}

async function executeClearStaleDrawerAuthority(
  context: PosTerminalRecoveryCommandContext,
): Promise<PosTerminalRecoveryCommandResult> {
  const preconditions = toClearDrawerAuthorityPreconditions(context.command);
  if (!preconditions) {
    return failed(context.command, "missing_payload");
  }

  const readDrawerAuthorityState = context.store.readDrawerAuthorityState;
  const clearDrawerAuthorityState = context.store.clearDrawerAuthorityState;
  if (
    typeof readDrawerAuthorityState !== "function" ||
    typeof clearDrawerAuthorityState !== "function"
  ) {
    return failed(context.command, "local_store_failure");
  }

  const drawerAuthority = await readScopedDrawerAuthorityState({
    context,
    localRegisterSessionId: preconditions.localRegisterSessionId,
  });
  if (!drawerAuthority.ok) {
    return failed(context.command, "local_store_failure", {
      message: drawerAuthority.error.message,
    });
  }

  if (!drawerAuthority.value || drawerAuthority.value.status !== "blocked") {
    return preconditionFailed(context.command, "unsafe_authority_state");
  }
  if (!matchesDrawerPreconditions(drawerAuthority.value, preconditions)) {
    return preconditionFailed(context.command);
  }

  const events = await context.store.listEvents();
  if (!events.ok) {
    return failed(context.command, "local_store_failure", {
      message: events.error.message,
    });
  }
  if (
    !hasSettledLifecycleEvents({
      events: events.value,
      localRegisterSessionId: preconditions.localRegisterSessionId,
      storeId: context.storeId,
      terminalIds: terminalScopeIds(context),
    })
  ) {
    return preconditionFailed(context.command);
  }

  const clear = await clearDrawerAuthorityState({
    localRegisterSessionId: drawerAuthority.value.localRegisterSessionId,
    storeId: drawerAuthority.value.storeId,
    terminalId: drawerAuthority.value.terminalId,
  });
  if (!clear.ok) {
    return failed(context.command, "local_store_failure", {
      message: clear.error.message,
    });
  }

  return completed(context.command, {
    diagnostics: {
      localRegisterSessionId: preconditions.localRegisterSessionId,
      terminalId: context.terminalId,
    },
  });
}

async function executeCallbackCommand(
  context: PosTerminalRecoveryCommandContext,
  callback:
    | PosTerminalRecoveryCommandContext["refreshSnapshots"]
    | PosTerminalRecoveryCommandContext["refreshStaffAuthority"]
    | PosTerminalRecoveryCommandContext["reportDiagnostics"],
  options: { allowMissingCallback?: boolean } = {},
): Promise<PosTerminalRecoveryCommandResult> {
  if (!callback) {
    if (options.allowMissingCallback) {
      return completed(context.command, {
        diagnostics: { terminalId: context.terminalId },
      });
    }
    return failed(context.command, "missing_callback");
  }

  const result = await callback({
    storeId: context.storeId,
    terminalId: context.terminalId,
  });

  return completed(context.command, {
    diagnostics: {
      ...(result.refreshedAt ? { refreshedAt: result.refreshedAt } : {}),
      ...(result.status ? { status: result.status } : {}),
      terminalId: context.terminalId,
    },
    message: result.message,
  });
}

function matchesTerminalScope(context: PosTerminalRecoveryCommandContext) {
  if (context.command.storeId !== context.storeId) {
    return false;
  }

  return terminalScopeIds(context).has(context.command.terminalId);
}

function matchesSeedScope(
  seed: PosProvisionedTerminalSeed,
  context: PosTerminalRecoveryCommandContext,
) {
  if (seed.storeId !== context.storeId) {
    return false;
  }

  const scopeIds = terminalScopeIds(context);
  return scopeIds.has(seed.cloudTerminalId) || scopeIds.has(seed.terminalId);
}

function terminalScopeIds(context: PosTerminalRecoveryCommandContext) {
  return new Set(
    [
      context.terminalId,
      context.terminalSeed?.cloudTerminalId,
      context.terminalSeed?.terminalId,
    ].filter((value): value is string => Boolean(value)),
  );
}

async function readScopedDrawerAuthorityState(input: {
  context: PosTerminalRecoveryCommandContext;
  localRegisterSessionId: string;
}): Promise<PosLocalStoreResult<PosDrawerAuthorityState | null>> {
  const readDrawerAuthorityState = input.context.store.readDrawerAuthorityState;
  if (typeof readDrawerAuthorityState !== "function") {
    return {
      ok: false,
      error: {
        code: "write_failed",
        message: "POS local store could not read drawer authority.",
      },
    };
  }

  const states: PosDrawerAuthorityState[] = [];
  for (const terminalId of terminalScopeIds(input.context)) {
    const result = await readDrawerAuthorityState({
      localRegisterSessionId: input.localRegisterSessionId,
      storeId: input.context.storeId,
      terminalId,
    });
    if (!result.ok) return result;
    if (result.value) states.push(result.value);
  }

  return {
    ok: true,
    value:
      states.sort((left, right) => right.observedAt - left.observedAt).at(0) ??
      null,
  };
}

function matchesDrawerPreconditions(
  state: PosDrawerAuthorityState,
  preconditions: ClearStaleDrawerAuthorityPreconditions,
) {
  return (
    state.localRegisterSessionId === preconditions.localRegisterSessionId &&
    state.cloudRegisterSessionId === preconditions.cloudRegisterSessionId &&
    state.reason === preconditions.blockerReason
  );
}

function hasSettledLifecycleEvents(input: {
  events: PosLocalEventRecord[];
  localRegisterSessionId: string;
  storeId: string;
  terminalIds: Set<string>;
}) {
  const lifecycleEvents = input.events.filter(
    (event) =>
      event.storeId === input.storeId &&
      input.terminalIds.has(event.terminalId) &&
      event.localRegisterSessionId === input.localRegisterSessionId &&
      isDrawerAuthorityLifecycleEvent(event),
  );

  return (
    lifecycleEvents.length > 0 &&
    lifecycleEvents.every((event) =>
      isSettledLocalSyncStatus(event.sync.status),
    )
  );
}

function getScopedLocalReviewEvents(
  events: PosLocalEventRecord[],
  context: PosTerminalRecoveryCommandContext,
) {
  const scopeIds = terminalScopeIds(context);
  return events
    .filter(
      (event) =>
        event.storeId === context.storeId &&
        scopeIds.has(event.terminalId) &&
        event.sync.status === "needs_review",
    )
    .sort(compareLocalReviewEventOrder);
}

function getScopedUploadedLocalReviewEvents(
  events: PosLocalEventRecord[],
  context: PosTerminalRecoveryCommandContext,
) {
  return getScopedLocalReviewEvents(events, context).filter(
    (event) => event.sync.uploaded === true,
  );
}

function getScopedTerminalRecoveryClearedReviewEvents(
  events: PosLocalEventRecord[],
  context: PosTerminalRecoveryCommandContext,
) {
  const scopeIds = terminalScopeIds(context);
  return events.filter(
    (event) =>
      event.storeId === context.storeId &&
      scopeIds.has(event.terminalId) &&
      event.sync.status === "locally_resolved" &&
      event.sync.localResolution?.reason === "terminal_recovery_command",
  );
}

function selectLocalReviewEventIdsForClear(
  request: ClearLocalReviewItemsRequest,
  reviewEvents: PosLocalEventRecord[],
  previouslyClearedEvents: PosLocalEventRecord[],
) {
  if (request.clearAll) {
    const scopedReviewIds = new Set(
      reviewEvents.map((event) => event.localEventId),
    );
    const scopedPreviouslyClearedIds = new Set(
      previouslyClearedEvents.map((event) => event.localEventId),
    );
    const requestedIds = request.localEventIds.slice(
      0,
      Math.min(request.limit, CLEAR_LOCAL_REVIEW_ITEMS_HARD_CAP),
    );
    const idsToClear = requestedIds.filter((localEventId) =>
      reviewEvents.some(
        (event) =>
          event.localEventId === localEventId &&
          isClearableLocalReviewEvent(event),
      ),
    );
    return {
      allRequestedIdsAccountedFor:
        request.localEventIds.length <= request.limit &&
        request.localEventIds.every(
          (localEventId) =>
            scopedReviewIds.has(localEventId) ||
            scopedPreviouslyClearedIds.has(localEventId),
        ) &&
        reviewEvents.every((event) =>
          request.localEventIds.includes(event.localEventId) &&
          isClearableLocalReviewEvent(event),
        ),
      idsForAcknowledgement: request.localEventIds,
      idsToClear,
    };
  }

  const scopedReviewIds = new Set(
    reviewEvents.map((event) => event.localEventId),
  );
  const scopedPreviouslyClearedIds = new Set(
    previouslyClearedEvents.map((event) => event.localEventId),
  );
  const idsToClear = request.localEventIds
    .filter((localEventId) => scopedReviewIds.has(localEventId))
    .slice(0, CLEAR_LOCAL_REVIEW_ITEMS_HARD_CAP);
  return {
    allRequestedIdsAccountedFor: request.localEventIds.every(
      (localEventId) =>
        scopedReviewIds.has(localEventId) ||
        scopedPreviouslyClearedIds.has(localEventId),
    ),
    idsForAcknowledgement: request.localEventIds,
    idsToClear,
  };
}

function compareLocalReviewEventOrder(
  left: PosLocalEventRecord,
  right: PosLocalEventRecord,
) {
  const leftUploadSequence = left.uploadSequence ?? Number.POSITIVE_INFINITY;
  const rightUploadSequence = right.uploadSequence ?? Number.POSITIVE_INFINITY;
  if (leftUploadSequence !== rightUploadSequence) {
    return leftUploadSequence - rightUploadSequence;
  }

  return left.sequence - right.sequence;
}

function isSettledLocalSyncStatus(status: PosLocalSyncEventStatus) {
  return status === "synced" || status === "locally_resolved";
}

function isDrawerAuthorityLifecycleEvent(event: PosLocalEventRecord) {
  return (
    event.type === "register.opened" ||
    event.type === "register.closeout_started" ||
    event.type === "register.reopened" ||
    event.type === "transaction.completed"
  );
}

function isClearableLocalReviewEvent(event: PosLocalEventRecord) {
  return event.sync.uploaded === true && event.type === "register.opened";
}

function toRepairTerminalSeedPayload(
  value: unknown,
): RepairTerminalSeedPayload | null {
  if (!isRecord(value) || !isProvisionedTerminalSeed(value.seed)) {
    return null;
  }

  return { seed: value.seed };
}

function toRepairTerminalSeedContext(
  value: unknown,
): RepairTerminalSeedContext | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    value.expectedTerminalSeedIdentity !== undefined &&
    typeof value.expectedTerminalSeedIdentity !== "string"
  ) {
    return null;
  }

  return {
    ...(typeof value.expectedTerminalSeedIdentity === "string"
      ? { expectedTerminalSeedIdentity: value.expectedTerminalSeedIdentity }
      : {}),
  };
}

function toClearDrawerAuthorityPreconditions(
  command: PosTerminalRecoveryCommand,
): ClearStaleDrawerAuthorityPreconditions | null {
  const value =
    firstDrawerAuthorityPreconditions(command.preconditions) ??
    firstDrawerAuthorityPreconditions(command.commandContext) ??
    firstDrawerAuthorityPreconditions(command.payload);
  if (!value) {
    return null;
  }

  return value;
}

function toClearLocalReviewItemsRequest(
  command: PosTerminalRecoveryCommand,
): ClearLocalReviewItemsRequest | null {
  const candidates = [command.commandContext, command.payload];
  for (const candidate of candidates) {
    if (isClearAllLocalReviewRequest(candidate)) {
      const ids = firstLocalReviewEventIds(candidate);
      if (ids.length === 0) {
        return null;
      }
      return {
        clearAll: true,
        localEventIds: ids,
        limit: getLocalReviewClearLimit(candidate),
      };
    }

    const ids = firstLocalReviewEventIds(candidate);
    if (ids.length > 0) {
      return { clearAll: false, localEventIds: ids };
    }
  }

  return null;
}

function isClearAllLocalReviewRequest(value: unknown) {
  return isRecord(value) && value.localReviewClearAll === true;
}

function getLocalReviewClearLimit(value: unknown) {
  if (
    isRecord(value) &&
    typeof value.localReviewClearLimit === "number" &&
    Number.isFinite(value.localReviewClearLimit) &&
    value.localReviewClearLimit > 0
  ) {
    return Math.min(
      Math.floor(value.localReviewClearLimit),
      CLEAR_LOCAL_REVIEW_ITEMS_HARD_CAP,
    );
  }

  return CLEAR_LOCAL_REVIEW_ITEMS_HARD_CAP;
}

function firstLocalReviewEventIds(value: unknown): string[] {
  if (!isRecord(value)) {
    return [];
  }

  for (const key of [
    "localReviewEventIds",
    "localEventIds",
    "reviewEventIds",
  ]) {
    const ids = uniqueStrings(value[key]);
    if (ids.length > 0) {
      return ids;
    }
  }

  if (Array.isArray(value.localReviewEvents)) {
    const ids = uniqueStrings(
      value.localReviewEvents.map((eventRecord) =>
        isRecord(eventRecord) ? eventRecord.localEventId : undefined,
      ),
    );
    if (ids.length > 0) {
      return ids;
    }
  }

  return [];
}

function firstDrawerAuthorityPreconditions(
  value: unknown,
): ClearStaleDrawerAuthorityPreconditions | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.localRegisterSessionId !== "string" ||
    typeof value.cloudRegisterSessionId !== "string" ||
    (value.localEventSettlement !== undefined &&
      value.localEventSettlement !== "settled") ||
    !isDrawerAuthorityBlockReason(
      value.blockerReason ?? value.expectedBlockerType ?? value.reason,
    )
  ) {
    return null;
  }

  return {
    blockerReason: (value.blockerReason ??
      value.expectedBlockerType ??
      value.reason) as PosDrawerAuthorityBlockReason,
    cloudRegisterSessionId: value.cloudRegisterSessionId,
    localEventSettlement: "settled",
    localRegisterSessionId: value.localRegisterSessionId,
  };
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      ),
    ),
  );
}

function isProvisionedTerminalSeed(
  value: unknown,
): value is PosProvisionedTerminalSeed {
  return (
    isRecord(value) &&
    typeof value.cloudTerminalId === "string" &&
    typeof value.displayName === "string" &&
    typeof value.provisionedAt === "number" &&
    typeof value.schemaVersion === "number" &&
    typeof value.storeId === "string" &&
    typeof value.syncSecretHash === "string" &&
    typeof value.terminalId === "string"
  );
}

function isDrawerAuthorityBlockReason(
  value: unknown,
): value is PosDrawerAuthorityBlockReason {
  return (
    value === "cloud_closed" ||
    value === "lifecycle_rejected" ||
    value === "authority_unknown"
  );
}

function completed(
  command: PosTerminalRecoveryCommand,
  options: {
    clearedLocalReviewEventIds?: string[];
    diagnostics?: Record<string, string | number | boolean | null>;
    localReviewEvents?: PosTerminalRecoveryLocalReviewEvent[];
    message?: string;
    onAcknowledgeFailed?: () => void;
    postAcknowledge?: PosTerminalRecoveryCommandResult["postAcknowledge"];
  } = {},
): PosTerminalRecoveryCommandResult {
  return {
    commandId: getCommandId(command),
    ...(options.clearedLocalReviewEventIds &&
    options.clearedLocalReviewEventIds.length > 0
      ? { clearedLocalReviewEventIds: options.clearedLocalReviewEventIds }
      : {}),
    ...(options.diagnostics
      ? { diagnostics: redactDiagnostics(options.diagnostics) }
      : {}),
    ...(options.message
      ? { message: safeRecoveryMessage(options.message) }
      : {}),
    ...(options.localReviewEvents && options.localReviewEvents.length > 0
      ? { localReviewEvents: options.localReviewEvents }
      : {}),
    ...(options.onAcknowledgeFailed
      ? { onAcknowledgeFailed: options.onAcknowledgeFailed }
      : {}),
    ...(options.postAcknowledge
      ? { postAcknowledge: options.postAcknowledge }
      : {}),
    status: "completed",
    type: getCommandType(command) ?? "unknown_command",
  };
}

function failed(
  command: PosTerminalRecoveryCommand,
  reason: NonNullable<PosTerminalRecoveryCommandResult["reason"]>,
  options: { message?: unknown } = {},
): PosTerminalRecoveryCommandResult {
  return {
    commandId: getCommandId(command),
    ...(options.message
      ? { message: safeRecoveryMessage(options.message) }
      : {}),
    reason,
    status: "failed",
    type: getCommandType(command) ?? "unknown_command",
  };
}

function preconditionFailed(
  command: PosTerminalRecoveryCommand,
  reason: "precondition_failed" | "unsafe_authority_state" = "precondition_failed",
): PosTerminalRecoveryCommandResult {
  const commandType = getCommandType(command) ?? "unknown_command";

  return {
    commandId: getCommandId(command),
    message: getPreconditionFailureMessage(commandType, reason),
    reason,
    status: "precondition_failed",
    type: commandType,
  };
}

function getPreconditionFailureMessage(
  commandType: string,
  reason: "precondition_failed" | "unsafe_authority_state",
) {
  if (
    commandType === "clear_stale_drawer_authority" &&
    reason === "unsafe_authority_state"
  ) {
    return "Drawer repair expected a blocked drawer authority record, but this terminal no longer reported that same block.";
  }

  return "Terminal evidence changed before this recovery command could run.";
}

function getCommandId(command: PosTerminalRecoveryCommand) {
  return command.commandId ?? command._id ?? "unknown-command";
}

function getCommandExecutionKey(command: PosTerminalRecoveryCommand) {
  return getCommandId(command);
}

function getCommandType(command: PosTerminalRecoveryCommand) {
  return command.type ?? command.commandType;
}

function toCanonicalAppUpdateStatus(snapshot: UpdateCoordinatorSnapshot) {
  if (snapshot.status === "current" || snapshot.status === "checking") {
    return "current";
  }
  if (snapshot.status === "ready") {
    return snapshot.canApply ? "update_ready" : "blocked";
  }
  if (snapshot.status === "ready-unstaged") {
    return snapshot.canApply ? "update_ready" : "update_ready_unstaged";
  }
  if (snapshot.status === "blocked") {
    return "blocked";
  }
  if (snapshot.status === "applying") {
    return "applying";
  }
  if (snapshot.status === "detector-failed") {
    return "detector_failed";
  }
  return "unknown";
}

function getAppUpdateEvaluationMessage(status: string) {
  if (status === "current") {
    return "The terminal is already running the current app.";
  }
  if (status === "blocked") {
    return "The terminal has active work that is blocking app refresh.";
  }
  if (status === "update_ready_unstaged") {
    return "An app update is available but is not ready to refresh yet.";
  }
  if (status === "detector_failed") {
    return "The terminal could not determine app update status.";
  }
  if (status === "applying") {
    return "The terminal is already applying an app update.";
  }
  return "App update status is not available on this terminal.";
}

function getCommandPayload(command: PosTerminalRecoveryCommand) {
  return command.payload ?? command.commandContext;
}

function redactDiagnostics(
  diagnostics: Record<string, string | number | boolean | null>,
) {
  return Object.fromEntries(
    Object.entries(diagnostics).map(([key, value]) => [
      key,
      typeof value === "string" ? safeRecoveryMessage(value) : value,
    ]),
  );
}

function safeRecoveryMessage(value: unknown) {
  const maxLength = 240;
  const message =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : "Terminal recovery command could not complete.";
  const collapsed = message.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return "Terminal recovery command could not complete.";
  }

  return collapsed
    .replace(
      /\b(staffProofToken|staff proof|proof-token|syncSecretHash|syncSecret|sync secret|verifier|PIN|pin|rawPayload|raw payload|payload)\b(?:\s*[:=]?\s*[^.,;]*)?/gi,
      "$1 [redacted]",
    )
    .replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]")
    .slice(0, maxLength);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

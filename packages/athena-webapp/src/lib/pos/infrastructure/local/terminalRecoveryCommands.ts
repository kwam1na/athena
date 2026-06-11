import type {
  PosDrawerAuthorityBlockReason,
  PosDrawerAuthorityState,
  PosLocalEventRecord,
  PosLocalStoreResult,
  PosLocalSyncEventStatus,
  PosProvisionedTerminalSeed,
  createPosLocalStore,
} from "./posLocalStore";

export type PosTerminalRecoveryCommandType =
  | "retry_sync"
  | "repair_terminal_seed"
  | "clear_stale_drawer_authority"
  | "refresh_staff_authority"
  | "refresh_snapshots"
  | "report_diagnostics";

export type PosTerminalRecoveryCommand = {
  _id?: string;
  commandContext?: unknown;
  commandId?: string;
  commandType?: PosTerminalRecoveryCommandType;
  expectedEvidence?: unknown;
  storeId: string;
  terminalId: string;
  type?: PosTerminalRecoveryCommandType;
  payload?: unknown;
  preconditions?: unknown;
};

export type PosTerminalRecoveryCommandResult = {
  commandId: string;
  diagnostics?: Record<string, string | number | boolean | null>;
  message?: string;
  reason?:
    | "local_store_failure"
    | "missing_callback"
    | "missing_payload"
    | "precondition_failed"
    | "terminal_mismatch"
    | "unsupported_command"
    | "unsafe_authority_state";
  status: "completed" | "failed" | "ignored";
  type: string;
};

export type PosTerminalRecoveryCommandCallbackResult = {
  message?: string;
  refreshedAt?: number;
  status?: string;
};

type PosLocalRuntimeStore = ReturnType<typeof createPosLocalStore>;

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
  store: PosLocalRuntimeStore;
  storeId: string;
  terminalId: string;
  terminalSeed?: PosProvisionedTerminalSeed | null;
};

type RepairTerminalSeedPayload = {
  seed: PosProvisionedTerminalSeed;
};

type ClearStaleDrawerAuthorityPreconditions = {
  blockerReason: PosDrawerAuthorityBlockReason;
  cloudRegisterSessionId: string;
  localEventSettlement: "settled";
  localRegisterSessionId: string;
};

const SUPPORTED_COMMAND_TYPES = new Set<string>([
  "retry_sync",
  "repair_terminal_seed",
  "clear_stale_drawer_authority",
  "refresh_staff_authority",
  "refresh_snapshots",
  "report_diagnostics",
]);

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

  try {
    switch (commandType) {
      case "retry_sync":
        return executeRetrySync(context);
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
      default:
        return failed(command, "unsupported_command");
    }
  } catch (error) {
    return failed(command, "local_store_failure", {
      message: safeRecoveryMessage(error),
    });
  }
}

async function executeRetrySync(
  context: PosTerminalRecoveryCommandContext,
): Promise<PosTerminalRecoveryCommandResult> {
  await context.onRetrySync?.();
  return completed(context.command, {
    diagnostics: { terminalId: context.terminalId },
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
    return failed(context.command, "precondition_failed");
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
  const preconditions = toClearDrawerAuthorityPreconditions(
    context.command.preconditions ?? getCommandPayload(context.command),
  );
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
    return failed(context.command, "unsafe_authority_state");
  }
  if (!matchesDrawerPreconditions(drawerAuthority.value, preconditions)) {
    return failed(context.command, "precondition_failed");
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
    return failed(context.command, "precondition_failed");
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

function isSettledLocalSyncStatus(status: PosLocalSyncEventStatus) {
  return status === "synced";
}

function isDrawerAuthorityLifecycleEvent(event: PosLocalEventRecord) {
  return (
    event.type === "register.opened" ||
    event.type === "register.closeout_started" ||
    event.type === "register.reopened" ||
    event.type === "transaction.completed"
  );
}

function toRepairTerminalSeedPayload(
  value: unknown,
): RepairTerminalSeedPayload | null {
  if (!isRecord(value) || !isProvisionedTerminalSeed(value.seed)) {
    return null;
  }

  return { seed: value.seed };
}

function toClearDrawerAuthorityPreconditions(
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
    diagnostics?: Record<string, string | number | boolean | null>;
    message?: string;
  } = {},
): PosTerminalRecoveryCommandResult {
  return {
    commandId: getCommandId(command),
    ...(options.diagnostics
      ? { diagnostics: redactDiagnostics(options.diagnostics) }
      : {}),
    ...(options.message
      ? { message: safeRecoveryMessage(options.message) }
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

function getCommandId(command: PosTerminalRecoveryCommand) {
  return command.commandId ?? command._id ?? "unknown-command";
}

function getCommandType(command: PosTerminalRecoveryCommand) {
  return command.type ?? command.commandType;
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
    .replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

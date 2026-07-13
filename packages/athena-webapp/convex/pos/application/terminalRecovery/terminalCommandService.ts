import type { Doc, Id } from "../../../_generated/dataModel";
import {
  ok,
  userError,
  type CommandResult,
} from "../../../../shared/commandResult";
import {
  TERMINAL_RECOVERY_COMMAND_TYPES,
  type TerminalRecoveryCommandAckResult,
  type TerminalRecoveryLocalReviewEventEvidence,
  type TerminalRecoveryCommandPayload,
  type TerminalRecoveryCommandType,
  type TerminalRecoveryExpectedEvidence,
} from "./types";

const COMMAND_TTL_MS = 15 * 60 * 1000;
const RUNTIME_VERIFICATION_FRESHNESS_MS = 2 * 60 * 1000;
const ACKNOWLEDGEMENT_MESSAGE_MAX_LENGTH = 240;
const LOCAL_REVIEW_CLEAR_COMMAND_EVENT_LIMIT = 100;
const LOCAL_REVIEW_ACK_EVENT_LIMIT = 100;
const SECRET_LIKE_KEYS = [
  "secret",
  "token",
  "pin",
  "verifier",
  "password",
  "authorization",
  "payment",
  "customer",
  "payload",
] as const;
const SECRET_LIKE_KEY_PATTERN = SECRET_LIKE_KEYS.join("|");
const SECRET_LIKE_FIELD_PATTERN = String.raw`\b[A-Za-z0-9_-]*(?:${SECRET_LIKE_KEY_PATTERN})[A-Za-z0-9_-]*\b`;

export type TerminalRecoveryCommandReadRepository = {
  getCommand(
    commandId: Id<"posTerminalRecoveryCommand">,
  ): Promise<Doc<"posTerminalRecoveryCommand"> | null>;
  listCommandsForTerminal(args: {
    expiresAfter?: number;
    storeId: Id<"store">;
    statuses?: Array<Doc<"posTerminalRecoveryCommand">["status"]>;
    terminalId: Id<"posTerminal">;
  }): Promise<Doc<"posTerminalRecoveryCommand">[]>;
  listRuntimeVerificationReadyCommands(args: {
    cursor?: string;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  }): Promise<{
    commands: Doc<"posTerminalRecoveryCommand">[];
    nextCursor?: string;
  }>;
};

export type TerminalRecoveryCommandRepository = TerminalRecoveryCommandReadRepository & {
  insertCommand(
    input: Omit<Doc<"posTerminalRecoveryCommand">, "_id" | "_creationTime">,
  ): Promise<Id<"posTerminalRecoveryCommand">>;
  patchCommand(
    commandId: Id<"posTerminalRecoveryCommand">,
    patch: Partial<Doc<"posTerminalRecoveryCommand">>,
  ): Promise<void>;
};

export async function issueTerminalRecoveryCommand(
  repository: TerminalRecoveryCommandRepository,
  args: {
    commandType: TerminalRecoveryCommandType;
    expectedEvidence: TerminalRecoveryExpectedEvidence;
    issuedAt: number;
    issuedByUserId: Id<"athenaUser">;
    commandContext: TerminalRecoveryCommandPayload;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
): Promise<CommandResult<Doc<"posTerminalRecoveryCommand">>> {
  if (!TERMINAL_RECOVERY_COMMAND_TYPES.includes(args.commandType)) {
    return userError({
      code: "validation_failed",
      message: "Unsupported terminal recovery command.",
    });
  }
  if (containsSecretLikeField(args.commandContext)) {
    return userError({
      code: "validation_failed",
      message: "Terminal recovery commands can only store non-secret audit data.",
    });
  }
  if (containsSecretLikeField(args.expectedEvidence)) {
    return userError({
      code: "validation_failed",
      message: "Terminal recovery commands can only store non-secret audit data.",
    });
  }

  const commandContext = pruneUndefined(args.commandContext);
  const expectedEvidence = pruneUndefined(args.expectedEvidence);
  const shapeValidation = validateTerminalRecoveryCommandShape({
    commandContext,
    commandType: args.commandType,
    expectedEvidence,
  });
  if (shapeValidation) {
    return userError({
      code: "validation_failed",
      message: shapeValidation,
    });
  }
  const existingCommands = await repository.listCommandsForTerminal({
    expiresAfter: args.issuedAt,
    storeId: args.storeId,
    statuses: ["pending", "claimed", "completed"],
    terminalId: args.terminalId,
  });
  for (const command of existingCommands) {
    if (
      args.commandType === "update_app" &&
      command.commandType === "update_app" &&
      isUpdateAppActiveCommand(command)
    ) {
      return ok(command);
    }
    if (!isEquivalentCommand(command, {
      commandContext,
      commandType: args.commandType,
      expectedEvidence,
    })) {
      continue;
    }
    if (isActiveCommand(command)) {
      return ok(command);
    }
  }

  const input = {
    storeId: args.storeId,
    terminalId: args.terminalId,
    commandType: args.commandType,
    status: "pending" as const,
    verificationStatus: "waiting_for_acknowledgement" as const,
    commandContext,
    expectedEvidence,
    issuedByUserId: args.issuedByUserId,
    issuedAt: args.issuedAt,
    expiresAt: args.issuedAt + COMMAND_TTL_MS,
  };
  const commandId = await repository.insertCommand(input);
  const command = await repository.getCommand(commandId);
  return ok(command ?? ({ _id: commandId, _creationTime: args.issuedAt, ...input } as Doc<"posTerminalRecoveryCommand">));
}

export async function listClaimableTerminalRecoveryCommands(
  repository: TerminalRecoveryCommandReadRepository,
  args: {
    now: number;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
) {
  const commands = await repository.listCommandsForTerminal({
    expiresAfter: args.now,
    storeId: args.storeId,
    statuses: ["pending", "claimed"],
    terminalId: args.terminalId,
  });
  const claimable: Doc<"posTerminalRecoveryCommand">[] = [];
  for (const command of commands) {
    if (
      command.expiresAt <= args.now &&
      (command.status === "pending" || command.status === "claimed")
    ) {
      continue;
    }
    if (
      command.storeId === args.storeId &&
      command.terminalId === args.terminalId &&
      (command.status === "pending" ||
        (command.status === "claimed" && command.commandType !== "update_app")) &&
      command.expiresAt > args.now
    ) {
      claimable.push(command);
    }
  }
  return claimable;
}

export async function claimTerminalRecoveryCommand(
  repository: TerminalRecoveryCommandRepository,
  args: {
    claimedAt: number;
    commandId: Id<"posTerminalRecoveryCommand">;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
): Promise<CommandResult<Doc<"posTerminalRecoveryCommand">>> {
  const command = await loadScopedCommand(repository, args);
  if (!command) {
    return notFound();
  }
  if (command.expiresAt <= args.claimedAt) {
    await repository.patchCommand(command._id, { status: "expired" });
    return userError({
      code: "precondition_failed",
      message: "This terminal recovery command has expired.",
    });
  }
  if (command.status !== "pending" && command.status !== "claimed") {
    return userError({
      code: "precondition_failed",
      message: "This terminal recovery command is no longer claimable.",
    });
  }
  if (command.commandType === "update_app" && command.status === "claimed") {
    return userError({
      code: "precondition_failed",
      message: "This terminal recovery command is already claimed.",
    });
  }

  if (command.status === "pending") {
    const executionId = buildExecutionId(command._id, args.claimedAt);
    await repository.patchCommand(command._id, pruneUndefined({
      claimedAt: args.claimedAt,
      executionId,
      expectedEvidence:
        command.commandType === "update_app" &&
        command.expectedEvidence.appUpdateCommandExecutionId === undefined
          ? {
              ...command.expectedEvidence,
              appUpdateCommandExecutionId: executionId,
            }
          : undefined,
      status: "claimed",
    }));
  }

  const executionId =
    command.executionId ??
    buildExecutionId(command._id, args.claimedAt);
  const expectedEvidence =
    command.commandType === "update_app" &&
    command.expectedEvidence.appUpdateCommandExecutionId === undefined
      ? {
          ...command.expectedEvidence,
          appUpdateCommandExecutionId: executionId,
        }
      : command.expectedEvidence;
  return ok({
    ...command,
    claimedAt: command.claimedAt ?? args.claimedAt,
    executionId,
    expectedEvidence,
    status: "claimed",
  });
}

export async function acknowledgeTerminalRecoveryCommand(
  repository: TerminalRecoveryCommandRepository,
  args: {
    acknowledgedAt: number;
    clearedLocalReviewEventIds?: string[];
    commandId: Id<"posTerminalRecoveryCommand">;
    executionId?: string;
    localReviewEvents?: TerminalRecoveryLocalReviewEventEvidence[];
    message?: string;
    result: TerminalRecoveryCommandAckResult;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
): Promise<CommandResult<Doc<"posTerminalRecoveryCommand">>> {
  const command = await loadScopedCommand(repository, args);
  if (!command) {
    return notFound();
  }
  if (command.status !== "claimed") {
    return userError({
      code: "precondition_failed",
      message: "This terminal recovery command cannot be acknowledged.",
    });
  }
  if (!command.executionId || args.executionId !== command.executionId) {
    return userError({
      code: "precondition_failed",
      message: "This terminal recovery command claim is stale.",
    });
  }

  const status = args.result;
  const verificationStatus =
    args.result === "completed"
      ? "runtime_verification_ready"
      : "verification_failed";
  const localReviewEvents = sanitizeLocalReviewEvents(args.localReviewEvents);
  const clearedLocalReviewEventIds = uniqueStrings(
    args.clearedLocalReviewEventIds,
  );
  const patch = {
    acknowledgement: pruneUndefined({
      acknowledgedAt: args.acknowledgedAt,
      ...(clearedLocalReviewEventIds.length > 0
        ? { clearedLocalReviewEventIds }
        : {}),
      ...(localReviewEvents.length > 0 ? { localReviewEvents } : {}),
      message: sanitizeAcknowledgementMessage(args.message),
      result: args.result,
    }),
    status,
    verificationStatus,
  } as const;
  await repository.patchCommand(command._id, patch);
  return ok({ ...command, ...patch });
}

function sanitizeAcknowledgementMessage(message: string | undefined) {
  if (!message) {
    return undefined;
  }

  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }

  const redacted = normalized
    .replace(
      new RegExp(`(${SECRET_LIKE_FIELD_PATTERN})\\s*[:=]\\s*\\S+`, "gi"),
      "$1=[redacted]",
    )
    .replace(
      new RegExp(`(${SECRET_LIKE_FIELD_PATTERN})\\s+\\S+`, "gi"),
      "$1 [redacted]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b[A-Za-z0-9._~+/=-]{32,}\b/g, "[redacted]");

  return redacted.length <= ACKNOWLEDGEMENT_MESSAGE_MAX_LENGTH
    ? redacted
    : `${redacted.slice(0, ACKNOWLEDGEMENT_MESSAGE_MAX_LENGTH - 3)}...`;
}

function sanitizeLocalReviewEvents(
  events?: TerminalRecoveryLocalReviewEventEvidence[],
): TerminalRecoveryLocalReviewEventEvidence[] {
  if (!Array.isArray(events)) {
    return [];
  }

  const seen = new Set<string>();
  const safeEvents: TerminalRecoveryLocalReviewEventEvidence[] = [];
  for (const event of events) {
    if (safeEvents.length >= LOCAL_REVIEW_ACK_EVENT_LIMIT) break;
    const localEventId = safeString(event.localEventId);
    const type = safeString(event.type);
    const status = safeString(event.status);
    if (!localEventId || !type || !status) continue;
    if (seen.has(localEventId)) continue;
    if (!Number.isFinite(event.createdAt) || !Number.isFinite(event.sequence)) {
      continue;
    }
    seen.add(localEventId);
    safeEvents.push(
      pruneUndefined({
        createdAt: event.createdAt,
        localEventId,
        localPosSessionId: safeString(event.localPosSessionId),
        localRegisterSessionId: safeString(event.localRegisterSessionId),
        sequence: event.sequence,
        status,
        type,
        uploaded:
          typeof event.uploaded === "boolean" ? event.uploaded : undefined,
        uploadSequence: Number.isFinite(event.uploadSequence)
          ? event.uploadSequence
          : undefined,
      }),
    );
  }

  return safeEvents;
}

function safeString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function uniqueStrings(values: unknown[] | undefined) {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const safeValue = safeString(value);
    if (!safeValue || seen.has(safeValue)) continue;
    seen.add(safeValue);
    result.push(safeValue);
  }
  return result;
}

export async function verifyTerminalRecoveryCommandsFromRuntime(
  repository: TerminalRecoveryCommandRepository,
  args: {
    cursor?: string;
    runtimeStatus: Doc<"posTerminalRuntimeStatus">;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    verifiedAt: number;
  },
) {
  const page = await repository.listRuntimeVerificationReadyCommands({
    cursor: args.cursor,
    storeId: args.storeId,
    terminalId: args.terminalId,
  });
  const verifiedCommandIds: Array<Id<"posTerminalRecoveryCommand">> = [];

  if (args.verifiedAt - args.runtimeStatus.receivedAt > RUNTIME_VERIFICATION_FRESHNESS_MS) {
    return { nextCursor: page.nextCursor, verifiedCommandIds };
  }

  for (const command of page.commands) {
    if (
      command.status !== "completed" ||
      command.verificationStatus !== "runtime_verification_ready"
    ) {
      continue;
    }
    if (
      command.acknowledgement?.acknowledgedAt !== undefined &&
      args.runtimeStatus.receivedAt < command.acknowledgement.acknowledgedAt
    ) {
      continue;
    }
    if (runtimeMatchesExpectedEvidence(args.runtimeStatus, command)) {
      await repository.patchCommand(command._id, {
        verificationStatus: "verified",
        verifiedAt: args.verifiedAt,
      });
      verifiedCommandIds.push(command._id);
    }
  }

  return { nextCursor: page.nextCursor, verifiedCommandIds };
}

function runtimeMatchesExpectedEvidence(
  runtimeStatus: Doc<"posTerminalRuntimeStatus">,
  command: Doc<"posTerminalRecoveryCommand">,
) {
  const expectedEvidence = command.expectedEvidence;
  const appUpdateEvidence = getRuntimeAppUpdateEvidence(runtimeStatus);
  if (
    expectedEvidence.appUpdateStatus !== undefined &&
    appUpdateEvidence.status !== expectedEvidence.appUpdateStatus
  ) {
    return false;
  }
  if (
    expectedEvidence.appUpdateCommandExecutionId !== undefined &&
    (appUpdateEvidence.commandExecutionId !==
      expectedEvidence.appUpdateCommandExecutionId ||
      appUpdateEvidence.status === "applying")
  ) {
    return false;
  }
  if (
    expectedEvidence.localStoreAvailable !== undefined &&
    runtimeStatus.localStore.available !== expectedEvidence.localStoreAvailable
  ) {
    return false;
  }
  if (
    expectedEvidence.terminalSeedReady !== undefined &&
    runtimeStatus.localStore.terminalSeedReady !== expectedEvidence.terminalSeedReady
  ) {
    return false;
  }
  if (
    expectedEvidence.syncStatus !== undefined &&
    runtimeStatus.sync.status !== expectedEvidence.syncStatus
  ) {
    return false;
  }
  if (
    expectedEvidence.localReviewDetailsCollected !== undefined &&
    hasRuntimeLocalReviewDetails(runtimeStatus) !==
      expectedEvidence.localReviewDetailsCollected
  ) {
    return false;
  }
  if (
    expectedEvidence.localReviewEventCount !== undefined &&
    runtimeStatus.sync.reviewEventCount !== expectedEvidence.localReviewEventCount
  ) {
    return false;
  }
  if (
    expectedEvidence.localReviewClearedEventIds !== undefined &&
    !localReviewClearEvidenceMatchesRuntime(command, runtimeStatus)
  ) {
    return false;
  }
  if (
    expectedEvidence.staffAuthorityStatus !== undefined &&
    runtimeStatus.staffAuthority.status !== expectedEvidence.staffAuthorityStatus
  ) {
    return false;
  }
  if (
    expectedEvidence.terminalIntegrityStatus !== undefined &&
    normalizeOptionalHealthyStatus(runtimeStatus.terminalIntegrity?.status) !==
      expectedEvidence.terminalIntegrityStatus
  ) {
    return false;
  }
  if (
    expectedEvidence.drawerAuthorityStatus !== undefined &&
    normalizeOptionalHealthyStatus(runtimeStatus.drawerAuthority?.status) !==
      expectedEvidence.drawerAuthorityStatus
  ) {
    return false;
  }
  if (
    expectedEvidence.localRegisterSessionId !== undefined &&
    runtimeStatus.drawerAuthority !== undefined &&
    runtimeStatus.drawerAuthority?.localRegisterSessionId !==
      expectedEvidence.localRegisterSessionId
  ) {
    return false;
  }
  if (
    expectedEvidence.saleAuthorityStatus !== undefined &&
    runtimeStatus.saleAuthority?.status !== expectedEvidence.saleAuthorityStatus
  ) {
    return false;
  }
  return true;
}

function validateTerminalRecoveryCommandShape(input: {
  commandContext: TerminalRecoveryCommandPayload;
  commandType: TerminalRecoveryCommandType;
  expectedEvidence: TerminalRecoveryExpectedEvidence;
}) {
  if (input.commandType !== "clear_local_review_items") {
    return null;
  }

  const eventIds = input.commandContext.localReviewEventIds ?? [];
  if (input.commandContext.localReviewClearAll === true) {
    if (eventIds.length === 0) {
      return "Local review clear-all commands require evidenced local review item ids.";
    }
    if (eventIds.length > LOCAL_REVIEW_CLEAR_COMMAND_EVENT_LIMIT) {
      return `Local review clear-all commands can include at most ${LOCAL_REVIEW_CLEAR_COMMAND_EVENT_LIMIT} item ids.`;
    }
    if (uniqueStrings(eventIds).length !== eventIds.length) {
      return "Local review clear-all commands require unique local review item ids.";
    }
    if (
      input.commandContext.localReviewClearLimit !== undefined &&
      (!Number.isInteger(input.commandContext.localReviewClearLimit) ||
        input.commandContext.localReviewClearLimit <= 0 ||
        input.commandContext.localReviewClearLimit >
          LOCAL_REVIEW_CLEAR_COMMAND_EVENT_LIMIT)
    ) {
      return `Local review clear-all commands can include at most ${LOCAL_REVIEW_CLEAR_COMMAND_EVENT_LIMIT} items.`;
    }
    if (input.expectedEvidence.localReviewEventCount === undefined) {
      return "Local review clear-all commands require expected local review count evidence.";
    }
    const expectedClearedIds =
      input.expectedEvidence.localReviewClearedEventIds ?? [];
    if (uniqueStrings(expectedClearedIds).length !== expectedClearedIds.length) {
      return "Local review clear-all commands require unique cleared item evidence.";
    }
    if (!arraysEqualAsSets(eventIds, expectedClearedIds)) {
      return "Local review clear-all commands require matching evidenced item ids.";
    }

    return null;
  }

  if (eventIds.length === 0) {
    return "Local review cleanup commands require explicit local review item ids.";
  }
  if (eventIds.length > LOCAL_REVIEW_CLEAR_COMMAND_EVENT_LIMIT) {
    return `Local review cleanup commands can include at most ${LOCAL_REVIEW_CLEAR_COMMAND_EVENT_LIMIT} item ids.`;
  }
  if (uniqueStrings(eventIds).length !== eventIds.length) {
    return "Local review cleanup commands require unique local review item ids.";
  }
  if (
    input.commandContext.localReviewClearLimit !== undefined
  ) {
    return "Local review cleanup commands must target explicit reviewed item ids.";
  }
  if (input.expectedEvidence.localReviewEventCount === undefined) {
    return "Local review cleanup commands require expected local review count evidence.";
  }
  const expectedClearedIds = input.expectedEvidence.localReviewClearedEventIds ?? [];
  if (uniqueStrings(expectedClearedIds).length !== expectedClearedIds.length) {
    return "Local review cleanup commands require unique cleared item evidence.";
  }
  if (
    !arraysEqualAsSets(
      eventIds,
      expectedClearedIds,
    )
  ) {
    return "Local review cleanup commands require matching cleared item evidence.";
  }

  return null;
}

function localReviewClearedIdsMatchAcknowledgement(
  command: Doc<"posTerminalRecoveryCommand">,
) {
  const expectedIds = command.expectedEvidence.localReviewClearedEventIds ?? [];
  const clearedIds = command.acknowledgement?.clearedLocalReviewEventIds ?? [];
  if (!arraysEqualAsSets(expectedIds, clearedIds)) {
    return false;
  }

  return true;
}

function localReviewClearEvidenceMatchesRuntime(
  command: Doc<"posTerminalRecoveryCommand">,
  runtimeStatus: Doc<"posTerminalRuntimeStatus">,
) {
  if (!localReviewClearedIdsMatchAcknowledgement(command)) {
    return false;
  }

  const expectedIds = command.expectedEvidence.localReviewClearedEventIds ?? [];
  const currentReviewEvents = runtimeStatus.sync.reviewEvents ?? [];
  if (currentReviewEvents.length === 0) {
    return runtimeStatus.sync.reviewEventCount === 0;
  }

  const currentReviewIds = new Set(
    currentReviewEvents.map((event) => event.localEventId),
  );
  return expectedIds.every((id) => !currentReviewIds.has(id));
}

function arraysEqualAsSets(left: string[], right: string[]) {
  const leftIds = uniqueStrings(left);
  const rightIds = uniqueStrings(right);
  if (leftIds.length !== rightIds.length) {
    return false;
  }
  const rightSet = new Set(rightIds);
  return leftIds.every((id) => rightSet.has(id));
}

function normalizeOptionalHealthyStatus(status: string | undefined) {
  return status ?? "healthy";
}

function hasRuntimeLocalReviewDetails(
  runtimeStatus: Doc<"posTerminalRuntimeStatus">,
) {
  return (
    runtimeStatus.sync.reviewEventCount === 0 ||
    (runtimeStatus.sync.reviewEvents?.length ?? 0) > 0
  );
}

function getRuntimeAppUpdateEvidence(
  runtimeStatus: Doc<"posTerminalRuntimeStatus">,
): {
  commandExecutionId?: string;
  status?: TerminalRecoveryExpectedEvidence["appUpdateStatus"];
} {
  const evidence = (
    runtimeStatus as Doc<"posTerminalRuntimeStatus"> & {
      appUpdate?: {
        commandExecutionId?: string;
        status?: TerminalRecoveryExpectedEvidence["appUpdateStatus"];
      };
    }
  ).appUpdate;

  return evidence ?? {};
}

function loadScopedCommand(
  repository: TerminalRecoveryCommandRepository,
  args: {
    commandId: Id<"posTerminalRecoveryCommand">;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
) {
  return repository.getCommand(args.commandId).then((command) => {
    if (
      !command ||
      command.storeId !== args.storeId ||
      command.terminalId !== args.terminalId
    ) {
      return null;
    }
    return command;
  });
}

function notFound(): CommandResult<never> {
  return userError({
    code: "not_found",
    message: "Terminal recovery command not found.",
  });
}

function isEquivalentCommand(
  command: Doc<"posTerminalRecoveryCommand">,
  target: {
    commandContext: TerminalRecoveryCommandPayload;
    commandType: TerminalRecoveryCommandType;
    expectedEvidence: TerminalRecoveryExpectedEvidence;
  },
) {
  return (
    command.commandType === target.commandType &&
    stableStringify(command.commandContext) ===
      stableStringify(target.commandContext) &&
    stableStringify(command.expectedEvidence) ===
      stableStringify(target.expectedEvidence)
  );
}

function isActiveCommand(command: Doc<"posTerminalRecoveryCommand">) {
  return (
    command.status === "pending" ||
    command.status === "claimed" ||
    command.verificationStatus === "runtime_verification_ready"
  );
}

function isUpdateAppActiveCommand(command: Doc<"posTerminalRecoveryCommand">) {
  return command.status === "pending" || command.status === "claimed";
}

function buildExecutionId(
  commandId: Id<"posTerminalRecoveryCommand">,
  claimedAt: number,
) {
  return `${commandId}:${claimedAt}`;
}

function containsSecretLikeField(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some(containsSecretLikeField);
  }
  if (typeof value !== "object") {
    return false;
  }
  return Object.entries(value as Record<string, unknown>).some(([key, entry]) => {
    const normalized = key.toLowerCase();
    return (
      SECRET_LIKE_KEYS.some((secretKey) => normalized.includes(secretKey)) ||
      containsSecretLikeField(entry)
    );
  });
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined),
  ) as T;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter((entry) => entry[1] !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

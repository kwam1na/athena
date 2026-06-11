import type { Doc, Id } from "../../../_generated/dataModel";
import {
  ok,
  userError,
  type CommandResult,
} from "../../../../shared/commandResult";
import {
  TERMINAL_RECOVERY_COMMAND_TYPES,
  type TerminalRecoveryCommandAckResult,
  type TerminalRecoveryCommandPayload,
  type TerminalRecoveryCommandType,
  type TerminalRecoveryExpectedEvidence,
} from "./types";

const COMMAND_TTL_MS = 15 * 60 * 1000;
const RUNTIME_VERIFICATION_FRESHNESS_MS = 2 * 60 * 1000;
const ACKNOWLEDGEMENT_MESSAGE_MAX_LENGTH = 240;
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

export type TerminalRecoveryCommandRepository = {
  getCommand(
    commandId: Id<"posTerminalRecoveryCommand">,
  ): Promise<Doc<"posTerminalRecoveryCommand"> | null>;
  insertCommand(
    input: Omit<Doc<"posTerminalRecoveryCommand">, "_id" | "_creationTime">,
  ): Promise<Id<"posTerminalRecoveryCommand">>;
  listCommandsForTerminal(args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  }): Promise<Doc<"posTerminalRecoveryCommand">[]>;
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

  const input = {
    storeId: args.storeId,
    terminalId: args.terminalId,
    commandType: args.commandType,
    status: "pending" as const,
    verificationStatus: "waiting_for_acknowledgement" as const,
    commandContext: pruneUndefined(args.commandContext),
    expectedEvidence: pruneUndefined(args.expectedEvidence),
    issuedByUserId: args.issuedByUserId,
    issuedAt: args.issuedAt,
    expiresAt: args.issuedAt + COMMAND_TTL_MS,
  };
  const commandId = await repository.insertCommand(input);
  const command = await repository.getCommand(commandId);
  return ok(command ?? ({ _id: commandId, _creationTime: args.issuedAt, ...input } as Doc<"posTerminalRecoveryCommand">));
}

export async function listClaimableTerminalRecoveryCommands(
  repository: TerminalRecoveryCommandRepository,
  args: {
    now: number;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
) {
  const commands = await repository.listCommandsForTerminal({
    storeId: args.storeId,
    terminalId: args.terminalId,
  });
  const claimable: Doc<"posTerminalRecoveryCommand">[] = [];
  for (const command of commands) {
    if (command.expiresAt <= args.now && command.status === "pending") {
      await repository.patchCommand(command._id, { status: "expired" });
      continue;
    }
    if (
      command.storeId === args.storeId &&
      command.terminalId === args.terminalId &&
      (command.status === "pending" || command.status === "claimed") &&
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

  if (command.status === "pending") {
    await repository.patchCommand(command._id, {
      claimedAt: args.claimedAt,
      status: "claimed",
    });
  }

  return ok({
    ...command,
    claimedAt: command.claimedAt ?? args.claimedAt,
    status: "claimed",
  });
}

export async function acknowledgeTerminalRecoveryCommand(
  repository: TerminalRecoveryCommandRepository,
  args: {
    acknowledgedAt: number;
    commandId: Id<"posTerminalRecoveryCommand">;
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
  if (command.status !== "claimed" && command.status !== "pending") {
    return userError({
      code: "precondition_failed",
      message: "This terminal recovery command cannot be acknowledged.",
    });
  }

  const status = args.result;
  const verificationStatus =
    args.result === "completed"
      ? "runtime_verification_ready"
      : "verification_failed";
  const patch = {
    acknowledgement: pruneUndefined({
      acknowledgedAt: args.acknowledgedAt,
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

export async function verifyTerminalRecoveryCommandsFromRuntime(
  repository: TerminalRecoveryCommandRepository,
  args: {
    runtimeStatus: Doc<"posTerminalRuntimeStatus">;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    verifiedAt: number;
  },
) {
  const commands = await repository.listCommandsForTerminal({
    storeId: args.storeId,
    terminalId: args.terminalId,
  });
  const verifiedCommandIds: Array<Id<"posTerminalRecoveryCommand">> = [];

  if (args.verifiedAt - args.runtimeStatus.receivedAt > RUNTIME_VERIFICATION_FRESHNESS_MS) {
    return { verifiedCommandIds };
  }

  for (const command of commands) {
    if (command.verificationStatus !== "runtime_verification_ready") {
      continue;
    }
    if (runtimeMatchesExpectedEvidence(args.runtimeStatus, command.expectedEvidence)) {
      await repository.patchCommand(command._id, {
        verificationStatus: "verified",
        verifiedAt: args.verifiedAt,
      });
      verifiedCommandIds.push(command._id);
    }
  }

  return { verifiedCommandIds };
}

function runtimeMatchesExpectedEvidence(
  runtimeStatus: Doc<"posTerminalRuntimeStatus">,
  expectedEvidence: TerminalRecoveryExpectedEvidence,
) {
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

function normalizeOptionalHealthyStatus(status: string | undefined) {
  return status ?? "healthy";
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

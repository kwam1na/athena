import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import {
  ok,
  userError,
  type CommandResult,
} from "../../../../shared/commandResult";

import {
  getTerminalByFingerprint,
  getTerminalById,
  getTerminalByStoreIdAndRegisterNumber,
  mapTerminalRecord,
  patchTerminalRecord,
  registerTerminalRecord,
  upsertLatestRuntimeStatus,
} from "../../infrastructure/repositories/terminalRepository";
import { deleteTerminalRecord } from "../../infrastructure/repositories/terminalRepository";

const REGISTER_NUMBER_REQUIRED_MESSAGE =
  "A register number is required to identify the terminal.";
const REGISTER_NUMBER_UNIQUE_MESSAGE =
  "A terminal with this register number already exists in this store.";
const TERMINAL_REACTIVATION_REPROVISION_MESSAGE =
  "Re-provision this terminal before returning it to service.";

const REGISTER_TERMINAL_VALIDATION_MESSAGES = new Set([
  REGISTER_NUMBER_REQUIRED_MESSAGE,
  REGISTER_NUMBER_UNIQUE_MESSAGE,
]);

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

  if (REGISTER_TERMINAL_VALIDATION_MESSAGES.has(error.message)) {
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
    storeId: Id<"store">;
    fingerprintHash: string;
    syncSecretHash: string;
    displayName: string;
    registerNumber: string;
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

    if (existing) {
      if (existing.status !== "active") {
        return userError({
          code: "authorization_failed",
          message: "This terminal must be reactivated by an administrator.",
        });
      }

      if (existing.registerNumber !== nextRegisterNumber) {
        return userError({
          code: "validation_failed",
          message:
            "This terminal is already assigned to another register number.",
        });
      }

      await patchTerminalRecord(ctx, existing._id, {
        displayName: args.displayName,
        syncSecretHash: args.syncSecretHash,
        registeredByUserId: args.registeredByUserId,
        browserInfo: args.browserInfo,
        status: "active",
        registerNumber: nextRegisterNumber,
      });

      return ok({
        ...mapTerminalRecord(existing),
        syncSecretHash: args.syncSecretHash,
        displayName: args.displayName,
        registeredByUserId: args.registeredByUserId,
        browserInfo: args.browserInfo,
        status: "active",
        registerNumber: nextRegisterNumber,
      });
    }

    const terminalId = await registerTerminalRecord(ctx, {
      storeId: args.storeId,
      fingerprintHash: args.fingerprintHash,
      syncSecretHash: args.syncSecretHash,
      displayName: args.displayName,
      registerNumber: nextRegisterNumber,
      registeredByUserId: args.registeredByUserId,
      browserInfo: args.browserInfo,
      registeredAt: Date.now(),
      status: "active",
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
  localStore: {
    available: boolean;
    schemaVersion?: number;
    terminalSeedReady: boolean;
    failureMessage?: string;
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
  };
  staffAuthority: {
    status: Doc<"posTerminalRuntimeStatus">["staffAuthority"]["status"];
    staffProfileId?: Id<"staffProfile">;
    expiresAt?: number;
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
  | "lifecycle_rejected";

const TERMINAL_NOT_ACTIVE_FOR_STORE_MESSAGE =
  "This terminal is not active for this store.";
const REDACTED_DIAGNOSTIC_VALUE = "[redacted]";
const SENSITIVE_DIAGNOSTIC_PATTERNS = [
  /\bauthorization\s*:\s*[^,;]+/gi,
  /\b(?:authorization\s*:\s*)?bearer\s+[^,\s;]+/gi,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  /(?:\+?\d[\d\s().-]{7,}\d)/g,
  /\b(?:staffProofToken|proofToken|syncSecret|syncSecretHash|token|secret|password|authorization|bearer|cookie|session)[\w-]*\s*[:=]\s*[^,\s;]+/gi,
  /\b(?:sk|pk|ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{12,}\b/g,
];

export async function submitTerminalRuntimeStatus(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    status: TerminalRuntimeStatusInput;
  },
): Promise<
  CommandResult<{
    terminalId: Id<"posTerminal">;
    reportedAt: number;
    receivedAt: number;
  }>
> {
  const terminal = await getTerminalById(ctx, args.terminalId);
  if (
    !terminal ||
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
  await upsertLatestRuntimeStatus(ctx, {
    storeId: args.storeId,
    terminalId: args.terminalId,
    reportedAt,
    receivedAt,
    source: args.status.source,
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
    }),
    sync: omitUndefined({
      status: args.status.sync.status,
      pendingEventCount: nonNegativeInteger(
        args.status.sync.pendingEventCount,
      ),
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
    }),
    staffAuthority: omitUndefined({
      status: args.status.staffAuthority.status,
      staffProfileId: args.status.staffAuthority.staffProfileId,
      expiresAt: positiveTimestamp(args.status.staffAuthority.expiresAt),
    }),
    snapshots: omitUndefined({
      catalogAgeMs: nonNegativeInteger(args.status.snapshots.catalogAgeMs),
      availabilityAgeMs: nonNegativeInteger(
        args.status.snapshots.availabilityAgeMs,
      ),
      registerReadModelAgeMs: nonNegativeInteger(
        args.status.snapshots.registerReadModelAgeMs,
      ),
    }),
    ...omitUndefined({
      terminalIntegrity: cleanTerminalIntegrity(args.status.terminalIntegrity),
      drawerAuthority: cleanDrawerAuthority(args.status.drawerAuthority),
    }),
  });

  return ok({
    terminalId: args.terminalId,
    reportedAt,
    receivedAt,
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

  return SENSITIVE_DIAGNOSTIC_PATTERNS.reduce(
    (message, pattern) => message.replace(pattern, REDACTED_DIAGNOSTIC_VALUE),
    cleaned,
  );
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
  "lifecycle_rejected",
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

function nonNegativeInteger(value: number | undefined) {
  return Number.isSafeInteger(value) && value !== undefined && value >= 0
    ? value
    : 0;
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

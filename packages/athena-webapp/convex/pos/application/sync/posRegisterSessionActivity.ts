import type { Doc, Id } from "../../../_generated/dataModel";
import { internal } from "../../../_generated/api";
import { internalMutation, type MutationCtx } from "../../../_generated/server";
import { v } from "convex/values";
import {
  ok,
  userError,
  type CommandResult,
} from "../../../../shared/commandResult";
import type {
  POS_REGISTER_SESSION_ACTIVITY_CATEGORIES,
  POS_REGISTER_SESSION_ACTIVITY_SKIP_CODES,
  POS_REGISTER_SESSION_ACTIVITY_STATUSES,
} from "../../../schemas/pos/posRegisterSessionActivity";
import type {
  LocalSyncConflictRecord,
  LocalSyncMappingRecord,
  PosLocalSyncEventStatus,
} from "./types";

export type RegisterSessionActivityCategory =
  (typeof POS_REGISTER_SESSION_ACTIVITY_CATEGORIES)[number];
export type RegisterSessionActivityStatus =
  (typeof POS_REGISTER_SESSION_ACTIVITY_STATUSES)[number];
export type RegisterSessionActivitySkipCode =
  (typeof POS_REGISTER_SESSION_ACTIVITY_SKIP_CODES)[number];
type SafeMetadataValue = string | number | boolean;
type SafeMetadata = Record<string, SafeMetadataValue>;
type PosLocalSyncEventOutcome = {
  localEventId: string;
  sequence: number;
  status: PosLocalSyncEventStatus;
};

type ActivityAckStatus = "terminal_reported" | "mapping_pending";

type TerminalBindingRecord = {
  _id: Id<"posTerminal">;
  storeId: Id<"store">;
  registerNumber?: string;
  status: string;
};

type RegisterSessionBindingRecord = {
  _id: Id<"registerSession">;
  storeId: Id<"store">;
  terminalId?: Id<"posTerminal">;
  registerNumber?: string;
};

type StaffProfileBindingRecord = {
  _id: Id<"staffProfile">;
  storeId: Id<"store">;
  status: string;
};

export type RegisterSessionActivityInput = {
  localEventId: string;
  sequence: number;
  uploadSequence?: number;
  occurredAt: number;
  staffProfileId?: Id<"staffProfile">;
  eventType: string;
  category: RegisterSessionActivityCategory;
  localExpenseSessionId?: string;
  registerNumber?: string;
  metadata?: Record<string, unknown>;
};

export type RegisterSessionActivityReportInput = {
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
  localRegisterSessionId: string;
  registerNumber?: string;
  reportedThroughSequence: number;
  reportedThroughOccurredAt?: number;
  submittedAt: number;
  activities: RegisterSessionActivityInput[];
};

export type RegisterSessionActivityRecord = Doc<"posRegisterSessionActivity">;

export type RegisterSessionActivityCheckpointRecord =
  Doc<"posRegisterSessionActivityCheckpoint">;

type RegisterSessionActivityRecordInput = Omit<
  RegisterSessionActivityRecord,
  "_creationTime" | "_id"
>;
type RegisterSessionActivityCheckpointInput = Omit<
  RegisterSessionActivityCheckpointRecord,
  "_creationTime" | "_id"
>;

export type RegisterSessionActivityIngestionRepository = {
  normalizeRegisterSessionId(value: string): Id<"registerSession"> | null;
  getTerminal(
    terminalId: Id<"posTerminal">,
  ): Promise<TerminalBindingRecord | null>;
  getRegisterSession(
    registerSessionId: Id<"registerSession">,
  ): Promise<RegisterSessionBindingRecord | null>;
  getStaffProfile(
    staffProfileId: Id<"staffProfile">,
  ): Promise<StaffProfileBindingRecord | null>;
  findRegisterSessionMapping(args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    localRegisterSessionId: string;
  }): Promise<{ registerSessionId: Id<"registerSession"> } | null>;
  findActivityByLocalEvent(args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    localEventId: string;
  }): Promise<RegisterSessionActivityRecord | null>;
  createActivity(
    input: RegisterSessionActivityRecordInput,
  ): Promise<RegisterSessionActivityRecord>;
  patchActivity(
    activityId: Id<"posRegisterSessionActivity">,
    patch: Partial<RegisterSessionActivityRecordInput>,
  ): Promise<void>;
  listMappingPendingActivity(args: {
    limit: number;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    localRegisterSessionId: string;
  }): Promise<RegisterSessionActivityRecord[]>;
  findSyncEventByLocalEvent(args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    localEventId: string;
  }): Promise<{ _id: Id<"posLocalSyncEvent">; status: string } | null>;
  findCheckpoint(args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    localRegisterSessionId: string;
  }): Promise<RegisterSessionActivityCheckpointRecord | null>;
  createCheckpoint(
    input: RegisterSessionActivityCheckpointInput,
  ): Promise<RegisterSessionActivityCheckpointRecord>;
  patchCheckpoint(
    checkpointId: Id<"posRegisterSessionActivityCheckpoint">,
    patch: Partial<RegisterSessionActivityCheckpointInput>,
  ): Promise<void>;
};

export type RegisterSessionActivityIngestionResult = {
  accepted: Array<{
    localEventId: string;
    sequence: number;
    status: ActivityAckStatus;
  }>;
  skipped: Array<{
    localEventId?: string;
    sequence?: number;
    code: RegisterSessionActivitySkipCode;
  }>;
  checkpoint: {
    localRegisterSessionId: string;
    reportedThroughSequence: number;
    lastActivityReportedAt?: number;
    skippedCounts: Record<string, number>;
  };
};

type Dependencies = {
  repository: RegisterSessionActivityIngestionRepository;
  now: () => number;
  scheduleMappingPendingContinuation?: (args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    localRegisterSessionId: string;
  }) => Promise<unknown>;
};

const TERMINAL_AUTHORIZATION_MESSAGE =
  "You do not have access to sync this POS terminal.";
const TERMINAL_SESSION_BINDING_MESSAGE =
  "POS activity report is not bound to this terminal session.";
const MAX_METADATA_STRING_LENGTH = 120;
const MAPPING_PENDING_RECONCILIATION_BATCH_SIZE = 100;
const continueMappingPendingRef: any = (internal as any).pos.application.sync
  .posRegisterSessionActivity.continueRegisterSessionActivityMappingPending;

const ALLOWED_METADATA_KEYS_BY_CATEGORY = {
  register: new Set(["expectedCash", "openingFloat", "registerNumber"]),
  session: new Set(["localPosSessionId", "registerNumber"]),
  cart: new Set([
    "itemCount",
    "itemLabel",
    "productSku",
    "quantity",
    "serviceCount",
    "totalAmount",
    "unitPrice",
  ]),
  payment: new Set([
    "amount",
    "paymentCount",
    "paymentMethod",
    "paymentMethodLabel",
    "previousAmount",
    "stage",
    "totalAmount",
    "totalPaid",
  ]),
  service: new Set([
    "itemLabel",
    "quantity",
    "serviceCount",
    "serviceLineCount",
    "serviceMode",
    "total",
    "totalAmount",
    "unitPrice",
  ]),
  cash: new Set([
    "amount",
    "cashDirection",
    "cashMovementType",
    "direction",
    "registerNumber",
  ]),
  expense: new Set([
    "itemCount",
    "itemLabel",
    "localExpenseEventId",
    "localExpenseSessionId",
    "productSku",
    "quantity",
    "subtotal",
    "subtotalAmount",
    "tax",
    "taxAmount",
    "total",
    "totalAmount",
    "unitPrice",
  ]),
  sale: new Set([
    "itemCount",
    "localReceiptNumber",
    "localPosSessionId",
    "localTransactionId",
    "paymentCount",
    "receiptNumber",
    "serviceCount",
    "serviceLineCount",
    "subtotal",
    "subtotalAmount",
    "tax",
    "taxAmount",
    "total",
    "totalAmount",
  ]),
  closeout: new Set(["countedCash", "expectedCash", "variance"]),
  reopen: new Set(["reasonCode", "statusCode"]),
  sync: new Set(["reasonCode", "statusCode"]),
  review: new Set(["reasonCode", "statusCode"]),
} satisfies Record<RegisterSessionActivityCategory, Set<string>>;

const DISALLOWED_METADATA_KEY_PARTS = [
  "contact",
  "customeremail",
  "customerphone",
  "email",
  "note",
  "password",
  "payload",
  "phone",
  "pin",
  "proof",
  "raw",
  "secret",
  "token",
];

export function createRegisterSessionActivityIngestionService(
  dependencies: Dependencies,
) {
  return {
    async ingestReport(
      report: RegisterSessionActivityReportInput,
    ): Promise<CommandResult<RegisterSessionActivityIngestionResult>> {
      const terminal = await dependencies.repository.getTerminal(
        report.terminalId,
      );
      if (
        !terminal ||
        terminal.storeId !== report.storeId ||
        terminal.status !== "active"
      ) {
        return userError({
          code: "authorization_failed",
          message: TERMINAL_AUTHORIZATION_MESSAGE,
        });
      }

      if (!isRegisterNumberBound(terminal, report.registerNumber)) {
        return userError({
          code: "validation_failed",
          message: TERMINAL_SESSION_BINDING_MESSAGE,
        });
      }

      const resolvedSession = await resolveRegisterSessionBinding(
        dependencies.repository,
        report,
        terminal,
      );
      if (resolvedSession.kind === "error") return resolvedSession.result;

      if (
        resolvedSession.registerSessionId &&
        resolvedSession.bindingSource === "direct_id"
      ) {
        const reconciliation = await bindMappingPendingActivity({
          repository: dependencies.repository,
          registerSessionId: resolvedSession.registerSessionId,
          storeId: report.storeId,
          terminalId: report.terminalId,
          localRegisterSessionId: report.localRegisterSessionId,
          now: dependencies.now,
        });
        if (reconciliation.hasMore) {
          await dependencies.scheduleMappingPendingContinuation?.({
            storeId: report.storeId,
            terminalId: report.terminalId,
            localRegisterSessionId: report.localRegisterSessionId,
          });
        }
      }

      const now = dependencies.now();
      const accepted: RegisterSessionActivityIngestionResult["accepted"] = [];
      const skipped: RegisterSessionActivityIngestionResult["skipped"] = [];
      const skippedCounts: Record<string, number> = {};
      const reportedAt = report.submittedAt;
      const status: ActivityAckStatus = resolvedSession.registerSessionId
        ? "terminal_reported"
        : "mapping_pending";

      for (const activity of report.activities) {
        if (!isRegisterNumberBound(terminal, activity.registerNumber)) {
          incrementSkipped(skippedCounts, "invalid_scope");
          skipped.push({
            localEventId: activity.localEventId,
            sequence: activity.sequence,
            code: "invalid_scope",
          });
          continue;
        }

        const metadataResult = sanitizeMetadata(
          activity.category,
          activity.metadata ?? {},
        );
        if (!metadataResult.ok) {
          incrementSkipped(skippedCounts, metadataResult.code);
          skipped.push({
            localEventId: activity.localEventId,
            sequence: activity.sequence,
            code: metadataResult.code,
          });
          continue;
        }

        const existing = await dependencies.repository.findActivityByLocalEvent(
          {
            storeId: report.storeId,
            terminalId: report.terminalId,
            localEventId: activity.localEventId,
          },
        );
        const staffProfileId = await resolveActivityStaffProfileId(
          dependencies.repository,
          report.storeId,
          activity.staffProfileId,
        );
        const recordPatch = {
          registerSessionId: resolvedSession.registerSessionId,
          registerNumber:
            activity.registerNumber ??
            report.registerNumber ??
            terminal.registerNumber,
          localExpenseSessionId: activity.localExpenseSessionId,
          localRegisterSessionId: report.localRegisterSessionId,
          localSequence: activity.sequence,
          uploadSequence: activity.uploadSequence,
          occurredAt: activity.occurredAt,
          reportedAt,
          receivedAt: now,
          staffProfileId,
          category: activity.category,
          eventType: activity.eventType,
          status,
          metadata: metadataResult.metadata,
          updatedAt: now,
        };

        if (existing) {
          await dependencies.repository.patchActivity(existing._id, recordPatch);
        } else {
          await dependencies.repository.createActivity({
            ...recordPatch,
            storeId: report.storeId,
            terminalId: report.terminalId,
            activityKey: buildLocalActivityKey(report, activity),
            localEventId: activity.localEventId,
          });
        }

        accepted.push({
          localEventId: activity.localEventId,
          sequence: activity.sequence,
          status,
        });
      }

        const checkpoint = await upsertCheckpoint(dependencies.repository, {
        report,
        registerNumber: report.registerNumber ?? terminal.registerNumber,
        registerSessionId: resolvedSession.registerSessionId,
        skipped,
        skippedCounts,
        acceptedActivityCount: accepted.length,
        now,
      });

      return ok({
        accepted,
        skipped,
        checkpoint: {
          localRegisterSessionId: checkpoint.localRegisterSessionId,
          reportedThroughSequence: checkpoint.reportedThroughSequence,
          lastActivityReportedAt: checkpoint.lastActivityReportedAt,
          skippedCounts: checkpoint.skippedCounts,
        },
      });
    },

    async resolveMappingPending(args: {
      storeId: Id<"store">;
      terminalId: Id<"posTerminal">;
      localRegisterSessionId: string;
    }): Promise<{ hasMore: boolean; resolved: number }> {
      const mapping = await dependencies.repository.findRegisterSessionMapping(
        args,
      );
      const registerSessionId =
        mapping?.registerSessionId ??
        dependencies.repository.normalizeRegisterSessionId(
          args.localRegisterSessionId,
        );
      if (!registerSessionId) return { hasMore: false, resolved: 0 };

      const registerSession = await dependencies.repository.getRegisterSession(
        registerSessionId,
      );
      if (
        !registerSession ||
        registerSession.storeId !== args.storeId ||
        (registerSession.terminalId !== undefined &&
          registerSession.terminalId !== args.terminalId)
      ) {
        return { hasMore: false, resolved: 0 };
      }

      const result = await bindMappingPendingActivity({
        repository: dependencies.repository,
        registerSessionId,
        ...args,
        now: dependencies.now,
      });
      if (result.hasMore) {
        await dependencies.scheduleMappingPendingContinuation?.(args);
      }
      return result;
    },
  };
}

export async function ingestRegisterSessionActivityWithCtx(
  ctx: MutationCtx,
  report: RegisterSessionActivityReportInput,
): Promise<CommandResult<RegisterSessionActivityIngestionResult>> {
  return createRegisterSessionActivityIngestionService({
    repository: createConvexRegisterSessionActivityRepository(ctx),
    now: () => Date.now(),
    scheduleMappingPendingContinuation: async (args): Promise<void> => {
      await ctx.scheduler.runAfter(0, continueMappingPendingRef, args);
    },
  }).ingestReport(report);
}

export async function resolveRegisterSessionActivityMappingPendingWithCtx(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    localRegisterSessionId: string;
  },
): Promise<{ hasMore: boolean; resolved: number }> {
  return createRegisterSessionActivityIngestionService({
    repository: createConvexRegisterSessionActivityRepository(ctx),
    now: () => Date.now(),
    scheduleMappingPendingContinuation: async (
      continuationArgs,
    ): Promise<void> => {
      await ctx.scheduler.runAfter(
        0,
        continueMappingPendingRef,
        continuationArgs,
      );
    },
  }).resolveMappingPending(args);
}

export const continueRegisterSessionActivityMappingPending = internalMutation({
  args: {
    localRegisterSessionId: v.string(),
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await resolveRegisterSessionActivityMappingPendingWithCtx(ctx, args);
    return null;
  },
});

export async function patchRegisterSessionActivityFromLocalSyncWithCtx(
  ctx: MutationCtx,
  args: {
    accepted: PosLocalSyncEventOutcome[];
    conflicts: LocalSyncConflictRecord[];
    held: Array<{
      localEventId: string;
      sequence: number;
    }>;
    mappings: LocalSyncMappingRecord[];
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
) {
  const registerMappings = args.mappings.filter(
    (mapping) =>
      mapping.localIdKind === "registerSession" &&
      mapping.cloudTable === "registerSession",
  );
  for (const mapping of registerMappings) {
    await resolveRegisterSessionActivityMappingPendingWithCtx(ctx, {
      storeId: args.storeId,
      terminalId: args.terminalId,
      localRegisterSessionId: mapping.localRegisterSessionId,
    });
  }

  const repository = createConvexRegisterSessionActivityRepository(ctx);
  const registerSessionIdByLocalSession = new Map(
    registerMappings.map((mapping) => [
      mapping.localRegisterSessionId,
      mapping.cloudId as Id<"registerSession">,
    ]),
  );
  const mappingsByEvent = groupMappingsByLocalEvent(args.mappings);
  const conflictsByEvent = new Map(
    args.conflicts.map((conflict) => [conflict.localEventId, conflict]),
  );

  const outcomes = [
    ...args.accepted,
    ...args.held.map((held) => ({ ...held, status: "held" as const })),
  ];

  for (const accepted of outcomes) {
    const activity = await repository.findActivityByLocalEvent({
      storeId: args.storeId,
      terminalId: args.terminalId,
      localEventId: accepted.localEventId,
    });
    if (!activity) continue;

    const eventMappings = mappingsByEvent.get(accepted.localEventId) ?? [];
    const conflict = conflictsByEvent.get(accepted.localEventId);
    const syncEvent = await repository.findSyncEventByLocalEvent({
      storeId: args.storeId,
      terminalId: args.terminalId,
      localEventId: accepted.localEventId,
    });
    const now = Date.now();
    await repository.patchActivity(activity._id, {
      registerSessionId:
        activity.registerSessionId ??
        registerSessionIdByLocalSession.get(activity.localRegisterSessionId),
      relatedConflictId: conflict?._id as
        | Id<"posLocalSyncConflict">
        | undefined,
      relatedSyncEventId: syncEvent?._id,
      relatedTransactionId: findMappedCloudId(
        eventMappings,
        "transaction",
        "posTransaction",
      ) as Id<"posTransaction"> | undefined,
      relatedCloseoutRecordId: findMappedCloudId(
        eventMappings,
        "closeout",
        "registerSession",
      ),
      status: toActivityStatusFromSyncStatus(accepted.status),
      updatedAt: now,
      ...(accepted.status === "accepted" ? { acceptedAt: now } : {}),
      ...(accepted.status === "projected" ? { projectedAt: now } : {}),
    });
  }
}

function groupMappingsByLocalEvent(mappings: LocalSyncMappingRecord[]) {
  const grouped = new Map<string, LocalSyncMappingRecord[]>();
  for (const mapping of mappings) {
    grouped.set(mapping.localEventId, [
      ...(grouped.get(mapping.localEventId) ?? []),
      mapping,
    ]);
  }
  return grouped;
}

function findMappedCloudId(
  mappings: LocalSyncMappingRecord[],
  localIdKind: string,
  cloudTable: string,
) {
  return mappings.find(
    (mapping) =>
      mapping.localIdKind === localIdKind && mapping.cloudTable === cloudTable,
  )?.cloudId;
}

function toActivityStatusFromSyncStatus(
  status?: string,
): RegisterSessionActivityStatus {
  switch (status) {
    case "accepted":
    case "projected":
    case "held":
    case "conflicted":
    case "rejected":
      return status;
    default:
      return "terminal_reported";
  }
}

function buildLocalActivityKey(
  report: Pick<RegisterSessionActivityReportInput, "storeId" | "terminalId">,
  activity: Pick<RegisterSessionActivityInput, "localEventId">,
) {
  return `local:${report.storeId}:${report.terminalId}:${activity.localEventId}`;
}

function isRegisterNumberBound(
  terminal: TerminalBindingRecord,
  registerNumber?: string,
) {
  return (
    registerNumber === undefined ||
    terminal.registerNumber === undefined ||
    terminal.registerNumber === registerNumber
  );
}

async function resolveRegisterSessionBinding(
  repository: RegisterSessionActivityIngestionRepository,
  report: RegisterSessionActivityReportInput,
  terminal: TerminalBindingRecord,
): Promise<
  | {
      bindingSource?: "direct_id" | "mapping";
      kind: "ok";
      registerSessionId?: Id<"registerSession">;
    }
  | { kind: "error"; result: CommandResult<RegisterSessionActivityIngestionResult> }
> {
  const mapping = await repository.findRegisterSessionMapping({
    storeId: report.storeId,
    terminalId: report.terminalId,
    localRegisterSessionId: report.localRegisterSessionId,
  });
  const directRegisterSessionId = repository.normalizeRegisterSessionId(
    report.localRegisterSessionId,
  );
  const registerSessionId = mapping?.registerSessionId ?? directRegisterSessionId;
  if (!registerSessionId) return { kind: "ok" };

  const registerSession = await repository.getRegisterSession(
    registerSessionId,
  );
  if (
    !registerSession ||
    registerSession.storeId !== report.storeId ||
    (registerSession.terminalId !== undefined &&
      registerSession.terminalId !== report.terminalId) ||
    !isRegisterSessionNumberBound(registerSession, report.registerNumber) ||
    !isRegisterNumberBound(terminal, registerSession.registerNumber)
  ) {
    return {
      kind: "error",
      result: userError({
        code: "validation_failed",
        message: TERMINAL_SESSION_BINDING_MESSAGE,
      }),
    };
  }

  return {
    bindingSource: mapping ? "mapping" : "direct_id",
    kind: "ok",
    registerSessionId,
  };
}

async function bindMappingPendingActivity(args: {
  repository: RegisterSessionActivityIngestionRepository;
  registerSessionId: Id<"registerSession">;
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
  localRegisterSessionId: string;
  now: () => number;
}) {
  const pending = await args.repository.listMappingPendingActivity({
    ...args,
    limit: MAPPING_PENDING_RECONCILIATION_BATCH_SIZE + 1,
  });
  const batch = pending.slice(0, MAPPING_PENDING_RECONCILIATION_BATCH_SIZE);
  for (const activity of batch) {
      const syncEvent = await args.repository.findSyncEventByLocalEvent({
        storeId: activity.storeId,
        terminalId: activity.terminalId,
        localEventId: activity.localEventId,
      });
      await args.repository.patchActivity(activity._id, {
        registerSessionId: args.registerSessionId,
        relatedSyncEventId: syncEvent?._id,
        status: toActivityStatusFromSyncStatus(syncEvent?.status),
        updatedAt: args.now(),
      });
  }
  const hasMore =
    pending.length > MAPPING_PENDING_RECONCILIATION_BATCH_SIZE;

  const checkpoint = await args.repository.findCheckpoint(args);
  if (checkpoint) {
    await args.repository.patchCheckpoint(checkpoint._id, {
      mappingReconciliationPending: hasMore,
      registerSessionId: args.registerSessionId,
      updatedAt: args.now(),
    });
  }

  return { hasMore, resolved: batch.length };
}

async function resolveActivityStaffProfileId(
  repository: RegisterSessionActivityIngestionRepository,
  storeId: Id<"store">,
  staffProfileId?: Id<"staffProfile">,
) {
  if (!staffProfileId) return undefined;

  const staffProfile = await repository.getStaffProfile(staffProfileId);
  return staffProfile?.storeId === storeId && staffProfile.status === "active"
    ? staffProfileId
    : undefined;
}

function isRegisterSessionNumberBound(
  registerSession: RegisterSessionBindingRecord,
  registerNumber?: string,
) {
  return (
    registerNumber === undefined ||
    registerSession.registerNumber === undefined ||
    registerSession.registerNumber === registerNumber
  );
}

function sanitizeMetadata(
  category: RegisterSessionActivityCategory,
  metadata: Record<string, unknown>,
):
  | { ok: true; metadata: SafeMetadata }
  | { ok: false; code: RegisterSessionActivitySkipCode } {
  const allowedKeys = ALLOWED_METADATA_KEYS_BY_CATEGORY[category];
  const nextMetadata: SafeMetadata = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (hasDisallowedMetadataKey(key) || !allowedKeys.has(key)) {
      return { ok: false, code: "disallowed_metadata" };
    }
    const safeValue = sanitizeMetadataValue(value);
    if (safeValue === undefined) {
      return { ok: false, code: "invalid_metadata" };
    }

    nextMetadata[key] = safeValue;
  }

  return { ok: true, metadata: nextMetadata };
}

function hasDisallowedMetadataKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return DISALLOWED_METADATA_KEY_PARTS.some((part) =>
    normalized.includes(part),
  );
}

function sanitizeMetadataValue(value: unknown): SafeMetadataValue | undefined {
  if (typeof value === "string") {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) return undefined;
    if (hasUnsafeMetadataString(normalized)) return undefined;
    return normalized.slice(0, MAX_METADATA_STRING_LENGTH);
  }
  if (typeof value === "boolean") return true;
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function hasUnsafeMetadataString(value: string) {
  const normalized = value.toLowerCase();
  return (
    /^[{[]/.test(value) ||
    /["']\s*:/.test(value) ||
    /[^\s@]+@[^\s@]+\.[^\s@]+/.test(value) ||
    /\b(password|pin|proof|secret|token)\b/.test(normalized) ||
    /\b(customer\s*(email|phone|contact)|phone|email)\b/.test(normalized)
  );
}

function incrementSkipped(
  counts: Record<string, number>,
  code: RegisterSessionActivitySkipCode,
) {
  counts[code] = (counts[code] ?? 0) + 1;
}

async function upsertCheckpoint(
  repository: RegisterSessionActivityIngestionRepository,
  args: {
    report: RegisterSessionActivityReportInput;
    registerNumber?: string;
    registerSessionId?: Id<"registerSession">;
    skipped: RegisterSessionActivityIngestionResult["skipped"];
    skippedCounts: Record<string, number>;
    acceptedActivityCount: number;
    now: number;
  },
) {
  const existing = await repository.findCheckpoint({
    storeId: args.report.storeId,
    terminalId: args.report.terminalId,
    localRegisterSessionId: args.report.localRegisterSessionId,
  });
  const skippedLocalEventIds = [...(existing?.skippedLocalEventIds ?? [])];
  const skippedLocalEventIdSet = new Set(skippedLocalEventIds);
  const skippedCounts = { ...(existing?.skippedCounts ?? {}) };
  for (const skipped of args.skipped) {
    if (skipped.localEventId) {
      if (skippedLocalEventIdSet.has(skipped.localEventId)) continue;
      skippedLocalEventIdSet.add(skipped.localEventId);
      skippedLocalEventIds.push(skipped.localEventId);
    }
    skippedCounts[skipped.code] = (skippedCounts[skipped.code] ?? 0) + 1;
  }
  const lastSkipCode = Object.keys(args.skippedCounts)[0] as
    | RegisterSessionActivitySkipCode
    | undefined;
  const checkpointPatch = {
    registerSessionId: args.registerSessionId,
    registerNumber: args.registerNumber,
    reportedThroughSequence: Math.max(
      existing?.reportedThroughSequence ?? 0,
      args.report.reportedThroughSequence,
    ),
    reportedThroughOccurredAt:
      args.report.reportedThroughOccurredAt ??
      existing?.reportedThroughOccurredAt,
    lastActivityReportedAt:
      args.acceptedActivityCount > 0
        ? args.report.submittedAt
        : existing?.lastActivityReportedAt,
    lastAcceptedBatchAt: args.now,
    skippedCounts,
    skippedLocalEventIds,
    lastSkipCode,
    updatedAt: args.now,
  };

  if (existing) {
    await repository.patchCheckpoint(existing._id, checkpointPatch);
    return { ...existing, ...checkpointPatch };
  }

  return repository.createCheckpoint({
    ...checkpointPatch,
    storeId: args.report.storeId,
    terminalId: args.report.terminalId,
    localRegisterSessionId: args.report.localRegisterSessionId,
  });
}

function createConvexRegisterSessionActivityRepository(
  ctx: MutationCtx,
): RegisterSessionActivityIngestionRepository {
  return {
    normalizeRegisterSessionId(value) {
      return ctx.db.normalizeId("registerSession", value);
    },
    async getTerminal(terminalId) {
      return (await ctx.db.get("posTerminal", terminalId)) as TerminalBindingRecord | null;
    },
    async getRegisterSession(registerSessionId) {
      return (await ctx.db.get(
        "registerSession",
        registerSessionId,
      )) as RegisterSessionBindingRecord | null;
    },
    async getStaffProfile(staffProfileId) {
      return (await ctx.db.get(
        "staffProfile",
        staffProfileId,
      )) as StaffProfileBindingRecord | null;
    },
    async findRegisterSessionMapping(args) {
      const mapping = await ctx.db
        .query("posLocalSyncMapping")
        .withIndex("by_store_terminal_local", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("terminalId", args.terminalId)
            .eq("localRegisterSessionId", args.localRegisterSessionId)
            .eq("localIdKind", "registerSession")
            .eq("localId", args.localRegisterSessionId),
        )
        .first();
      return mapping?.cloudTable === "registerSession"
        ? { registerSessionId: mapping.cloudId as Id<"registerSession"> }
        : null;
    },
    async findActivityByLocalEvent(args) {
      return await ctx.db
        .query("posRegisterSessionActivity")
        .withIndex("by_store_terminal_localEvent", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("terminalId", args.terminalId)
            .eq("localEventId", args.localEventId),
        )
        .unique();
    },
    async createActivity(input) {
      const id = await ctx.db.insert("posRegisterSessionActivity", input);
      const activity = await ctx.db.get("posRegisterSessionActivity", id);
      if (!activity) throw new Error("Created POS activity row was not found.");
      return activity;
    },
    async patchActivity(activityId, patch) {
      await ctx.db.patch("posRegisterSessionActivity", activityId, patch);
    },
    async listMappingPendingActivity(args) {
      return await ctx.db
        .query("posRegisterSessionActivity")
        .withIndex("by_store_terminal_register_status", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("terminalId", args.terminalId)
            .eq("localRegisterSessionId", args.localRegisterSessionId)
            .eq("status", "mapping_pending"),
        )
        .take(args.limit);
    },
    async findSyncEventByLocalEvent(args) {
      return await ctx.db
        .query("posLocalSyncEvent")
        .withIndex("by_store_terminal_localEvent", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("terminalId", args.terminalId)
            .eq("localEventId", args.localEventId),
        )
        .unique();
    },
    async findCheckpoint(args) {
      return await ctx.db
        .query("posRegisterSessionActivityCheckpoint")
        .withIndex("by_store_terminal_register", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("terminalId", args.terminalId)
            .eq("localRegisterSessionId", args.localRegisterSessionId),
        )
        .unique();
    },
    async createCheckpoint(input) {
      const id = await ctx.db.insert(
        "posRegisterSessionActivityCheckpoint",
        input,
      );
      const checkpoint = await ctx.db.get(
        "posRegisterSessionActivityCheckpoint",
        id,
      );
      if (!checkpoint) {
        throw new Error("Created POS activity checkpoint was not found.");
      }
      return checkpoint;
    },
    async patchCheckpoint(checkpointId, patch) {
      await ctx.db.patch(
        "posRegisterSessionActivityCheckpoint",
        checkpointId,
        patch,
      );
    },
  };
}

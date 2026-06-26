import type { Doc, Id } from "../../../_generated/dataModel";
import {
  canReuseCloudRegisterSessionForLocalOpen as canReuseCloudRegisterSessionForLocalOpenPolicy,
  canSupersedeReviewedRegisterSessionForLocalOpen as canSupersedeReviewedRegisterSessionForLocalOpenPolicy,
  isRegisterCloseoutReviewConflict,
} from "../../../../shared/registerSessionLifecyclePolicy";
import type {
  LocalSyncRegisterReviewConflictFact,
  ParsedPosLocalSyncEventInput,
  SyncProjectionRepository,
} from "../sync/types";

const STALE_DUPLICATE_REGISTER_OPEN_MS = 5 * 60 * 1000;
const BUSINESS_FACT_KEYS = [
  "sale",
  "sales",
  "transaction",
  "payment",
  "payments",
  "inventory",
  "movement",
  "stock",
  "closeout",
  "close",
  "variance",
  "cashVariance",
  "closeoutVariance",
  "customer",
  "customerInfo",
] as const;

export type SafeTerminalCloudRepairConflict = {
  conflictId: Id<"posLocalSyncConflict">;
  kind: "safe_duplicate_register_opened";
  localEventId: string;
  localRegisterSessionId: string;
  sequence: number;
};

export type SkippedTerminalCloudRepairConflict = {
  conflictId: Id<"posLocalSyncConflict">;
  kind: "skipped";
  reason:
    | "contains_business_facts"
    | "missing_source_event"
    | "not_duplicate_register_opened"
    | "not_needs_review"
    | "not_projection_safe"
    | "not_register_opened"
    | "not_stale"
    | "store_or_terminal_mismatch";
};

export type TerminalCloudRepairConflictClassification =
  | SafeTerminalCloudRepairConflict
  | SkippedTerminalCloudRepairConflict;

export function classifyTerminalCloudRepairConflict(args: {
  conflict: Doc<"posLocalSyncConflict">;
  now: number;
  sourceEvent: Doc<"posLocalSyncEvent"> | null;
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
}): TerminalCloudRepairConflictClassification {
  const { conflict, sourceEvent } = args;
  if (conflict.storeId !== args.storeId || conflict.terminalId !== args.terminalId) {
    return skipped(conflict, "store_or_terminal_mismatch");
  }
  if (conflict.status !== "needs_review") {
    return skipped(conflict, "not_needs_review");
  }
  if (args.now - conflict.createdAt < STALE_DUPLICATE_REGISTER_OPEN_MS) {
    return skipped(conflict, "not_stale");
  }
  if (!isDuplicateRegisterOpenConflict(conflict)) {
    return skipped(conflict, "not_duplicate_register_opened");
  }
  if (containsBusinessFacts(conflict.details)) {
    return skipped(conflict, "contains_business_facts");
  }
  if (!sourceEvent) {
    return skipped(conflict, "missing_source_event");
  }
  if (
    sourceEvent.storeId !== args.storeId ||
    sourceEvent.terminalId !== args.terminalId ||
    sourceEvent.localEventId !== conflict.localEventId
  ) {
    return skipped(conflict, "store_or_terminal_mismatch");
  }
  if (sourceEvent.eventType !== "register_opened") {
    return skipped(conflict, "not_register_opened");
  }
  if (containsBusinessFacts(sourceEvent.payload)) {
    return skipped(conflict, "contains_business_facts");
  }

  return {
    conflictId: conflict._id,
    kind: "safe_duplicate_register_opened",
    localEventId: conflict.localEventId,
    localRegisterSessionId: conflict.localRegisterSessionId,
    sequence: conflict.sequence,
  };
}

export function buildTerminalCloudRepairPreview(args: {
  classified: TerminalCloudRepairConflictClassification[];
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
}) {
  const safeConflictIds = args.classified
    .filter((item): item is SafeTerminalCloudRepairConflict =>
      item.kind === "safe_duplicate_register_opened",
    )
    .map((item) => item.conflictId)
    .sort();

  return {
    preconditionHash: buildTerminalCloudRepairPreconditionHash({
      safeConflictIds,
      storeId: args.storeId,
      terminalId: args.terminalId,
    }),
    safeConflictIds,
    skipped: args.classified.filter(
      (item): item is SkippedTerminalCloudRepairConflict => item.kind === "skipped",
    ),
  };
}

export function skipTerminalCloudRepairConflict(
  conflict: SafeTerminalCloudRepairConflict,
  reason: SkippedTerminalCloudRepairConflict["reason"],
): SkippedTerminalCloudRepairConflict {
  return {
    conflictId: conflict.conflictId,
    kind: "skipped",
    reason,
  };
}

export function buildTerminalCloudRepairPreconditionHash(args: {
  safeConflictIds: Array<Id<"posLocalSyncConflict">>;
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
}) {
  return [
    "terminal-cloud-repair",
    args.storeId,
    args.terminalId,
    ...args.safeConflictIds,
  ].join(":");
}

export type TerminalCloudRepairProjectionEligibilityRepository = Pick<
  SyncProjectionRepository,
  | "findBlockingRegisterSession"
  | "getRegisterSession"
  | "getStaffProfile"
  | "getTerminal"
  | "hasActivePosRole"
  | "listOpenRegisterReviewConflictFacts"
  | "normalizeCloudId"
>;

export async function canProjectRegisterOpenForTerminalCloudRepair(
  repository: TerminalCloudRepairProjectionEligibilityRepository,
  args: {
    event: ParsedPosLocalSyncEventInput;
    now: number;
    storeId: Parameters<SyncProjectionRepository["getStore"]>[0];
    terminalId: Parameters<SyncProjectionRepository["getTerminal"]>[0];
  },
) {
  if (args.event.eventType !== "register_opened") return false;

  const terminal = await repository.getTerminal(args.terminalId);
  const staff = await repository.getStaffProfile(args.event.staffProfileId);
  const terminalRegisterNumber = normalizeRepairString(terminal?.registerNumber);
  const payloadRegisterNumber = normalizeRepairString(args.event.payload.registerNumber);
  if (
    !terminal ||
    terminal.storeId !== args.storeId ||
    terminal.status !== "active" ||
    !terminalRegisterNumber ||
    (payloadRegisterNumber && payloadRegisterNumber !== terminalRegisterNumber)
  ) {
    return false;
  }

  const hasActiveOpenRole = staff
    ? await repository.hasActivePosRole({
        staffProfileId: args.event.staffProfileId,
        storeId: args.storeId,
        allowedRoles: ["cashier", "manager"],
      })
    : false;
  if (
    !staff ||
    staff.storeId !== args.storeId ||
    staff.status !== "active" ||
    !hasActiveOpenRole
  ) {
    return false;
  }

  const directRegisterSessionId = repository.normalizeCloudId(
    "registerSession",
    args.event.localRegisterSessionId,
  );
  if (directRegisterSessionId) {
    const registerSession = await repository.getRegisterSession(directRegisterSessionId);
    return canReuseCloudRegisterSessionForLocalOpenPolicy({
      hasOpenRegisterCloseoutReview: false,
      localRegisterSessionId: args.event.localRegisterSessionId,
      registerSession: registerSession
        ? {
            ...registerSession,
            cloudRegisterSessionId: registerSession._id,
          }
        : registerSession,
      storeId: args.storeId,
      terminalId: args.terminalId,
    });
  }

  const blockingRegisterSession = await repository.findBlockingRegisterSession({
    storeId: args.storeId,
    terminalId: args.terminalId,
    registerNumber: terminalRegisterNumber,
  });
  if (!blockingRegisterSession) return true;

  const reviewState = await getRepairOpenRegisterCloseoutReviewState(repository, {
    registerSessionId: blockingRegisterSession._id,
    storeId: args.storeId,
    terminalId: args.terminalId,
  });

  return canSupersedeReviewedRegisterSessionForLocalOpenPolicy({
    hasOpenRegisterCloseoutReview: reviewState.hasOpenRegisterCloseoutReview,
    replacementLocalRegisterSessionId: args.event.localRegisterSessionId,
    replacementSequence: args.event.sequence,
    registerSession: blockingRegisterSession,
    reviewSequence: reviewState.latestReviewSequence ?? null,
    storeId: args.storeId,
    terminalId: args.terminalId,
  });
}

async function getRepairOpenRegisterCloseoutReviewState(
  repository: TerminalCloudRepairProjectionEligibilityRepository,
  args: {
    registerSessionId: Parameters<
      SyncProjectionRepository["listOpenRegisterReviewConflictFacts"]
    >[0]["registerSessionId"];
    storeId: Parameters<SyncProjectionRepository["getStore"]>[0];
    terminalId: Parameters<SyncProjectionRepository["getTerminal"]>[0];
  },
) {
  const conflicts = (await repository.listOpenRegisterReviewConflictFacts(args))
    .filter((fact) =>
      repairFactMatchesRegisterSessionCloseoutReview(fact, args.registerSessionId),
    )
    .map((fact) => fact.conflict);

  return {
    hasOpenRegisterCloseoutReview: conflicts.length > 0,
    latestReviewSequence: conflicts.reduce<number | undefined>(
      (latest, conflict) =>
        latest === undefined ? conflict.sequence : Math.max(latest, conflict.sequence),
      undefined,
    ),
  };
}

function repairFactMatchesRegisterSessionCloseoutReview(
  fact: LocalSyncRegisterReviewConflictFact,
  registerSessionId: Parameters<
    SyncProjectionRepository["listOpenRegisterReviewConflictFacts"]
  >[0]["registerSessionId"],
) {
  if (!isRegisterCloseoutReviewConflict(fact.conflict)) return false;
  if (
    fact.registerSessionMapping?.cloudTable === "registerSession" &&
    fact.registerSessionMapping.cloudId === registerSessionId
  ) {
    return true;
  }

  return fact.directRegisterSession?._id === registerSessionId;
}

function skipped(
  conflict: Doc<"posLocalSyncConflict">,
  reason: SkippedTerminalCloudRepairConflict["reason"],
): SkippedTerminalCloudRepairConflict {
  return {
    conflictId: conflict._id,
    kind: "skipped",
    reason,
  };
}

function isDuplicateRegisterOpenConflict(conflict: Doc<"posLocalSyncConflict">) {
  if (
    conflict.conflictType !== "duplicate_local_id" &&
    conflict.conflictType !== "permission"
  ) {
    return false;
  }

  const evidence = `${conflict.summary} ${JSON.stringify(conflict.details)}`.toLowerCase();
  return (
    evidence.includes("duplicate") &&
    (evidence.includes("register_opened") ||
      evidence.includes("register-open") ||
      evidence.includes("register open") ||
      evidence.includes("drawer-open") ||
      evidence.includes("drawer open") ||
      evidence.includes("already open"))
  );
}

function containsBusinessFacts(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some(containsBusinessFacts);
  }
  if (typeof value !== "object") {
    return false;
  }

  return Object.entries(value as Record<string, unknown>).some(([key, entry]) => {
    const normalizedKey = key.toLowerCase();
    return (
      BUSINESS_FACT_KEYS.some((businessKey) =>
        normalizedKey.includes(businessKey.toLowerCase()),
      ) || containsBusinessFacts(entry)
    );
  });
}

function normalizeRepairString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

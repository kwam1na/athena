import type { Doc, Id } from "../../../_generated/dataModel";

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

import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import {
  appendWorkflowTraceEventWithCtx,
  createWorkflowTraceWithCtx,
  registerWorkflowTraceLookupWithCtx,
} from "../../../workflowTraces/core";
import {
  buildPosSessionTraceSeed,
  type PosSessionTraceSeed,
} from "../../../workflowTraces/adapters/posSession";

export type PosSessionTraceStage =
  | "started"
  | "autoHeld"
  | "held"
  | "resumed"
  | "completed"
  | "voided"
  | "expired";

export type PosSessionTraceableSession = Pick<
  Doc<"posSession">,
  | "_id"
  | "sessionNumber"
  | "storeId"
  | "cashierId"
  | "customerId"
  | "terminalId"
  | "registerNumber"
  | "status"
  | "createdAt"
  | "updatedAt"
  | "heldAt"
  | "resumedAt"
  | "completedAt"
  | "holdReason"
  | "notes"
  | "transactionId"
  | "subtotal"
  | "tax"
  | "total"
  | "workflowTraceId"
>;

export interface PosSessionTraceRecorder {
  record(args: {
    stage: PosSessionTraceStage;
    session: PosSessionTraceableSession;
    occurredAt?: number;
    transactionId?: Id<"posTransaction">;
    holdReason?: string;
    voidReason?: string;
  }): Promise<{
    traceCreated: boolean;
    traceId: string;
  }>;
}

function buildTraceSummary(args: {
  stage: PosSessionTraceStage;
  traceSeed: PosSessionTraceSeed;
}) {
  const sessionNumber = args.traceSeed.trace.primaryLookupValue;

  switch (args.stage) {
    case "autoHeld":
    case "held":
      return `POS session ${sessionNumber} is currently held`;
    case "resumed":
      return `POS session ${sessionNumber} resumed and is active`;
    case "completed":
      return `POS session ${sessionNumber} completed`;
    case "voided":
      return `POS session ${sessionNumber} was voided`;
    case "expired":
      return `POS session ${sessionNumber} expired before completion`;
    case "started":
    default:
      return `Trace for POS session ${sessionNumber}`;
  }
}

function buildPosSessionTraceRecord(args: {
  stage: PosSessionTraceStage;
  traceSeed: PosSessionTraceSeed;
  occurredAt?: number;
  transactionId?: Id<"posTransaction">;
  holdReason?: string;
  voidReason?: string;
}) {
  if (args.stage === "started") {
    return args.traceSeed.trace;
  }

  const occurredAt = args.occurredAt ?? Date.now();
  const baseRecord = {
    ...args.traceSeed.trace,
    summary: buildTraceSummary(args),
    details: {
      lookupValue: args.traceSeed.lookup.lookupValue,
      sessionStage: args.stage,
      ...(args.holdReason ? { holdReason: args.holdReason } : {}),
      ...(args.voidReason ? { voidReason: args.voidReason } : {}),
      ...(args.transactionId ? { transactionId: args.transactionId } : {}),
    },
  };

  switch (args.stage) {
    case "completed":
      return {
        ...baseRecord,
        status: "succeeded" as const,
        completedAt: occurredAt,
      };
    case "voided":
      return {
        ...baseRecord,
        status: "info" as const,
        completedAt: occurredAt,
      };
    case "expired":
      return {
        ...baseRecord,
        status: "failed" as const,
        health: "partial" as const,
        completedAt: occurredAt,
      };
    case "autoHeld":
    case "held":
    case "resumed":
    default:
      return {
        ...baseRecord,
        status: "started" as const,
      };
  }
}

function buildPosSessionTraceEvent(args: {
  stage: PosSessionTraceStage;
  traceSeed: PosSessionTraceSeed;
  occurredAt?: number;
  transactionId?: Id<"posTransaction">;
  holdReason?: string;
  voidReason?: string;
}) {
  const occurredAt =
    args.occurredAt ??
    (args.stage === "started" ? args.traceSeed.trace.startedAt : Date.now());
  const sessionNumber = args.traceSeed.trace.primaryLookupValue;
  const details = {
    sessionStage: args.stage,
    ...(args.holdReason ? { holdReason: args.holdReason } : {}),
    ...(args.voidReason ? { voidReason: args.voidReason } : {}),
    ...(args.transactionId ? { transactionId: args.transactionId } : {}),
  };

  switch (args.stage) {
    case "autoHeld":
      return {
        storeId: args.traceSeed.trace.storeId,
        traceId: args.traceSeed.trace.traceId,
        workflowType: args.traceSeed.trace.workflowType,
        kind: "milestone" as const,
        step: "session_auto_held",
        status: "info" as const,
        message: `Session ${sessionNumber} was auto-held when a new session started`,
        occurredAt,
        source: args.traceSeed.eventSource,
        subjectRefs: args.traceSeed.subjectRefs,
        details,
      };
    case "held":
      return {
        storeId: args.traceSeed.trace.storeId,
        traceId: args.traceSeed.trace.traceId,
        workflowType: args.traceSeed.trace.workflowType,
        kind: "milestone" as const,
        step: "session_held",
        status: "info" as const,
        message: `Session ${sessionNumber} was held`,
        occurredAt,
        source: args.traceSeed.eventSource,
        subjectRefs: args.traceSeed.subjectRefs,
        details,
      };
    case "resumed":
      return {
        storeId: args.traceSeed.trace.storeId,
        traceId: args.traceSeed.trace.traceId,
        workflowType: args.traceSeed.trace.workflowType,
        kind: "milestone" as const,
        step: "session_resumed",
        status: "started" as const,
        message: `Session ${sessionNumber} was resumed`,
        occurredAt,
        source: args.traceSeed.eventSource,
        subjectRefs: args.traceSeed.subjectRefs,
        details,
      };
    case "completed":
      return {
        storeId: args.traceSeed.trace.storeId,
        traceId: args.traceSeed.trace.traceId,
        workflowType: args.traceSeed.trace.workflowType,
        kind: "milestone" as const,
        step: "session_completed",
        status: "succeeded" as const,
        message: `Session ${sessionNumber} completed`,
        occurredAt,
        source: args.traceSeed.eventSource,
        subjectRefs: args.traceSeed.subjectRefs,
        details,
      };
    case "voided":
      return {
        storeId: args.traceSeed.trace.storeId,
        traceId: args.traceSeed.trace.traceId,
        workflowType: args.traceSeed.trace.workflowType,
        kind: "milestone" as const,
        step: "session_voided",
        status: "info" as const,
        message: `Session ${sessionNumber} was voided`,
        occurredAt,
        source: args.traceSeed.eventSource,
        subjectRefs: args.traceSeed.subjectRefs,
        details,
      };
    case "expired":
      return {
        storeId: args.traceSeed.trace.storeId,
        traceId: args.traceSeed.trace.traceId,
        workflowType: args.traceSeed.trace.workflowType,
        kind: "milestone" as const,
        step: "session_expired",
        status: "failed" as const,
        message: `Session ${sessionNumber} expired and released inventory holds`,
        occurredAt,
        source: args.traceSeed.eventSource,
        subjectRefs: args.traceSeed.subjectRefs,
        details,
      };
    case "started":
    default:
      return {
        storeId: args.traceSeed.trace.storeId,
        traceId: args.traceSeed.trace.traceId,
        workflowType: args.traceSeed.trace.workflowType,
        kind: "milestone" as const,
        step: "session_started",
        status: "started" as const,
        message: `Session ${sessionNumber} started`,
        occurredAt,
        source: args.traceSeed.eventSource,
        subjectRefs: args.traceSeed.subjectRefs,
        details,
      };
  }
}

async function safeTraceWrite(label: string, action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    console.error(`[workflow-trace] ${label}`, error);
  }
}

export async function recordPosSessionTraceBestEffort(
  ctx: MutationCtx,
  args: {
    stage: PosSessionTraceStage;
    traceSeed: PosSessionTraceSeed;
    occurredAt?: number;
    transactionId?: Id<"posTransaction">;
    holdReason?: string;
    voidReason?: string;
  },
) {
  const traceRecord = buildPosSessionTraceRecord(args);
  const event = buildPosSessionTraceEvent(args);
  let traceCreated = false;

  await safeTraceWrite("pos.session.trace.create", async () => {
    await createWorkflowTraceWithCtx(ctx, traceRecord);
    traceCreated = true;
  });

  await safeTraceWrite("pos.session.trace.lookup", async () => {
    await registerWorkflowTraceLookupWithCtx(ctx, args.traceSeed.lookup);
  });

  await safeTraceWrite("pos.session.trace.event", async () => {
    await appendWorkflowTraceEventWithCtx(ctx, event);
  });

  return {
    traceCreated,
    traceId: args.traceSeed.trace.traceId,
  };
}

export function createPosSessionTraceRecorder(
  ctx: MutationCtx,
): PosSessionTraceRecorder {
  return {
    record(args) {
      const traceSeed = buildPosSessionTraceSeed({
        storeId: args.session.storeId,
        startedAt: args.session.createdAt,
        sessionNumber: args.session.sessionNumber,
        posSessionId: args.session._id,
        cashierId: args.session.cashierId,
        terminalId: args.session.terminalId,
        customerId: args.session.customerId,
        posTransactionId: args.transactionId ?? args.session.transactionId,
      });

      return recordPosSessionTraceBestEffort(ctx, {
        stage: args.stage,
        traceSeed,
        occurredAt: args.occurredAt,
        transactionId: args.transactionId,
        holdReason: args.holdReason,
        voidReason: args.voidReason,
      });
    },
  };
}

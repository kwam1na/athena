import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import {
  appendWorkflowTraceEventWithCtx,
  createWorkflowTraceWithCtx,
  registerWorkflowTraceLookupWithCtx,
} from "../../../workflowTraces/core";
import {
  buildExpenseSessionTraceSeed,
  type ExpenseSessionTraceSeed,
} from "../../../workflowTraces/adapters/expenseSession";

export type ExpenseSessionTraceStage =
  | "started"
  | "registerBound"
  | "held"
  | "resumed"
  | "completed"
  | "voided"
  | "expired"
  | "itemAdded"
  | "itemQuantityUpdated"
  | "itemRemoved"
  | "cartCleared";

export type ExpenseSessionTraceableSession = Pick<
  Doc<"expenseSession">,
  | "_id"
  | "sessionNumber"
  | "storeId"
  | "staffProfileId"
  | "terminalId"
  | "registerNumber"
  | "registerSessionId"
  | "status"
  | "createdAt"
  | "updatedAt"
  | "expiresAt"
  | "heldAt"
  | "resumedAt"
  | "completedAt"
  | "notes"
  | "workflowTraceId"
>;

type ExpenseSessionTraceRecordArgs = {
  stage: ExpenseSessionTraceStage;
  traceSeed: ExpenseSessionTraceSeed;
  occurredAt?: number;
  itemName?: string;
  quantity?: number;
  previousQuantity?: number;
  itemCount?: number;
};

export interface ExpenseSessionTraceRecorder {
  record(args: {
    stage: ExpenseSessionTraceStage;
    session: ExpenseSessionTraceableSession;
    occurredAt?: number;
    itemName?: string;
    quantity?: number;
    previousQuantity?: number;
    itemCount?: number;
  }): Promise<{
    traceCreated: boolean;
    traceId: string;
  }>;
}

function buildTraceSummary(args: {
  stage: ExpenseSessionTraceStage;
  traceSeed: ExpenseSessionTraceSeed;
}) {
  const sessionNumber = args.traceSeed.trace.primaryLookupValue;

  switch (args.stage) {
    case "registerBound":
      return `Expense session ${sessionNumber} is linked to a drawer`;
    case "held":
      return `Expense session ${sessionNumber} is currently held`;
    case "resumed":
      return `Expense session ${sessionNumber} resumed and is active`;
    case "completed":
      return `Expense session ${sessionNumber} completed`;
    case "voided":
      return `Expense session ${sessionNumber} was voided`;
    case "expired":
      return `Expense session ${sessionNumber} expired before completion`;
    case "itemAdded":
    case "itemQuantityUpdated":
    case "itemRemoved":
    case "cartCleared":
      return `Expense session ${sessionNumber} cart changed`;
    case "started":
    default:
      return `Trace for expense session ${sessionNumber}`;
  }
}

function buildExpenseSessionTraceRecord(args: ExpenseSessionTraceRecordArgs) {
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
      ...(args.itemName ? { itemName: args.itemName } : {}),
      ...(args.quantity !== undefined ? { quantity: args.quantity } : {}),
      ...(args.previousQuantity !== undefined
        ? { previousQuantity: args.previousQuantity }
        : {}),
      ...(args.itemCount !== undefined ? { itemCount: args.itemCount } : {}),
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
    default:
      return {
        ...baseRecord,
        status: "started" as const,
      };
  }
}

function buildExpenseSessionTraceEvent(args: ExpenseSessionTraceRecordArgs) {
  const occurredAt =
    args.occurredAt ??
    (args.stage === "started" ? args.traceSeed.trace.startedAt : Date.now());
  const sessionNumber = args.traceSeed.trace.primaryLookupValue;
  const details = {
    sessionStage: args.stage,
    ...(args.itemName ? { itemName: args.itemName } : {}),
    ...(args.quantity !== undefined ? { quantity: args.quantity } : {}),
    ...(args.previousQuantity !== undefined
      ? { previousQuantity: args.previousQuantity }
      : {}),
    ...(args.itemCount !== undefined ? { itemCount: args.itemCount } : {}),
  };

  const baseEvent = {
    storeId: args.traceSeed.trace.storeId,
    traceId: args.traceSeed.trace.traceId,
    workflowType: args.traceSeed.trace.workflowType,
    kind: "milestone" as const,
    occurredAt,
    source: args.traceSeed.eventSource,
    subjectRefs: args.traceSeed.subjectRefs,
    details,
  };

  switch (args.stage) {
    case "registerBound":
      return {
        ...baseEvent,
        step: "register_bound",
        status: "info" as const,
        message: `Linked expense session ${sessionNumber} to a cash drawer`,
      };
    case "held":
      return {
        ...baseEvent,
        step: "session_held",
        status: "info" as const,
        message: `Expense session ${sessionNumber} was held`,
      };
    case "resumed":
      return {
        ...baseEvent,
        step: "session_resumed",
        status: "started" as const,
        message: `Expense session ${sessionNumber} was resumed`,
      };
    case "completed":
      return {
        ...baseEvent,
        step: "session_completed",
        status: "succeeded" as const,
        message: `Expense session ${sessionNumber} completed`,
      };
    case "voided":
      return {
        ...baseEvent,
        step: "session_voided",
        status: "info" as const,
        message: `Expense session ${sessionNumber} was voided`,
      };
    case "expired":
      return {
        ...baseEvent,
        step: "session_expired",
        status: "failed" as const,
        message: `Expense session ${sessionNumber} expired`,
      };
    case "itemAdded":
      return {
        ...baseEvent,
        step: "cart_item_added",
        status: "info" as const,
        message: `Added ${args.itemName ?? "item"} x${args.quantity ?? 0} to expense session ${sessionNumber}`,
      };
    case "itemQuantityUpdated":
      return {
        ...baseEvent,
        step: "cart_item_quantity_updated",
        status: "info" as const,
        message: `Updated ${args.itemName ?? "item"} quantity from ${args.previousQuantity ?? 0} to ${args.quantity ?? 0} in expense session ${sessionNumber}`,
      };
    case "itemRemoved":
      return {
        ...baseEvent,
        step: "cart_item_removed",
        status: "info" as const,
        message: `Removed ${args.itemName ?? "item"} from expense session ${sessionNumber}`,
      };
    case "cartCleared":
      return {
        ...baseEvent,
        step: "cart_cleared",
        status: "info" as const,
        message: `Cleared ${args.itemCount ?? 0} items from expense session ${sessionNumber}`,
      };
    case "started":
    default:
      return {
        ...baseEvent,
        step: "session_started",
        status: "started" as const,
        message: `Expense session ${sessionNumber} started`,
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

export async function recordExpenseSessionTraceBestEffort(
  ctx: MutationCtx,
  args: ExpenseSessionTraceRecordArgs,
) {
  const traceRecord = buildExpenseSessionTraceRecord(args);
  const event = buildExpenseSessionTraceEvent(args);
  let traceCreated = false;

  await safeTraceWrite("expense.session.trace.create", async () => {
    await createWorkflowTraceWithCtx(ctx, traceRecord);
    traceCreated = true;
  });

  await safeTraceWrite("expense.session.trace.lookup", async () => {
    await registerWorkflowTraceLookupWithCtx(ctx, args.traceSeed.lookup);
  });

  await safeTraceWrite("expense.session.trace.event", async () => {
    await appendWorkflowTraceEventWithCtx(ctx, event);
  });

  return {
    traceCreated,
    traceId: args.traceSeed.trace.traceId,
  };
}

export function createExpenseSessionTraceRecorder(
  ctx: MutationCtx,
): ExpenseSessionTraceRecorder {
  return {
    record(args) {
      const traceSeed = buildExpenseSessionTraceSeed({
        storeId: args.session.storeId,
        startedAt: args.session.createdAt,
        sessionNumber: args.session.sessionNumber,
        expenseSessionId: args.session._id,
        staffProfileId: args.session.staffProfileId,
        terminalId: args.session.terminalId,
        registerSessionId: args.session.registerSessionId,
      });

      return recordExpenseSessionTraceBestEffort(ctx, {
        stage: args.stage,
        traceSeed,
        occurredAt: args.occurredAt,
        itemName: args.itemName,
        quantity: args.quantity,
        previousQuantity: args.previousQuantity,
        itemCount: args.itemCount,
      });
    },
  };
}

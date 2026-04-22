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
  | "expired"
  | "customerLinked"
  | "customerUpdated"
  | "customerCleared"
  | "itemAdded"
  | "itemQuantityUpdated"
  | "itemRemoved"
  | "cartCleared"
  | "paymentAdded"
  | "paymentUpdated"
  | "paymentRemoved"
  | "paymentsCleared"
  | "checkoutSubmitted";

export type PosSessionTraceableSession = Pick<
  Doc<"posSession">,
  | "_id"
  | "sessionNumber"
  | "storeId"
  | "staffProfileId"
  | "customerId"
  | "terminalId"
  | "registerNumber"
  | "status"
  | "createdAt"
  | "updatedAt"
  | "expiresAt"
  | "heldAt"
  | "resumedAt"
  | "completedAt"
  | "holdReason"
  | "notes"
  | "transactionId"
  | "customerInfo"
  | "payments"
  | "checkoutStateVersion"
  | "subtotal"
  | "tax"
  | "total"
  | "registerSessionId"
  | "workflowTraceId"
>;

type PosSessionTraceRecordArgs = {
  stage: PosSessionTraceStage;
  traceSeed: PosSessionTraceSeed;
  occurredAt?: number;
  transactionId?: Id<"posTransaction">;
  holdReason?: string;
  voidReason?: string;
  customerName?: string;
  itemName?: string;
  quantity?: number;
  previousQuantity?: number;
  itemCount?: number;
  paymentMethod?: string;
  amount?: number;
  previousAmount?: number;
  paymentCount?: number;
};

export interface PosSessionTraceRecorder {
  record(args: {
    stage: PosSessionTraceStage;
    session: PosSessionTraceableSession;
    occurredAt?: number;
    transactionId?: Id<"posTransaction">;
    holdReason?: string;
    voidReason?: string;
    customerName?: string;
    itemName?: string;
    quantity?: number;
    previousQuantity?: number;
    itemCount?: number;
    paymentMethod?: string;
    amount?: number;
    previousAmount?: number;
    paymentCount?: number;
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
    case "customerLinked":
    case "customerUpdated":
    case "customerCleared":
    case "itemAdded":
    case "itemQuantityUpdated":
    case "itemRemoved":
    case "cartCleared":
    case "paymentAdded":
    case "paymentUpdated":
    case "paymentRemoved":
    case "paymentsCleared":
    case "checkoutSubmitted":
      return `POS session ${sessionNumber} is in progress`;
    case "started":
    default:
      return `Trace for POS session ${sessionNumber}`;
  }
}

function buildPosSessionTraceRecord(args: PosSessionTraceRecordArgs) {
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
        ...(args.customerName ? { customerName: args.customerName } : {}),
        ...(args.itemName ? { itemName: args.itemName } : {}),
        ...(args.quantity !== undefined ? { quantity: args.quantity } : {}),
        ...(args.previousQuantity !== undefined
          ? { previousQuantity: args.previousQuantity }
          : {}),
        ...(args.itemCount !== undefined ? { itemCount: args.itemCount } : {}),
        ...(args.paymentMethod ? { paymentMethod: args.paymentMethod } : {}),
        ...(args.amount !== undefined ? { amount: args.amount } : {}),
        ...(args.previousAmount !== undefined
          ? { previousAmount: args.previousAmount }
          : {}),
        ...(args.paymentCount !== undefined
          ? { paymentCount: args.paymentCount }
          : {}),
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
    case "customerLinked":
    case "customerUpdated":
    case "customerCleared":
    case "itemAdded":
    case "itemQuantityUpdated":
    case "itemRemoved":
    case "cartCleared":
    case "paymentAdded":
    case "paymentUpdated":
    case "paymentRemoved":
    case "paymentsCleared":
    case "checkoutSubmitted":
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

function formatPaymentMethod(method: string | undefined) {
  if (!method) {
    return "payment";
  }

  return method.replaceAll("_", " ");
}

function buildPosSessionTraceEvent(args: PosSessionTraceRecordArgs) {
  const occurredAt =
    args.occurredAt ??
    (args.stage === "started" ? args.traceSeed.trace.startedAt : Date.now());
  const sessionNumber = args.traceSeed.trace.primaryLookupValue;
  const details = {
    sessionStage: args.stage,
    ...(args.holdReason ? { holdReason: args.holdReason } : {}),
    ...(args.voidReason ? { voidReason: args.voidReason } : {}),
    ...(args.customerName ? { customerName: args.customerName } : {}),
    ...(args.itemName ? { itemName: args.itemName } : {}),
    ...(args.quantity !== undefined ? { quantity: args.quantity } : {}),
    ...(args.previousQuantity !== undefined
      ? { previousQuantity: args.previousQuantity }
      : {}),
    ...(args.itemCount !== undefined ? { itemCount: args.itemCount } : {}),
    ...(args.paymentMethod ? { paymentMethod: args.paymentMethod } : {}),
    ...(args.amount !== undefined ? { amount: args.amount } : {}),
    ...(args.previousAmount !== undefined
      ? { previousAmount: args.previousAmount }
      : {}),
    ...(args.paymentCount !== undefined ? { paymentCount: args.paymentCount } : {}),
    ...(args.transactionId ? { transactionId: args.transactionId } : {}),
  };

  switch (args.stage) {
    case "customerLinked":
      return {
        storeId: args.traceSeed.trace.storeId,
        traceId: args.traceSeed.trace.traceId,
        workflowType: args.traceSeed.trace.workflowType,
        kind: "milestone" as const,
        step: "customer_linked",
        status: "info" as const,
        message: args.customerName
          ? `Linked ${args.customerName} to session ${sessionNumber}`
          : `Linked a customer to session ${sessionNumber}`,
        occurredAt,
        source: args.traceSeed.eventSource,
        subjectRefs: args.traceSeed.subjectRefs,
        details,
      };
    case "customerUpdated":
      return {
        storeId: args.traceSeed.trace.storeId,
        traceId: args.traceSeed.trace.traceId,
        workflowType: args.traceSeed.trace.workflowType,
        kind: "milestone" as const,
        step: "customer_updated",
        status: "info" as const,
        message: `Updated customer details for session ${sessionNumber}`,
        occurredAt,
        source: args.traceSeed.eventSource,
        subjectRefs: args.traceSeed.subjectRefs,
        details,
      };
    case "customerCleared":
      return {
        storeId: args.traceSeed.trace.storeId,
        traceId: args.traceSeed.trace.traceId,
        workflowType: args.traceSeed.trace.workflowType,
        kind: "milestone" as const,
        step: "customer_cleared",
        status: "info" as const,
        message: `Cleared customer details from session ${sessionNumber}`,
        occurredAt,
        source: args.traceSeed.eventSource,
        subjectRefs: args.traceSeed.subjectRefs,
        details,
      };
    case "itemAdded":
      return {
        storeId: args.traceSeed.trace.storeId,
        traceId: args.traceSeed.trace.traceId,
        workflowType: args.traceSeed.trace.workflowType,
        kind: "milestone" as const,
        step: "cart_item_added",
        status: "info" as const,
        message: `Added ${args.itemName ?? "item"} x${args.quantity ?? 0} to session ${sessionNumber}`,
        occurredAt,
        source: args.traceSeed.eventSource,
        subjectRefs: args.traceSeed.subjectRefs,
        details,
      };
    case "itemQuantityUpdated":
      return {
        storeId: args.traceSeed.trace.storeId,
        traceId: args.traceSeed.trace.traceId,
        workflowType: args.traceSeed.trace.workflowType,
        kind: "milestone" as const,
        step: "cart_item_quantity_updated",
        status: "info" as const,
        message: `Updated ${args.itemName ?? "item"} quantity from ${args.previousQuantity ?? 0} to ${args.quantity ?? 0} in session ${sessionNumber}`,
        occurredAt,
        source: args.traceSeed.eventSource,
        subjectRefs: args.traceSeed.subjectRefs,
        details,
      };
    case "itemRemoved":
      return {
        storeId: args.traceSeed.trace.storeId,
        traceId: args.traceSeed.trace.traceId,
        workflowType: args.traceSeed.trace.workflowType,
        kind: "milestone" as const,
        step: "cart_item_removed",
        status: "info" as const,
        message: `Removed ${args.itemName ?? "item"} from session ${sessionNumber}`,
        occurredAt,
        source: args.traceSeed.eventSource,
        subjectRefs: args.traceSeed.subjectRefs,
        details,
      };
    case "cartCleared":
      return {
        storeId: args.traceSeed.trace.storeId,
        traceId: args.traceSeed.trace.traceId,
        workflowType: args.traceSeed.trace.workflowType,
        kind: "milestone" as const,
        step: "cart_cleared",
        status: "info" as const,
        message: `Cleared ${args.itemCount ?? 0} items from session ${sessionNumber}`,
        occurredAt,
        source: args.traceSeed.eventSource,
        subjectRefs: args.traceSeed.subjectRefs,
        details,
      };
    case "paymentAdded":
      return {
        storeId: args.traceSeed.trace.storeId,
        traceId: args.traceSeed.trace.traceId,
        workflowType: args.traceSeed.trace.workflowType,
        kind: "milestone" as const,
        step: "payment_added",
        status: "info" as const,
        message: `Added ${formatPaymentMethod(args.paymentMethod)} to session ${sessionNumber}`,
        occurredAt,
        source: args.traceSeed.eventSource,
        subjectRefs: args.traceSeed.subjectRefs,
        details,
      };
    case "paymentUpdated":
      return {
        storeId: args.traceSeed.trace.storeId,
        traceId: args.traceSeed.trace.traceId,
        workflowType: args.traceSeed.trace.workflowType,
        kind: "milestone" as const,
        step: "payment_updated",
        status: "info" as const,
        message: `Updated ${formatPaymentMethod(args.paymentMethod)} for session ${sessionNumber}`,
        occurredAt,
        source: args.traceSeed.eventSource,
        subjectRefs: args.traceSeed.subjectRefs,
        details,
      };
    case "paymentRemoved":
      return {
        storeId: args.traceSeed.trace.storeId,
        traceId: args.traceSeed.trace.traceId,
        workflowType: args.traceSeed.trace.workflowType,
        kind: "milestone" as const,
        step: "payment_removed",
        status: "info" as const,
        message: `Removed ${formatPaymentMethod(args.paymentMethod)} from session ${sessionNumber}`,
        occurredAt,
        source: args.traceSeed.eventSource,
        subjectRefs: args.traceSeed.subjectRefs,
        details,
      };
    case "paymentsCleared":
      return {
        storeId: args.traceSeed.trace.storeId,
        traceId: args.traceSeed.trace.traceId,
        workflowType: args.traceSeed.trace.workflowType,
        kind: "milestone" as const,
        step: "payments_cleared",
        status: "info" as const,
        message: `Cleared pending payments from session ${sessionNumber}`,
        occurredAt,
        source: args.traceSeed.eventSource,
        subjectRefs: args.traceSeed.subjectRefs,
        details,
      };
    case "checkoutSubmitted":
      return {
        storeId: args.traceSeed.trace.storeId,
        traceId: args.traceSeed.trace.traceId,
        workflowType: args.traceSeed.trace.workflowType,
        kind: "milestone" as const,
        step: "checkout_submitted",
        status: "started" as const,
        message: `Submitted checkout for session ${sessionNumber}`,
        occurredAt,
        source: args.traceSeed.eventSource,
        subjectRefs: args.traceSeed.subjectRefs,
        details,
      };
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
  args: PosSessionTraceRecordArgs,
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
        staffProfileId: args.session.staffProfileId,
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
        customerName: args.customerName ?? args.session.customerInfo?.name,
        itemName: args.itemName,
        quantity: args.quantity,
        previousQuantity: args.previousQuantity,
        itemCount: args.itemCount,
        paymentMethod: args.paymentMethod,
        amount: args.amount,
        previousAmount: args.previousAmount,
        paymentCount: args.paymentCount,
      });
    },
  };
}
